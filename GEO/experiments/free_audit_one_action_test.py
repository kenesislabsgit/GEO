from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
import json
from pathlib import Path
import re
import time
from typing import Any

from geo_audit.aggregation import aggregate_recommendations
from geo_audit.competitor_evidence import build_competitor_evidence
from geo_audit.json_tools import extract_json_object
from geo_audit.llm import build_chat_payload, call_chat_completion


SYSTEM_PROMPT = """You write the single highest-priority action in a free AI visibility audit.

Use only the supplied five buyer answers, measured counts, and website evidence.
Choose one question where the audited company lost or ranked weakly. Explain what
the leading competitor communicated more clearly, then give one precise change
to the audited company's website. Recommend communication or evidence changes,
not new product features. Do not give generic SEO advice. Do not promise that
the action will cause future AI recommendations. If the evidence is weak, say so.

Return one JSON object with exactly these fields:
title, observation, why_this_matters, action, expected_impact, audited_page_url,
competitor_page_url, confidence.
"""


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def clean(value: Any, limit: int = 1200) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    return text[:limit]


def normalized_name(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value or "").lower())


def page_rows(snapshot: dict[str, Any], limit: int) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    for page in snapshot.get("pages", []) or []:
        url = clean(page.get("final_url") or page.get("url"), 500)
        if not url:
            continue
        rows.append(
            {
                "url": url,
                "title": clean(page.get("title"), 240),
                "content": clean(
                    page.get("text")
                    or page.get("markdown")
                    or page.get("content")
                    or page.get("excerpt"),
                    1600,
                ),
            }
        )
        if len(rows) >= limit:
            break
    return rows


def latest_complete_runs(outputs: Path) -> list[Path]:
    required = {
        "company_profile.json",
        "website_snapshot.json",
        "ai_recommendations_raw.json",
        "competitor_evidence.json",
    }
    latest: dict[str, Path] = {}
    for run in sorted(outputs.iterdir()):
        if not run.is_dir() or run.name.startswith("_"):
            continue
        if not all((run / name).exists() for name in required):
            continue
        domain = run.name.split("-", 2)[-1]
        latest[domain] = run
    return list(latest.values())


def five_search_answers(raw: list[dict[str, Any]]) -> list[dict[str, Any]]:
    selected = [
        row
        for row in raw
        if str(row.get("assistant", "")).lower() in {"openai", "openai_search"}
    ]
    selected.sort(key=lambda row: int(row.get("prompt_index", 9999) or 9999))
    return selected[:5]


def competitor_record(
    evidence: dict[str, Any], company_name: str
) -> dict[str, Any] | None:
    wanted = normalized_name(company_name)
    for row in evidence.get("competitors", []) or []:
        if normalized_name(row.get("company_name")) == wanted:
            return row
    return None


def compact_answers(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "question": row.get("prompt"),
            "recommended_companies": [
                {
                    "name": item.get("company_name"),
                    "rank": item.get("rank"),
                    "reason": clean(item.get("reasoning"), 420),
                }
                for item in (row.get("recommended_companies") or [])[:5]
            ],
        }
        for row in rows
    ]


