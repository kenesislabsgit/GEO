from __future__ import annotations

import argparse
import json
import time
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

from geo_audit.profile import generate_company_profile


PROFILE_FIELDS = (
    "company_name",
    "category",
    "target_audience",
    "business_type",
    "delivery_model",
    "regions_served",
    "industries",
    "use_cases",
    "problems_solved",
    "unique_value_proposition",
    "primary_offerings",
    "buyer_personas",
    "purchase_context",
    "named_customers",
    "buying_signals",
    "competitor_scope",
)


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def present(value: object) -> bool:
    return value not in (None, "", "Unknown", [], {})


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source_run", type=Path)
    args = parser.parse_args()

    source = args.source_run.resolve()
    snapshot = read_json(source / "website_snapshot.json")
    evidence = read_json(source / "website_evidence.json")
    old_profile_path = source / "company_profile.json"
    old_profile = read_json(old_profile_path) if old_profile_path.exists() else {}

    domain = urlparse(str(snapshot.get("input_url") or "")).netloc or source.name
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    output = Path("experiments/profile_page_selection_runs") / f"{stamp}-{domain}"
    output.mkdir(parents=True, exist_ok=False)

    started = time.perf_counter()
    profile, payload, error = generate_company_profile(snapshot, evidence)
    total_seconds = round(time.perf_counter() - started, 3)

    selection = payload.get("page_selection") or {}
    selected_ids = selection.get("selected_page_ids") or []
    selected_pages = []
    for page_id in selected_ids:
        try:
            page = snapshot["pages"][int(str(page_id).split("-")[-1]) - 1]
        except (IndexError, KeyError, TypeError, ValueError):
            continue
        selected_pages.append(
            {"page_id": page_id, "url": page.get("url"), "title": page.get("title")}
        )

    new_profile = profile or {}
    comparison = {
        field: {
            "old_present": present(old_profile.get(field)),
            "new_present": present(new_profile.get(field)),
            "exact_match": old_profile.get(field) == new_profile.get(field),
        }
        for field in PROFILE_FIELDS
    }
    summary = {
        "source_run": str(source),
        "error": error,
        "total_seconds": total_seconds,
        "selection_seconds": (selection.get("request") or {}).get("duration_seconds", 0),
        "profile_seconds": payload.get("profile_generation_seconds", 0),
        "pages_available": len(snapshot.get("pages") or []),
        "pages_selected": len(selected_pages),
        "selected_pages": selected_pages,
        "old_prompt_bytes": (
            (source / "company_profile_prompt.json").stat().st_size
            if (source / "company_profile_prompt.json").exists()
            else None
        ),
        "new_prompt_bytes": len(json.dumps(payload, ensure_ascii=False).encode("utf-8")),
        "old_fields_present": sum(present(old_profile.get(field)) for field in PROFILE_FIELDS),
        "new_fields_present": sum(present(new_profile.get(field)) for field in PROFILE_FIELDS),
        "field_comparison": comparison,
    }

    (output / "summary.json").write_text(
        json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    (output / "profile.json").write_text(
        json.dumps(new_profile, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    (output / "requests.json").write_text(
        json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print(json.dumps({"output": str(output), **summary}, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
