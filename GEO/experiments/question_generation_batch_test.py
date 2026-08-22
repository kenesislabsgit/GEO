from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import json
import time
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

from experiments.question_generation_compare import (
    UNIFIED_QUESTION_PROMPT,
    question_metrics,
    read_json,
)
from geo_audit.intents import build_question_profile_context, sanitize_prompt_records
from geo_audit.json_tools import extract_json_object
from geo_audit.llm import build_chat_payload, call_chat_completion


QUALITY_PROMPT = """Judge one buyer-question set for an AI visibility audit.
Score it from 0 to 100 using these equally important checks: company relevance,
natural buyer wording, specific enough to return useful provider
recommendations, direct-peer scope, unbranded wording, distinct buyer needs,
and coverage of realistic buyers and buying stages. Penalize repeated meaning,
seller language, unsupported buyer details, implementation questions, and
overstuffed questions. Return only JSON:
{
  "score": 0,
  "verdict": "good|mixed|poor",
  "strengths": [],
  "problems": []
}"""


def latest_runs(outputs: Path) -> list[Path]:
    by_domain: dict[str, Path] = {}
    for run in sorted(outputs.iterdir()):
        snapshot_path = run / "website_snapshot.json"
        profile_path = run / "company_profile.json"
        if not run.is_dir() or not snapshot_path.exists() or not profile_path.exists():
            continue
        try:
            snapshot = read_json(snapshot_path)
            pages = snapshot.get("pages") if isinstance(snapshot, dict) else None
            domain = urlparse(str((pages or [{}])[0].get("url") or "")).netloc
            domain = domain.casefold().removeprefix("www.")
        except (IndexError, TypeError, ValueError):
            continue
        if domain:
            by_domain[domain] = run
    return [by_domain[key] for key in sorted(by_domain)]


def selected_profile_overrides(root: Path) -> dict[str, Path]:
    overrides: dict[str, Path] = {}
    runs = root / "experiments" / "profile_page_selection_runs"
    if not runs.exists():
        return overrides
    for summary_path in runs.glob("*/summary.json"):
        try:
            summary = read_json(summary_path)
            if not isinstance(summary, dict) or summary.get("error"):
                continue
            source = str(Path(str(summary.get("source_run") or "")).resolve())
            profile_path = summary_path.parent / "profile.json"
            if source and profile_path.exists():
                overrides[source] = profile_path
        except (OSError, TypeError, ValueError):
            continue
    return overrides


def test_one_run(
    run: Path,
    profile_path: Path,
    count: int,
    output: Path,
) -> dict:
    profile = read_json(profile_path)
    if not isinstance(profile, dict):
        raise ValueError("Profile is not an object.")
    facts = build_question_profile_context(profile)
    generation_payload = build_chat_payload(
        UNIFIED_QUESTION_PROMPT,
        json.dumps(
            {"requested_question_count": count, "company_facts": facts},
            ensure_ascii=False,
        ),
        temperature=0.2,
        json_response=True,
    )
    started = time.perf_counter()
    response = extract_json_object(call_chat_completion(generation_payload))
    generation_seconds = round(time.perf_counter() - started, 3)
    questions = sanitize_prompt_records(
        response.get("questions") if isinstance(response.get("questions"), list) else [],
        profile,
    )
    metrics = question_metrics(questions, str(profile.get("company_name") or ""))

    checkpoint = {
        "run": str(run),
        "profile": str(profile_path),
        "company": profile.get("company_name"),
        "generation_seconds": generation_seconds,
        "metrics": metrics,
        "questions": questions,
        "generation_request": generation_payload,
    }
    company_key = run.name
    (output / f"{company_key}-questions.json").write_text(
        json.dumps(checkpoint, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    quality_payload = build_chat_payload(
        QUALITY_PROMPT,
        json.dumps(
            {"company_facts": facts, "questions": questions}, ensure_ascii=False
        ),
        temperature=0,
        json_response=True,
    )
    quality_started = time.perf_counter()
    quality = extract_json_object(call_chat_completion(quality_payload))
    quality_seconds = round(time.perf_counter() - quality_started, 3)
    checkpoint["quality"] = quality
    checkpoint["quality_seconds_not_counted"] = quality_seconds
    (output / f"{company_key}-result.json").write_text(
        json.dumps(checkpoint, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    return checkpoint


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--outputs", type=Path, default=Path("outputs"))
    parser.add_argument("--count", type=int, default=20)
    parser.add_argument("--concurrency", type=int, default=4)
    args = parser.parse_args()

    root = Path.cwd()
    runs = latest_runs(args.outputs.resolve())
    overrides = selected_profile_overrides(root)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    output = Path("experiments/question_generation_batch_runs") / stamp
    output.mkdir(parents=True, exist_ok=False)

    started = time.perf_counter()
    results = []
    errors = []
    workers = max(1, min(args.concurrency, len(runs)))
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {}
        for run in runs:
            profile_path = overrides.get(str(run.resolve()), run / "company_profile.json")
            future = executor.submit(test_one_run, run, profile_path, args.count, output)
            futures[future] = run
        for future in as_completed(futures):
            run = futures[future]
            try:
                results.append(future.result())
            except Exception as exc:  # noqa: BLE001 - preserve every other result.
                errors.append({"run": str(run), "error": f"{type(exc).__name__}: {exc}"})

    results.sort(key=lambda item: str(item.get("company") or ""))
    summary = {
        "wall_seconds": round(time.perf_counter() - started, 3),
        "sites_requested": len(runs),
        "sites_completed": len(results),
        "errors": errors,
        "results": [
            {
                "company": item.get("company"),
                "generation_seconds": item.get("generation_seconds"),
                "metrics": item.get("metrics"),
                "quality": item.get("quality"),
                "quality_seconds_not_counted": item.get("quality_seconds_not_counted"),
            }
            for item in results
        ],
    }
    (output / "summary.json").write_text(
        json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print(json.dumps({"output": str(output), **summary}, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
