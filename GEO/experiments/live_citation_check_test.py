from __future__ import annotations

import argparse
import json
import time
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

from geo_audit.recommendations import (
    LiveCitationVerifier,
    collect_multi_model_recommendations,
    verify_provider_citations,
)


ASSISTANTS = [
    "openai_search",
    "bedrock_claude",
    "bedrock_llama",
    "bedrock_mistral",
]


def read_json(path: Path) -> dict | list:
    return json.loads(path.read_text(encoding="utf-8"))


def citation_summary(results: list[dict]) -> dict:
    checks = [
        check
        for result in results
        for check in result.get("provider_citation_verification", [])
    ]
    return {
        "answers": len(results),
        "answers_with_citations": sum(
            bool(result.get("provider_source_urls")) for result in results
        ),
        "citation_checks": len(checks),
        "verified_checks": sum(bool(check.get("verified")) for check in checks),
        "failed_checks": sum(not check.get("verified") for check in checks),
    }


def collect(prompts: list[dict], *, result_callback=None):
    return collect_multi_model_recommendations(
        prompts,
        assistants=ASSISTANTS,
        limit_per_assistant=len(prompts),
        analysis_mode=True,
        analyzer_batch_size=5,
        provider_concurrency=20,
        search_context_size="low",
        openai_search_batch_size=1,
        result_callback=result_callback,
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("questions", type=Path)
    parser.add_argument("profile", type=Path)
    parser.add_argument("--count", type=int, default=3)
    args = parser.parse_args()

    prompts_raw = read_json(args.questions.resolve())
    profile = read_json(args.profile.resolve())
    if not isinstance(prompts_raw, list) or not isinstance(profile, dict):
        raise SystemExit("Questions must be a list and profile must be an object.")
    prompts = prompts_raw[: args.count]
    company_name = str(profile.get("company_name") or "").strip()
    supporting = profile.get("evidence", {}).get("supporting_pages", [])
    first_url = str((supporting or [""])[0])
    domain = urlparse(first_url).netloc.casefold().removeprefix("www.")
    match_terms = tuple(value for value in (company_name, domain) if value)

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    output = Path("experiments/live_citation_check_runs") / stamp
    output.mkdir(parents=True, exist_ok=False)

    baseline_started = time.perf_counter()
    baseline_raw, baseline_payloads, baseline_errors = collect(prompts)
    baseline_collection = round(time.perf_counter() - baseline_started, 3)
    baseline_check_started = time.perf_counter()
    baseline_results = verify_provider_citations(
        baseline_raw,
        concurrency=20,
        match_terms=match_terms,
    )
    baseline_check = round(time.perf_counter() - baseline_check_started, 3)
    baseline_total = round(time.perf_counter() - baseline_started, 3)
    (output / "baseline.json").write_text(
        json.dumps(
            {
                "collection_seconds": baseline_collection,
                "citation_seconds": baseline_check,
                "total_seconds": baseline_total,
                "summary": citation_summary(baseline_results),
                "errors": baseline_errors,
                "payloads": baseline_payloads,
                "results": baseline_results,
            },
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    live = LiveCitationVerifier(concurrency=20, match_terms=match_terms)
    overlap_started = time.perf_counter()
    overlap_raw, overlap_payloads, overlap_errors = collect(
        prompts,
        result_callback=live.submit,
    )
    overlap_collection = round(time.perf_counter() - overlap_started, 3)
    overlap_tail_started = time.perf_counter()
    overlap_results = live.finish(overlap_raw)
    overlap_tail = round(time.perf_counter() - overlap_tail_started, 3)
    overlap_total = round(time.perf_counter() - overlap_started, 3)
    (output / "overlap.json").write_text(
        json.dumps(
            {
                "collection_seconds": overlap_collection,
                "remaining_citation_seconds": overlap_tail,
                "total_seconds": overlap_total,
                "summary": citation_summary(overlap_results),
                "errors": overlap_errors,
                "payloads": overlap_payloads,
                "results": overlap_results,
            },
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    summary = {
        "questions": len(prompts),
        "assistants": ASSISTANTS,
        "expected_answers": len(prompts) * len(ASSISTANTS),
        "baseline": {
            "collection_seconds": baseline_collection,
            "citation_seconds": baseline_check,
            "total_seconds": baseline_total,
            **citation_summary(baseline_results),
        },
        "overlap": {
            "collection_seconds": overlap_collection,
            "remaining_citation_seconds": overlap_tail,
            "total_seconds": overlap_total,
            **citation_summary(overlap_results),
        },
        "seconds_saved": round(baseline_total - overlap_total, 3),
        "percent_saved": round(
            100 * (baseline_total - overlap_total) / max(0.001, baseline_total), 1
        ),
    }
    (output / "summary.json").write_text(
        json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print(json.dumps({"output": str(output), **summary}, indent=2))


if __name__ == "__main__":
    main()
