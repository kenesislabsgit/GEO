from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import json
from pathlib import Path
import time
from typing import Any

from .flow import VerifiedGapFlow, _object
from .prompts import EVIDENCE_RESEARCHER_PROMPT


def validate_packet(result: dict[str, Any], packet: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    loss = packet["observed_loss"]
    if result.get("question_id") != loss.get("question_id"):
        errors.append("question changed")
    if result.get("winner_company") != loss.get("winner_company"):
        errors.append("winner changed")
    pages = {
        str(item.get("page_id", "")): item
        for item in packet.get("opened_page_passages", []) or []
    }
    for page_field, passage_field, expected_company in (
        ("competitor_page_id", "competitor_passage_ids", loss.get("winner_company")),
        ("audited_page_id", "audited_passage_ids", loss.get("audited_company")),
    ):
        page_id = str(result.get(page_field, ""))
        page = pages.get(page_id)
        if not page:
            errors.append(f"invalid {page_field}")
            continue
        if str(page.get("company_name", "")) != str(expected_company):
            errors.append(f"wrong company for {page_field}")
        allowed = {
            str(item.get("passage_id", ""))
            for item in page.get("passages", []) or []
        }
        selected = list(result.get(passage_field, []) or [])
        if result.get("status") == "SUPPORTED_GAP" and not selected:
            errors.append(f"empty {passage_field}")
        if any(str(value) not in allowed for value in selected):
            errors.append(f"invalid {passage_field}")
    if result.get("status") == "SUPPORTED_GAP":
        for field in (
            "competitor_proof", "audited_company_proof", "direct_difference",
            "buyer_need_connection",
        ):
            if len(str(result.get(field, "")).split()) < 5:
                errors.append(f"weak {field}")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description="Compare parallel and batched evidence calls.")
    parser.add_argument("--saved-run", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--model", default="gpt-5-mini")
    args = parser.parse_args()
    inputs = json.loads((args.saved_run / "research_inputs.json").read_text(encoding="utf-8"))
    plans = json.loads((args.saved_run / "investigation_plans.json").read_text(encoding="utf-8"))
    selected_ids = sorted(
        inputs,
        key=lambda question_id: (
            int(inputs[question_id]["observed_loss"]["audited_company_recommendation_count"]),
            -int(inputs[question_id]["observed_loss"]["winner_recommendation_count"]),
            question_id,
        ),
    )[:5]
    packets = {question_id: inputs[question_id] for question_id in selected_ids}
    flow = VerifiedGapFlow(args.saved_run, args.output_dir, model=args.model, max_workers=5)
    flow._write("comparison_inputs.json", packets)

    def call_one(question_id: str) -> tuple[str, dict[str, Any]]:
        schema = flow._research_schema_for(plans[question_id], packets[question_id])
        return question_id, flow._call_json(
            "parallel_individual", question_id, EVIDENCE_RESEARCHER_PROMPT,
            packets[question_id], schema,
        )

    parallel_started = time.perf_counter()
    individual: dict[str, dict[str, Any]] = {}
    with ThreadPoolExecutor(max_workers=5) as executor:
        futures = {executor.submit(call_one, question_id): question_id for question_id in selected_ids}
        for future in as_completed(futures):
            question_id, result = future.result()
            individual[question_id] = result
    individual = {question_id: individual[question_id] for question_id in selected_ids}
    parallel_seconds = round(time.perf_counter() - parallel_started, 3)

    batch_properties = {
        question_id.replace("-", "_"): flow._research_schema_for(
            plans[question_id], packets[question_id]
        )
        for question_id in selected_ids
    }
    batch_schema = _object(batch_properties)
    batch_prompt = EVIDENCE_RESEARCHER_PROMPT + """

You receive five independent investigation packets. Evaluate every packet separately.
Never use a page, passage, winner, or claim from one packet in another. Return one
result under each matching packet key in the required JSON object.
"""
    batch_started = time.perf_counter()
    raw_batch = flow._call_json(
        "single_batch", "five_questions", batch_prompt,
        {question_id.replace("-", "_"): packet for question_id, packet in packets.items()},
        batch_schema,
    )
    batch_seconds = round(time.perf_counter() - batch_started, 3)
    batch = {
        question_id: raw_batch.get(question_id.replace("-", "_"), {})
        for question_id in selected_ids
    }

    validation = {
        question_id: {
            "individual_errors": validate_packet(individual[question_id], packets[question_id]),
            "batch_errors": validate_packet(batch[question_id], packets[question_id]),
            "individual_status": individual[question_id].get("status"),
            "batch_status": batch[question_id].get("status"),
            "same_status": individual[question_id].get("status") == batch[question_id].get("status"),
            "same_competitor_page": individual[question_id].get("competitor_page_id") == batch[question_id].get("competitor_page_id"),
            "same_audited_page": individual[question_id].get("audited_page_id") == batch[question_id].get("audited_page_id"),
        }
        for question_id in selected_ids
    }
    summary = {
        "question_ids": selected_ids,
        "parallel_individual_seconds": parallel_seconds,
        "single_batch_seconds": batch_seconds,
        "seconds_saved": round(parallel_seconds - batch_seconds, 3),
        "individual_valid": sum(not item["individual_errors"] for item in validation.values()),
        "batch_valid": sum(not item["batch_errors"] for item in validation.values()),
        "same_status": sum(item["same_status"] for item in validation.values()),
        "same_competitor_page": sum(item["same_competitor_page"] for item in validation.values()),
        "same_audited_page": sum(item["same_audited_page"] for item in validation.values()),
    }
    flow._write("parallel_individual_results.json", individual)
    flow._write("single_batch_results.json", batch)
    flow._write("validation_comparison.json", validation)
    flow._write("comparison_summary.json", summary)
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
