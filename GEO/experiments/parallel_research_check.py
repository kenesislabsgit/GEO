from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
import json
from pathlib import Path
import time
from typing import Any

from geo_audit.aggregation import aggregate_recommendations
from geo_audit.company_merge import generate_candidate_company_aliases
from geo_audit.competitor_evidence import build_competitor_evidence
from geo_audit.firecrawl import FirecrawlClient
from geo_audit.web_mention_agent import (
    build_production_agent_input,
    collect_web_presence_for_agent_input,
    merge_web_presence_results,
)


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def write_json(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False), encoding="utf-8")


def timed_competitor_fetch(*args: Any, **kwargs: Any) -> tuple[dict[str, Any], float]:
    started = time.perf_counter()
    result = build_competitor_evidence(*args, **kwargs)
    return result, round(time.perf_counter() - started, 3)


def run_check(source_run: Path, output_root: Path) -> Path:
    output = output_root / datetime.now().strftime("%Y%m%d-%H%M%S")
    output.mkdir(parents=True, exist_ok=False)
    profile = read_json(source_run / "company_profile.json")
    raw_results = read_json(source_run / "ai_recommendations_raw.json")
    snapshot_path = source_run / "website_snapshot.json"
    snapshot = read_json(snapshot_path) if snapshot_path.exists() else {}
    audited_url = str(snapshot.get("normalized_url") or profile.get("input_url") or "")

    audited_input = build_production_agent_input(
        profile,
        raw_results,
        {},
        max_competitors=0,
        audited_website_url=audited_url,
    )
    started = time.perf_counter()
    firecrawl_client = FirecrawlClient.from_environment()
    with ThreadPoolExecutor(max_workers=2) as executor:
        audited_future = executor.submit(
            collect_web_presence_for_agent_input,
            audited_input,
            diagnostics_root=output / "web_mention_agent" / "audited_company",
        )

        merge_started = time.perf_counter()
        aliases, merge_artifact, merge_error = generate_candidate_company_aliases(
            raw_results, profile.get("company_name")
        )
        merge_seconds = round(time.perf_counter() - merge_started, 3)
        write_json(output / "company_merge.json", merge_artifact)

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

        full_input = build_production_agent_input(
            profile,
            raw_results,
            patterns,
            max_competitors=5,
            audited_website_url=audited_url,
        )
        competitor_input = {**full_input, "companies": full_input["companies"][1:]}
        known_competitor_presence = {
            "entities": [
                {
                    "company_name": company.get("company_name"),
                    "official_website": (
                        company.get("website_url")
                        if company.get("website_url") != "not_yet_found"
                        else None
                    ),
                    "verified_mentions": [],
                }
                for company in competitor_input["companies"]
            ]
        }
        competitor_fetch_future = executor.submit(
            timed_competitor_fetch,
            patterns,
            web_presence=known_competitor_presence,
            max_pages=8,
            crawl_limit=5,
            firecrawl_client=firecrawl_client,
        )
        competitor_started = time.perf_counter()
        competitor_result = collect_web_presence_for_agent_input(
            competitor_input,
            diagnostics_root=output / "web_mention_agent" / "competitors",
        )
        competitor_seconds = round(time.perf_counter() - competitor_started, 3)
        audited_result = audited_future.result()
        early_competitor_evidence, competitor_fetch_seconds = (
            competitor_fetch_future.result()
        )

    web_presence = merge_web_presence_results(audited_result, competitor_result)
    missing_fetch_started = time.perf_counter()
    competitor_evidence = build_competitor_evidence(
        patterns,
        web_presence=web_presence,
        existing_evidence=early_competitor_evidence,
        max_pages=8,
        crawl_limit=5,
        firecrawl_client=firecrawl_client,
    )
    missing_fetch_seconds = round(time.perf_counter() - missing_fetch_started, 3)
    combined_seconds = round(time.perf_counter() - started, 3)
    audited_seconds = round(
        float(audited_result.get("summary", {}).get("integration_seconds", 0) or 0),
        3,
    )
    write_json(output / "web_presence.json", web_presence)
    write_json(output / "competitor_evidence.json", competitor_evidence)
    entity_counts = {
        str(row.get("company_name")): len(row.get("verified_mentions", []) or [])
        for row in web_presence.get("entities", []) or []
    }
    summary = {
        "source_run": str(source_run.resolve()),
        "merge_seconds": merge_seconds,
        "audited_company_web_seconds": audited_seconds,
        "competitor_web_seconds": competitor_seconds,
        "competitor_website_fetch_seconds": competitor_fetch_seconds,
        "missing_competitor_fetch_tail_seconds": missing_fetch_seconds,
        "sequential_equivalent_seconds": round(
            merge_seconds
            + audited_seconds
            + competitor_seconds
            + competitor_fetch_seconds
            + missing_fetch_seconds,
            3,
        ),
        "parallel_combined_seconds": combined_seconds,
        "overlap_saved_seconds": round(
            merge_seconds
            + audited_seconds
            + competitor_seconds
            + competitor_fetch_seconds
            + missing_fetch_seconds
            - combined_seconds,
            3,
        ),
        "status": web_presence.get("status"),
        "companies": entity_counts,
        "verified_mentions": web_presence.get("summary", {}).get(
            "verified_mentions", 0
        ),
        "competitor_websites_downloaded": competitor_evidence.get(
            "summary", {}
        ).get("with_website_evidence", 0),
        "counts_preserved": sum(
            int(row.get("times_recommended", 0) or 0)
            for row in merge_artifact.get("final", {}).get("final_counts", []) or []
        )
        == sum(
            len(row.get("recommended_companies", []) or []) for row in raw_results
        ),
        "merge_error": merge_error,
    }
    write_json(output / "summary.json", summary)
    return output


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-run", required=True, type=Path)
    parser.add_argument(
        "--output-root",
        type=Path,
        default=Path("experiments/parallel_research_runs"),
    )
    args = parser.parse_args()
    print(run_check(args.source_run, args.output_root))


if __name__ == "__main__":
    main()