def build_input(run: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    profile = read_json(run / "company_profile.json")
    snapshot = read_json(run / "website_snapshot.json")
    raw = five_search_answers(read_json(run / "ai_recommendations_raw.json"))
    if not raw:
        raise ValueError("No saved ChatGPT answers were available")

    aliases = [profile.get("company_name")]
    aliases.extend(profile.get("company_name_variants") or [])
    patterns = aggregate_recommendations(
        raw,
        top_n=5,
        user_company=profile.get("company_name"),
        user_aliases=[str(value) for value in aliases if value],
    )
    priority = (patterns.get("investigation_priority") or [{}])[0]
    priority_name = str(priority.get("company_name") or "")
    top = next(
        (
            row
            for row in (patterns.get("competitors") or [])
            if normalized_name(row.get("company_name"))
            == normalized_name(priority_name)
        ),
        (patterns.get("top_competitors") or [{}])[0],
    )
    top_name = str(top.get("company_name") or "Unknown")
    all_competitor_evidence = read_json(run / "competitor_evidence.json")
    competitor = competitor_record(all_competitor_evidence, top_name)
    if not page_rows((competitor or {}).get("website_snapshot") or {}, 1):
        fresh = build_competitor_evidence(
            patterns,
            max_pages=3,
            crawl_limit=1,
            firecrawl_client=None,
        )
        competitor = competitor_record(fresh, top_name)
    competitor_pages = page_rows(
        (competitor or {}).get("website_snapshot") or {}, 3
    )
    summary = patterns.get("user_recommendation_summary") or {}

    input_data = {
        "audited_company": {
            "name": profile.get("company_name"),
            "website": snapshot.get("normalized_url") or snapshot.get("input_url"),
            "category": profile.get("category"),
            "offerings": (profile.get("primary_offerings") or profile.get("features") or [])[:6],
            "use_cases": (profile.get("use_cases") or [])[:6],
        },
        "measured_result": {
            "answers_checked": len(raw),
            "company_mentions": summary.get("user_mentions", 0),
            "average_rank": summary.get("user_average_rank"),
            "top_competitor": top_name,
            "top_competitor_mentions": top.get("mention_frequency", 0),
        },
        "five_buyer_answers": compact_answers(raw),
        "audited_company_pages": page_rows(snapshot, 6),
        "top_competitor_pages": competitor_pages,
    }
    meta = {
        "source_run": run.name,
        "company": profile.get("company_name"),
        "top_competitor": top_name,
        "competitor_pages_available": len(competitor_pages),
    }
    return input_data, meta


def run_one(run: Path, output_root: Path) -> dict[str, Any]:
    started = time.perf_counter()
    input_data, meta = build_input(run)
    payload = build_chat_payload(
        SYSTEM_PROMPT,
        json.dumps(input_data, ensure_ascii=False),
        temperature=0.1,
        json_response=True,
    )
    company_dir = output_root / run.name
    company_dir.mkdir(parents=True, exist_ok=True)
    (company_dir / "input.json").write_text(
        json.dumps(input_data, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    (company_dir / "prompt.json").write_text(
        json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    raw_response = call_chat_completion(payload)
    action = extract_json_object(raw_response)
    elapsed = round(time.perf_counter() - started, 3)
    result = {
        **meta,
        "seconds": elapsed,
        "estimated_writer_cost_usd": 0.005,
        "action": action,
    }
    (company_dir / "result.json").write_text(
        json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--outputs", default="outputs")
    parser.add_argument("--workers", type=int, default=5)
    args = parser.parse_args()

    outputs = Path(args.outputs)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    output_root = Path("experiments/free_audit_one_action_runs") / stamp
    output_root.mkdir(parents=True, exist_ok=True)
    runs = latest_complete_runs(outputs)
    results: list[dict[str, Any]] = []
    failures: list[dict[str, str]] = []
    wall_started = time.perf_counter()
    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as executor:
        futures = {executor.submit(run_one, run, output_root): run for run in runs}
        for future in as_completed(futures):
            run = futures[future]
            try:
                result = future.result()
                results.append(result)
                print(
                    f"{result['company']}: {result['seconds']}s | "
                    f"{result['action'].get('title', '')}"
                )
            except Exception as exc:  # noqa: BLE001 - preserve every failed test.
                failures.append(
                    {"source_run": run.name, "error": f"{type(exc).__name__}: {exc}"}
                )
                print(f"{run.name}: FAILED | {type(exc).__name__}: {exc}")

    results.sort(key=lambda row: str(row.get("company", "")))
    summary = {
        "runs_attempted": len(runs),
        "runs_completed": len(results),
        "failures": failures,
        "wall_seconds": round(time.perf_counter() - wall_started, 3),
        "average_writer_seconds": round(
            sum(float(row["seconds"]) for row in results) / max(1, len(results)), 3
        ),
        "estimated_total_writer_cost_usd": round(
            sum(float(row["estimated_writer_cost_usd"]) for row in results), 3
        ),
        "results": results,
    }
    (output_root / "summary.json").write_text(
        json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print(f"Saved: {output_root / 'summary.json'}")


if __name__ == "__main__":
    main()
