from __future__ import annotations

import argparse
import json
from pathlib import Path
import time
from typing import Any

from geo_audit.aggregation import build_user_keys
from geo_audit.audit_recommendations import hydrate_writer_page, meaningful_text
from geo_audit.report_context import (
    anonymous_assistant_labels,
    build_company_blocks,
    build_question_rows,
)

from .flow import PLAN_SCHEMA, RESEARCH_SCHEMA, WRITER_SCHEMA, VerifiedGapFlow, _object
from .prompts import (
    EVIDENCE_RESEARCHER_PROMPT,
    FINAL_WRITER_PROMPT,
    INVESTIGATION_PLANNER_PROMPT,
)


STRING_ARRAY = {"type": "array", "items": {"type": "string"}}
COMBINED_REVIEW_SCHEMA = _object(
    {
        "items": {
            "type": "array",
            "items": _object(
                {
                    "evidence_id": {"type": "string"},
                    "actionable": {"type": "boolean"},
                    "selected": {"type": "boolean"},
                    "safe_action_scope": {"type": "string"},
                    "supported_target_capabilities": {
                        "type": "array",
                        "items": _object(
                            {
                                "capability": {"type": "string"},
                                "supporting_passage_id": {"type": "string"},
                            }
                        ),
                    },
                    "forbidden_assumptions": STRING_ARRAY,
                    "grouped_evidence_ids": STRING_ARRAY,
                    "reason": {"type": "string"},
                }
            ),
        }
    }
)

COMBINED_REVIEW_PROMPT = """
Review up to five verified public-information gaps for a GEO audit.

For each gap, decide whether it supports an honest website or public-visibility
action. Competitor evidence proves only what the competitor communicates. It never
proves that the audited company has the same capability. Mark a gap actionable only
when the audited-company excerpts positively support a useful communication,
documentation, positioning, proof, structure, or discoverability change.

For an actionable gap, write a narrow safe action scope. Every feature, workflow,
example, metric, template, or outcome in that scope must be positively stated in an
audited-company excerpt. List each supported capability and its exact passage ID.
List assumptions the writer must avoid. Reject a gap whose only honest action is to
document a limitation or recommend another vendor.

Also remove duplicate gaps. Select only actionable records with meaningfully
different buyer needs, audited-company pages, and actions. Group records with the
same underlying problem. Do not force a target count. Do not write the final report.
Use only supplied IDs and return only the required JSON.
""".strip()


