from __future__ import annotations

import argparse
from datetime import datetime
import json
from pathlib import Path
import time
from typing import Any

from geo_audit.aggregation import aggregate_recommendations
from geo_audit.company_merge import generate_candidate_company_aliases
from geo_audit.web_mention_agent import collect_web_presence_with_agent


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def write_json(path: Path, value: Any) -> None:
    path.write_text(
        json.dumps(value, indent=2, ensure_ascii=False), encoding="utf-8"
    )


def run_check(source_run: Path, output_root: Path) -> Path:
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    output = output_root / stamp
    output.mkdir(parents=True, exist_ok=False)
    profile = read_json(source_run / "company_profile.json")
    raw_results = read_json(source_run / "ai_recommendations_raw.json")

    started = time.perf_counter()
    merge_started = time.perf_counter()
    aliases, merge_artifact, merge_error = generate_candidate_company_aliases(
        raw_results, profile.get("company_name")
    )
    merge_seconds = round(time.perf_counter() - merge_started, 3)
    write_json(output / "company_merge.json", merge_artifact)
    if merge_error:
        (output / "company_merge_error.txt").write_text(
            merge_error, encoding="utf-8"
        )

    user_aliases = [profile.get("company_name")]
    user_aliases.extend(profile.get("company_name_variants") or [])
    patterns = aggregate_recommendations(
        raw_results,
        top_n=5,
        user_company=profile.get("company_name"),
        user_aliases=[str(value) for value in user_aliases if value],
        company_aliases=aliases,
    )
    write_json(output / "recommendation_patterns.json", patterns)

    web_started = time.perf_counter()
    web_presence = collect_web_presence_with_agent(
        profile,
        raw_results,
        patterns,
        diagnostics_root=output / "web_mention_agent",
        max_competitors=5,
    )
    web_seconds = round(time.perf_counter() - web_started, 3)
    write_json(output / "web_presence.json", web_presence)

    recommendation_total = sum(
        len(row.get("recommended_companies", []) or []) for row in raw_results
    )
    final_counts = (
        merge_artifact.get("final", {}).get("final_counts", []) or []
    )
    merged_total = sum(
        int(row.get("times_recommended", 0) or 0) for row in final_counts
    )
    entity_counts = {
        str(entity.get("company_name")): len(entity.get("verified_mentions", []) or [])
        for entity in web_presence.get("entities", []) or []
    }
    summary = {
        "source_run": str(source_run.resolve()),
        "output": str(output.resolve()),
        "company_merge": {
            "seconds": merge_seconds,
            "input_recommendations": recommendation_total,
            "output_recommendations": merged_total,
            "counts_preserved": recommendation_total == merged_total,
            "candidate_groups": len(merge_artifact.get("candidate_groups", []) or []),
            "applied_groups": len(
                merge_artifact.get("final", {}).get(
                    "applied_merge_decisions", []
                )
                or []
            ),
            "error": merge_error,
        },
        "web_mention_agent": {
            "seconds": web_seconds,
            "status": web_presence.get("status"),
            "companies": entity_counts,
            **(web_presence.get("summary") or {}),
        },
        "combined_seconds": round(time.perf_counter() - started, 3),
    }
    write_json(output / "summary.json", summary)
    lines = [
        "# Integrated research check",
        "",
        f"- Merge time: {merge_seconds}s",
        f"- Web-agent time: {web_seconds}s",
        f"- Combined time: {summary['combined_seconds']}s",
        f"- Counts preserved: {summary['company_merge']['counts_preserved']}",
        f"- Candidate groups: {summary['company_merge']['candidate_groups']}",
        f"- Applied groups: {summary['company_merge']['applied_groups']}",
        f"- Verified mentions: {summary['web_mention_agent'].get('verified_mentions', 0)}",
        f"- Post-validation rejections: {summary['web_mention_agent'].get('post_validation_rejections', 0)}",
        "",
        "## Mentions per company",
        "",
        *[f"- {name}: {count}" for name, count in entity_counts.items()],
    ]
    (output / "summary.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    return output


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-run", required=True, type=Path)
    parser.add_argument(
        "--output-root",
        type=Path,
        default=Path("experiments/integrated_research_runs"),
    )
    args = parser.parse_args()
    output = run_check(args.source_run, args.output_root)
    print(output)


if __name__ == "__main__":
    main()
