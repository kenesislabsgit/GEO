from __future__ import annotations

import argparse
import json
from pathlib import Path
import time

from .flow import (
    ACTIONABILITY_SCHEMA,
    CRITIC_SCHEMA,
    SELECT_SCHEMA,
    WRITER_SCHEMA,
    VerifiedGapFlow,
)
from .prompts import (
    ACTIONABILITY_EVALUATOR_PROMPT,
    CRITIC_PROMPT,
    FINAL_WRITER_PROMPT,
    GAP_SELECTOR_PROMPT,
)


def main() -> int:
    parser = argparse.ArgumentParser(description="Recheck saved evidence with the final stages.")
    parser.add_argument("--evidence-run", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--model", default="gpt-5-mini")
    args = parser.parse_args()
    started = time.perf_counter()
    records = json.loads(
        (args.evidence_run / "verified_evidence_records.json").read_text(encoding="utf-8")
    )
    audited_company = str(records[0].get("audited_company", ""))
    flow = VerifiedGapFlow(args.evidence_run, args.output_dir, model=args.model)

    actionability = flow._stage(
        "actionability_evaluation",
        lambda: flow._call_json(
            "actionability_evaluation",
            "all",
            ACTIONABILITY_EVALUATOR_PROMPT,
            {
                "audited_company": audited_company,
                "verified_evidence_records": [flow._compact_evidence(record) for record in records],
            },
            ACTIONABILITY_SCHEMA,
        ),
    )
    evaluations = {
        str(item.get("evidence_id", "")): item for item in actionability.get("items", [])
    }
    actionable = []
    for record in records:
        evaluation = evaluations.get(record["evidence_id"], {})
        allowed = set(record["audited_company_evidence"]["passage_ids"])
        ids_are_valid = all(
            str(item.get("supporting_passage_id", "")) in allowed
            for item in evaluation.get("supported_target_capabilities", []) or []
        )
        if evaluation.get("actionable") and ids_are_valid:
            actionable.append({**record, "actionability": evaluation})
    flow._write("actionability_evaluation.json", {"model_output": actionability, "actionable_records": actionable})
    if not actionable:
        raise RuntimeError("No safe actions were supported.")

    selection = flow._stage(
        "gap_selection",
        lambda: flow._call_json(
            "gap_selection",
            "all",
            GAP_SELECTOR_PROMPT,
            {
                "audited_company": audited_company,
                "verified_evidence_records": [flow._compact_evidence(record) for record in actionable],
            },
            SELECT_SCHEMA,
        ),
    )
    by_id = {record["evidence_id"]: record for record in actionable}
    selected = []
    seen_pages: set[str] = set()
    for item in selection.get("selected", []) or []:
        record = by_id.get(str(item.get("evidence_id", "")))
        if not record:
            continue
        page_id = str(record["audited_company_evidence"].get("page_id", ""))
        if page_id in seen_pages:
            continue
        seen_pages.add(page_id)
        selected.append(
            {
                **record,
                "grouped_evidence_ids": item.get("grouped_evidence_ids", []),
                "selection_reason": item.get("selection_reason", ""),
            }
        )
    selected = selected[:5]
    flow._write("gap_selection.json", {"model_output": selection, "selected": selected})
    if not selected:
        raise RuntimeError("No distinct gaps were selected.")

    writer_input = {
        "audited_company": audited_company,
        "number_to_write": len(selected),
        "verified_gaps": [flow._compact_evidence(record) for record in selected],
    }
    writer = flow._stage(
        "final_writing",
        lambda: flow._call_json(
            "final_writing", "all", FINAL_WRITER_PROMPT, writer_input, WRITER_SCHEMA
        ),
    )
    selected_by_id = {record["evidence_id"]: record for record in selected}
    for item in writer.get("recommendations", []) or []:
        record = selected_by_id.get(str(item.get("evidence_id", "")))
        if record:
            item["suggested_change"] = record["actionability"]["safe_action_scope"]
    critic_input = {
        "verified_gaps": [flow._compact_evidence(record) for record in selected],
        "recommendations": writer.get("recommendations", []),
    }
    critic = flow._stage(
        "recommendation_critique",
        lambda: flow._call_json(
            "recommendation_critique", "all", CRITIC_PROMPT, critic_input, CRITIC_SCHEMA
        ),
    )
    final_items = []
    for item in writer.get("recommendations", []) or []:
        record = selected_by_id.get(str(item.get("evidence_id", "")))
        if not record:
            continue
        final_items.append(
            {
                **item,
                "question_id": record["question_id"],
                "question": record["question"],
                "winner_company": record["winner_company"],
                "gap_type": record["gap_type"],
                "evidence": {
                    "competitor": record["competitor_evidence"],
                    "audited_company": record["audited_company_evidence"],
                },
            }
        )
    result = {
        "audited_company": audited_company,
        "recommendations": final_items,
        "summary": writer.get("summary", ""),
        "critic": critic,
    }
    flow._write("writer_output.json", writer)
    flow._write("recommendation_critique.json", critic)
    flow._write("final_recommendations.json", result)
    summary = {
        "source_verified_gaps": len(records),
        "actionable_gaps": len(actionable),
        "recommendations": len(final_items),
        "critic_passed": bool(critic.get("all_passed")),
        "llm_calls": len(flow.llm_calls),
        "seconds": round(time.perf_counter() - started, 3),
    }
    flow._write("run_summary.json", summary)
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
