from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import json
import time
from datetime import datetime
from pathlib import Path

from experiments.question_generation_compare import question_metrics, read_json
from geo_audit.intents import build_question_profile_context, sanitize_prompt_records
from geo_audit.json_tools import extract_json_object
from geo_audit.llm import build_chat_payload, call_chat_completion


COMPARISON_PROMPT = """Compare two buyer-question sets for the same AI
visibility audit. Score each from 0 to 100. Judge company fit, natural buyer
wording, whether each question asks for suitable direct-peer products or
providers, realistic buyer specificity, coverage of distinct buyer needs and
buying stages, repeated meaning, unsupported details, and audited-company or
customer-name leakage. Do not reward wording merely because it is longer or
more detailed. Return only JSON:
{
  "old": {"score": 0, "strengths": [], "problems": []},
  "new": {"score": 0, "strengths": [], "problems": []},
  "winner": "old|new|tie",
  "reason": ""
}"""


def compare(result_path: Path) -> dict:
    generated = read_json(result_path)
    if not isinstance(generated, dict):
        raise ValueError("New result is not an object.")
    run = Path(str(generated["run"]))
    profile = read_json(Path(str(generated["profile"])))
    old_raw = read_json(run / "customer_prompts.json")
    new_raw = generated.get("questions") or []
    if not isinstance(profile, dict) or not isinstance(old_raw, list):
        raise ValueError("Missing profile or old questions.")
    old = sanitize_prompt_records(old_raw, profile)
    new = sanitize_prompt_records(new_raw, profile)
    company = str(profile.get("company_name") or run.name)
    payload = build_chat_payload(
        COMPARISON_PROMPT,
        json.dumps(
            {
                "company_facts": build_question_profile_context(profile),
                "old_questions": old,
                "new_questions": new,
            },
            ensure_ascii=False,
        ),
        temperature=0,
        json_response=True,
    )
    started = time.perf_counter()
    judgment = extract_json_object(call_chat_completion(payload))
    seconds = round(time.perf_counter() - started, 3)
    return {
        "company": company,
        "run": str(run),
        "old_metrics": question_metrics(old, company),
        "new_metrics": question_metrics(new, company),
        "judgment": judgment,
        "judge_seconds": seconds,
        "old_questions": old,
        "new_questions": new,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("batch_run", type=Path)
    parser.add_argument("--concurrency", type=int, default=4)
    args = parser.parse_args()

    batch = args.batch_run.resolve()
    result_paths = sorted(batch.glob("*-result.json"))
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    output = Path("experiments/question_old_new_runs") / stamp
    output.mkdir(parents=True, exist_ok=False)

    results = []
    errors = []
    started = time.perf_counter()
    with ThreadPoolExecutor(
        max_workers=max(1, min(args.concurrency, len(result_paths)))
    ) as executor:
        futures = {executor.submit(compare, path): path for path in result_paths}
        for future in as_completed(futures):
            try:
                item = future.result()
                results.append(item)
                (output / f"{futures[future].stem}.json").write_text(
                    json.dumps(item, indent=2, ensure_ascii=False), encoding="utf-8"
                )
            except Exception as exc:  # noqa: BLE001 - retain other comparisons.
                errors.append(
                    {
                        "input": str(futures[future]),
                        "error": f"{type(exc).__name__}: {exc}",
                    }
                )
    results.sort(key=lambda item: item["company"])
    summary = {
        "wall_seconds": round(time.perf_counter() - started, 3),
        "sites_completed": len(results),
        "errors": errors,
        "results": [
            {
                "company": item["company"],
                "old_metrics": item["old_metrics"],
                "new_metrics": item["new_metrics"],
                "judgment": item["judgment"],
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