class OptimizedVerifiedGapFlow(VerifiedGapFlow):
    """Five-question flow with parallel research and one combined review."""

    def run(self) -> dict[str, Any]:
        total_started = time.perf_counter()
        self.output_dir.mkdir(parents=True, exist_ok=True)
        profile = self._read("company_profile.json")
        patterns = self._read("recommendation_patterns.json")
        competitor_evidence = self._read("competitor_evidence.json")
        raw_results = self._read("ai_recommendations_raw.json")
        user_snapshot = self._read("website_snapshot.json")
        web_presence = self._read("web_presence.json")
        audited_company = str(profile.get("company_name", "")).strip()
        aliases = patterns.get("company_name_groups") or {}
        user_keys = build_user_keys(audited_company, profile.get("company_name_variants"))
        rows = build_question_rows(raw_results, audited_company, user_keys, aliases)
        pages, blocks = build_company_blocks(
            profile,
            competitor_evidence,
            patterns,
            raw_results,
            user_snapshot=user_snapshot,
            web_presence=web_presence,
        )
        labels = anonymous_assistant_labels(raw_results)
        matrix = self._loss_matrix(rows, raw_results, labels, pages, blocks, audited_company)
        eligible = [item for item in matrix if item["eligible"]]
        eligible.sort(
            key=lambda item: (
                item["audited_company_recommendation_count"],
                -int(item["primary_winner"]["recommendation_count"]),
                item["question_id"],
            )
        )
        candidates = eligible[:5]
        for item in candidates:
            item["buyer_need"] = item["question"]
        self._write("loss_matrix.json", matrix)

        investigations: dict[str, dict[str, Any]] = {}
        for item in candidates:
            winner = item["primary_winner"]
            winner_name = str(winner["company"])
            investigations[item["question_id"]] = {
                "investigation_id": f"inv-{len(investigations) + 1:02d}",
                "question_id": item["question_id"],
                "question": item["question"],
                "buyer_need": item["question"],
                "audited_company": audited_company,
                "audited_company_recommendation_count": item["audited_company_recommendation_count"],
                "winner_company": winner_name,
                "winner_recommendation_count": winner["recommendation_count"],
                "assistant_reasons": [
                    reason for reason in item["assistant_reasons"]
                    if self._matching_company(reason["company"], winner_name)
                ],
                "winner_cited_page_ids": item["winner_cited_page_ids"].get(winner_name, []),
            }
        self._write("selected_investigations.json", list(investigations.values()))
        audited_inventory = self._inventory_rows(blocks.get(audited_company, {}))

        def plan_one(question_id: str) -> tuple[str, dict[str, Any]]:
            investigation = investigations[question_id]
            winner_name = investigation["winner_company"]
            competitor_inventory = self._inventory_rows(blocks.get(winner_name, {}))
            cited = set(investigation["winner_cited_page_ids"])
            competitor_inventory.sort(
                key=lambda item: (
                    item["page_id"] not in cited,
                    item["source_type"] != "own_website",
                )
            )
            plan = self._call_json(
                "parallel_page_selection",
                question_id,
                INVESTIGATION_PLANNER_PROMPT,
                {
                    "observed_loss": investigation,
                    "competitor_page_inventory": competitor_inventory[:40],
                    "audited_company_page_inventory": audited_inventory[:40],
                },
                PLAN_SCHEMA,
            )
            allowed_competitor = {item["page_id"] for item in competitor_inventory}
            allowed_audited = {item["page_id"] for item in audited_inventory}
            plan["competitor_page_ids"] = list(dict.fromkeys(
                page_id for page_id in plan.get("competitor_page_ids", [])
                if page_id in allowed_competitor
            ))
            plan["audited_page_ids"] = list(dict.fromkeys(
                page_id for page_id in plan.get("audited_page_ids", [])
                if page_id in allowed_audited
            ))
            if not plan["competitor_page_ids"] or not plan["audited_page_ids"]:
                raise RuntimeError(f"No valid two-sided page plan for {question_id}")
            plan["question_id"] = question_id
            plan["winner_company"] = winner_name
            return question_id, plan

        plans = self._stage(
            "parallel_page_selection",
            lambda: self._run_parallel(list(investigations), plan_one),
        )
        self._write("investigation_plans.json", plans)
        selected_page_ids = list(dict.fromkeys(
            page_id
            for plan in plans.values()
            for field in ("competitor_page_ids", "audited_page_ids")
            for page_id in plan[field]
        ))

        def hydrate(page_id: str) -> tuple[str, dict[str, Any]]:
            page = hydrate_writer_page(dict(pages[page_id]), self._firecrawl)
            page["page_id"] = page_id
            return page_id, page

        opened = self._stage(
            "parallel_page_loading",
            lambda: self._run_parallel(selected_page_ids, hydrate),
        )
        pages.update(opened)
        self._write(
            "opened_pages.json",
            {
                page_id: {
                    "company_name": page.get("company_name"),
                    "url": page.get("url"),
                    "title": page.get("title"),
                    "has_content": meaningful_text(page.get("text")),
                    "text_length": len(str(page.get("text", ""))),
                }
                for page_id, page in opened.items()
            },
        )

        passage_store: dict[str, dict[str, str]] = {}
        research_inputs: dict[str, dict[str, Any]] = {}
        for question_id, investigation in investigations.items():
            plan = plans[question_id]
            query = " ".join(
                [
                    investigation["question"],
                    *plan.get("hypotheses", []),
                    *(reason["reason"] for reason in investigation["assistant_reasons"]),
                ]
            )
            packets = []
            for page_id in plan["competitor_page_ids"] + plan["audited_page_ids"]:
                page = pages[page_id]
                passages = self._relevant_passages(page, query)
                for passage in passages:
                    passage_store[passage["passage_id"]] = passage
                packets.append(
                    {
                        "page_id": page_id,
                        "company_name": page.get("company_name"),
                        "url": page.get("url"),
                        "title": page.get("title"),
                        "passages": passages,
                    }
                )
            research_inputs[question_id] = {
                "observed_loss": investigation,
                "hypotheses_to_test": plan.get("hypotheses", []),
                "opened_page_passages": packets,
            }
        self._write("passage_store.json", passage_store)
        self._write("research_inputs.json", research_inputs)

        def research_one(question_id: str) -> tuple[str, dict[str, Any]]:
            schema = self._research_schema_for(plans[question_id], research_inputs[question_id])
            result = self._call_json(
                "parallel_evidence_comparison",
                question_id,
                EVIDENCE_RESEARCHER_PROMPT,
                research_inputs[question_id],
                schema,
            )
            errors = self._validate_research(
                result,
                investigations[question_id],
                plans[question_id],
                pages,
                passage_store,
                audited_company,
            )
            if errors:
                result = self._call_json(
                    "evidence_correction",
                    question_id,
                    EVIDENCE_RESEARCHER_PROMPT
                    + "\n\nCorrect the supplied validation errors once. Reject the gap if correction is impossible.",
                    {
                        **research_inputs[question_id],
                        "previous_output": result,
                        "validation_errors": errors,
                    },
                    schema,
                )
            return question_id, result

        research_results = self._stage(
            "parallel_evidence_comparison",
            lambda: self._run_parallel(list(investigations), research_one),
        )
        self._write("research_results.json", research_results)
        evidence_records: list[dict[str, Any]] = []
        validation: dict[str, Any] = {}
        for question_id, result in research_results.items():
            errors = self._validate_research(
                result,
                investigations[question_id],
                plans[question_id],
                pages,
                passage_store,
                audited_company,
            )
            accepted = result.get("status") == "SUPPORTED_GAP" and not errors
            validation[question_id] = {
                "accepted": accepted,
                "status": result.get("status"),
                "errors": errors,
                "rejection_reason": result.get("rejection_reason", ""),
            }
            if not accepted:
                continue
            competitor_page = pages[result["competitor_page_id"]]
            audited_page = pages[result["audited_page_id"]]
            evidence_records.append(
                {
                    "evidence_id": f"ev-{len(evidence_records) + 1:02d}",
                    **investigations[question_id],
                    "buyer_need": result.get("buyer_need") or investigations[question_id]["question"],
                    "status": result["status"],
                    "gap_type": result["gap_type"],
                    "gap_kind": result["gap_kind"],
                    "confidence": result["confidence"],
                    "competitor_evidence": {
                        "page_id": result["competitor_page_id"],
                        "url": competitor_page.get("url", ""),
                        "title": competitor_page.get("title", ""),
                        "passage_ids": result["competitor_passage_ids"],
                        "excerpts": [
                            passage_store[passage_id]["text"]
                            for passage_id in result["competitor_passage_ids"]
                        ],
                        "what_it_proves": result["competitor_proof"],
                    },
                    "audited_company_evidence": {
                        "page_id": result["audited_page_id"],
                        "url": audited_page.get("url", ""),
                        "title": audited_page.get("title", ""),
                        "passage_ids": result["audited_passage_ids"],
                        "excerpts": [
                            passage_store[passage_id]["text"]
                            for passage_id in result["audited_passage_ids"]
                        ],
                        "what_it_proves": result["audited_company_proof"],
                    },
                    "direct_difference": result["direct_difference"],
                    "buyer_need_connection": result["buyer_need_connection"],
                }
            )
        self._write("research_validation.json", validation)
        self._write("verified_evidence_records.json", evidence_records)
        if not evidence_records:
            raise RuntimeError("No evidence-backed gaps passed validation.")

        review = self._stage(
            "combined_safety_and_deduplication",
            lambda: self._call_json(
                "combined_safety_and_deduplication",
                "all",
                COMBINED_REVIEW_PROMPT,
                {
                    "audited_company": audited_company,
                    "verified_evidence_records": [
                        self._compact_evidence(record) for record in evidence_records
                    ],
                },
                COMBINED_REVIEW_SCHEMA,
            ),
        )
        by_id = {record["evidence_id"]: record for record in evidence_records}
        selected = []
        seen_pages: set[str] = set()
        for item in review.get("items", []) or []:
            evidence_id = str(item.get("evidence_id", ""))
            record = by_id.get(evidence_id)
            if not record or not item.get("actionable") or not item.get("selected"):
                continue
            allowed = set(record["audited_company_evidence"]["passage_ids"])
            if any(
                str(capability.get("supporting_passage_id", "")) not in allowed
                for capability in item.get("supported_target_capabilities", []) or []
            ):
                continue
            page_id = str(record["audited_company_evidence"]["page_id"])
            if page_id in seen_pages:
                continue
            seen_pages.add(page_id)
            selected.append(
                {
                    **record,
                    "actionability": item,
                    "grouped_evidence_ids": item.get("grouped_evidence_ids", []),
                }
            )
        self._write("combined_review.json", {"model_output": review, "selected": selected})
        if not selected:
            raise RuntimeError("No safe, distinct gaps survived the combined review.")

        writer_input = {
            "audited_company": audited_company,
            "number_to_write": len(selected),
            "verified_gaps": [self._compact_evidence(record) for record in selected],
        }
        writer = self._stage(
            "final_writing",
            lambda: self._call_json(
                "final_writing", "all", FINAL_WRITER_PROMPT, writer_input, WRITER_SCHEMA
            ),
        )
        expected_ids = [record["evidence_id"] for record in selected]
        actual_ids = [
            str(item.get("evidence_id", ""))
            for item in writer.get("recommendations", []) or []
        ]
        if actual_ids != expected_ids:
            raise RuntimeError("Final writer changed or omitted selected evidence IDs.")
        selected_by_id = {record["evidence_id"]: record for record in selected}
        final_items = []
        for item in writer.get("recommendations", []) or []:
            record = selected_by_id[item["evidence_id"]]
            item["suggested_change"] = record["actionability"]["safe_action_scope"]
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
        final = {
            "audited_company": audited_company,
            "recommendations": final_items,
            "summary": writer.get("summary", ""),
        }
        self._write("final_recommendations.json", final)
        self.timings["total"] = round(time.perf_counter() - total_started, 3)
        self._write("stage_timings.json", self.timings)
        summary = {
            "audited_company": audited_company,
            "eligible_losses": len(eligible),
            "investigations": len(investigations),
            "verified_gaps": len(evidence_records),
            "recommendations": len(final_items),
            "llm_calls": len(self.llm_calls),
            "total_seconds": self.timings["total"],
            "production_files_modified": False,
        }
        self._write("run_summary.json", summary)
        return summary


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the optimized five-question flow.")
    parser.add_argument("--source-run", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--model", default="gpt-5-mini")
    args = parser.parse_args()
    flow = OptimizedVerifiedGapFlow(
        args.source_run,
        args.output_dir,
        candidate_count=5,
        max_workers=5,
        model=args.model,
    )
    try:
        summary = flow.run()
    except Exception as exc:
        args.output_dir.mkdir(parents=True, exist_ok=True)
        failure = {"status": "failed", "error": f"{type(exc).__name__}: {exc}"}
        (args.output_dir / "failure.json").write_text(json.dumps(failure, indent=2), encoding="utf-8")
        print(json.dumps(failure, indent=2))
        return 1
    print(json.dumps({"status": "complete", **summary}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
