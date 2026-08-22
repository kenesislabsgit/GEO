from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
import json
from pathlib import Path
import re
from threading import Lock
import time
from typing import Any, Callable
from urllib.parse import urlparse

from geo_audit.aggregation import build_user_keys
from geo_audit.audit_recommendations import hydrate_writer_page, meaningful_text, normalize_name
from geo_audit.firecrawl import FirecrawlClient
from geo_audit.json_tools import extract_json_object
from geo_audit.llm import build_chat_payload, call_chat_message
from geo_audit.report_context import (
    anonymous_assistant_labels,
    build_company_blocks,
    build_question_rows,
    open_question,
)

from .prompts import (
    CAPABILITY_VERIFIER_PROMPT,
    DEDUPE_SELECTOR_PROMPT,
    EVIDENCE_JUDGE_PROMPT,
    FINAL_EVALUATOR_PROMPT,
    FINAL_WRITER_PROMPT,
    PAGE_PLANNER_PROMPT,
    QUESTION_SELECTOR_PROMPT,
    REPAIR_PROMPT,
)


def _object(properties: dict[str, Any], required: list[str] | None = None) -> dict[str, Any]:
    return {
        "type": "object",
        "properties": properties,
        "required": required or list(properties),
        "additionalProperties": False,
    }


STRING_ARRAY = {"type": "array", "items": {"type": "string"}}

SELECTOR_SCHEMA = _object(
    {
        "groups": {
            "type": "array",
            "minItems": 5,
            "maxItems": 12,
            "items": _object(
                {
                    "buyer_need": {"type": "string"},
                    "question_ids": {
                        "type": "array",
                        "items": {"type": "string"},
                        "minItems": 1,
                    },
                    "selected_question_id": {"type": "string"},
                    "why_selected": {"type": "string"},
                }
            ),
        }
    }
)

PAGE_PLAN_SCHEMA = _object(
    {
        "question_id": {"type": "string"},
        "competitor_page_ids": {
            "type": "array",
            "items": {"type": "string"},
            "minItems": 1,
            "maxItems": 3,
        },
        "audited_page_ids": {
            "type": "array",
            "items": {"type": "string"},
            "minItems": 1,
            "maxItems": 3,
        },
        "planning_reason": {"type": "string"},
    }
)

JUDGMENT_SCHEMA = _object(
    {
        "valid": {"type": "boolean"},
        "question_id": {"type": "string"},
        "competitor_name": {"type": "string"},
        "competitor_page_id": {"type": "string"},
        "audited_page_id": {"type": "string"},
        "competitor_quote": {"type": "string"},
        "audited_company_quote": {"type": "string"},
        "competitor_proof": {"type": "string"},
        "audited_company_proof": {"type": "string"},
        "proven_gap": {"type": "string"},
        "action_type": {
            "type": "string",
            "enum": ["create", "update", "rename", "reposition", "link", "external_visibility"],
        },
        "target": {"type": "string"},
        "specific_action": {"type": "string"},
        "improvement_domain": {
            "type": "string",
            "enum": [
                "capability_explanation",
                "use_case_content",
                "buyer_proof",
                "pricing_and_packaging",
                "comparison_content",
                "technical_discoverability",
                "integration_content",
                "external_authority",
                "terminology_and_positioning",
                "workflow_education",
            ],
        },
        "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
        "rejection_reason": {"type": "string"},
    }
)

DEDUPE_SCHEMA = _object(
    {
        "selected": {
            "type": "array",
            "minItems": 5,
            "maxItems": 5,
            "items": _object(
                {
                    "bundle_id": {"type": "string"},
                    "grouped_question_ids": STRING_ARRAY,
                    "distinct_reason": {"type": "string"},
                }
            ),
        },
        "rejected": {
            "type": "array",
            "items": _object(
                {"bundle_id": {"type": "string"}, "reason": {"type": "string"}}
            ),
        },
    }
)

RECOMMENDATION_ITEM_SCHEMA = _object(
    {
        "bundle_id": {"type": "string"},
        "observation": {"type": "string"},
        "suggested_change": {"type": "string"},
        "why_this_action": {"type": "string"},
        "expected_impact": {"type": "string"},
        "improvement_domain": {"type": "string"},
        "capability_claims": {
            "type": "array",
            "items": {"type": "string"},
            "minItems": 1,
            "maxItems": 5,
        },
        "confidence": {"type": "string", "enum": ["high", "medium"]},
        "competitor_page_id": {"type": "string"},
        "audited_page_id": {"type": "string"},
        "affected_question_ids": STRING_ARRAY,
    }
)

WRITER_SCHEMA = _object(
    {
        "recommendations": {
            "type": "array",
            "minItems": 5,
            "maxItems": 5,
            "items": RECOMMENDATION_ITEM_SCHEMA,
        },
        "summary": {"type": "string"},
    }
)

EVALUATOR_SCHEMA = _object(
    {
        "all_passed": {"type": "boolean"},
        "items": {
            "type": "array",
            "minItems": 5,
            "maxItems": 5,
            "items": _object(
                {
                    "bundle_id": {"type": "string"},
                    "passed": {"type": "boolean"},
                    "errors": STRING_ARRAY,
                    "feedback": {"type": "string"},
                    "claim_checks": {
                        "type": "array",
                        "items": _object(
                            {
                                "claim": {"type": "string"},
                                "supported": {"type": "boolean"},
                                "audited_page_id": {"type": "string"},
                                "supporting_quote": {"type": "string"},
                            }
                        ),
                    },
                }
            ),
        },
        "duplicate_pairs": {
            "type": "array",
            "items": _object(
                {
                    "first_bundle_id": {"type": "string"},
                    "second_bundle_id": {"type": "string"},
                    "reason": {"type": "string"},
                }
            ),
        },
    }
)

REPAIR_SCHEMA = _object(
    {
        "recommendations": {"type": "array", "items": RECOMMENDATION_ITEM_SCHEMA}
    }
)

CAPABILITY_VERIFIER_SCHEMA = _object(
    {
        "safe": {"type": "boolean"},
        "assumed_capabilities": {
            "type": "array",
            "minItems": 1,
            "items": _object(
                {
                    "claim": {"type": "string"},
                    "asserted_as_real": {"type": "boolean"},
                    "supported": {"type": "boolean"},
                    "reason": {"type": "string"},
                    "supporting_quote": {"type": "string"},
                }
            ),
        },
    }
)


class StructuredWriterFlow:
    """Evidence-first final-writer experiment; it never writes production data."""

    def __init__(
        self,
        source_run: Path,
        output_dir: Path,
        *,
        candidate_count: int = 10,
        max_workers: int = 5,
        llm_call: Callable[[dict[str, Any]], dict[str, Any]] = call_chat_message,
    ) -> None:
        self.source_run = Path(source_run).resolve()
        self.output_dir = Path(output_dir).resolve()
        self.candidate_count = max(5, min(candidate_count, 12))
        self.max_workers = max(1, min(max_workers, 8))
        self.llm_call = llm_call
        self.llm_calls: list[dict[str, Any]] = []
        self.timings: dict[str, float] = {}
        self._trace_lock = Lock()
        self._firecrawl = FirecrawlClient.from_environment()

    def _read(self, name: str) -> Any:
        with (self.source_run / name).open(encoding="utf-8") as handle:
            return json.load(handle)

    def _write(self, name: str, value: Any) -> None:
        self.output_dir.mkdir(parents=True, exist_ok=True)
        with (self.output_dir / name).open("w", encoding="utf-8") as handle:
            json.dump(value, handle, indent=2, ensure_ascii=False)

    def _stage(self, name: str, operation: Callable[[], Any]) -> Any:
        started = time.perf_counter()
        try:
            return operation()
        finally:
            self.timings[name] = round(time.perf_counter() - started, 3)
            self._write("stage_timings.json", self.timings)

    def _call_json(
        self,
        stage: str,
        key: str,
        system_prompt: str,
        data: Any,
        schema: dict[str, Any],
    ) -> dict[str, Any]:
        user_prompt = json.dumps(data, separators=(",", ":"), ensure_ascii=False)
        payload = build_chat_payload(system_prompt, user_prompt, temperature=0.1, json_response=True)
        safe_name = re.sub(r"[^a-z0-9_]+", "_", f"{stage}_{key}".lower()).strip("_")
        payload["response_format"] = {
            "type": "json_schema",
            "json_schema": {"name": safe_name[:60], "strict": True, "schema": schema},
        }
        started = time.perf_counter()
        error = ""
        raw = ""
        parsed: dict[str, Any] = {}
        try:
            message = self.llm_call(payload)
            raw = str(message.get("content") or "")
            parsed = extract_json_object(raw)
            return parsed
        except Exception as exc:
            error = f"{type(exc).__name__}: {exc}"
            raise
        finally:
            record = {
                "stage": stage,
                "key": key,
                "seconds": round(time.perf_counter() - started, 3),
                "model": payload.get("model"),
                "system_prompt": system_prompt,
                "input": data,
                "raw_output": raw,
                "parsed_output": parsed,
                "error": error,
            }
            with self._trace_lock:
                self.llm_calls.append(record)
                self._write("llm_calls.json", self.llm_calls)

    @staticmethod
    def _inventory_rows(block: dict[str, Any]) -> list[dict[str, str]]:
        rows: list[dict[str, str]] = []
        seen: set[str] = set()
        for group in (
            "pages_on_their_own_website",
            "pages_the_assistants_cited_while_answering",
            "pages_the_wider_internet_holds_about_them",
        ):
            for page in block.get(group, []) or []:
                page_id = str(page.get("page_id", ""))
                if not page_id or page_id in seen:
                    continue
                seen.add(page_id)
                rows.append(
                    {
                        "page_id": page_id,
                        "url": str(page.get("url", "")),
                        "title": str(page.get("title", "")),
                        "source_group": group,
                    }
                )
        return rows

    @staticmethod
    def _matching_company(name: str, candidate: str) -> bool:
        left, right = normalize_name(name), normalize_name(candidate)
        return bool(left and right and (left == right or left in right or right in left))

    def _question_card(
        self,
        row: dict[str, Any],
        question_detail: dict[str, Any],
        pages: dict[str, dict[str, Any]],
        blocks: dict[str, dict[str, Any]],
        audited_company: str,
    ) -> dict[str, Any]:
        winners = [item for item in row.get("who_was_named", []) if item.get("company")]
        winner_names = [str(item["company"]) for item in winners]
        cited_by_winner: dict[str, list[str]] = {name: [] for name in winner_names}
        answer_reasons: list[dict[str, Any]] = []
        for answer in question_detail.get("answers", []) or []:
            for named in answer.get("companies_it_named", []) or []:
                company = str(named.get("company", ""))
                matched = next((name for name in winner_names if self._matching_company(name, company)), "")
                if not matched:
                    continue
                ids = [page_id for page_id in named.get("assistant_cited_page_ids", []) if page_id in pages]
                for page_id in ids:
                    if page_id not in cited_by_winner[matched]:
                        cited_by_winner[matched].append(page_id)
                reason = str(named.get("reason", "")).strip()
                if reason and len(answer_reasons) < 10:
                    answer_reasons.append(
                        {"company": matched, "position": named.get("position"), "reason": reason, "page_ids": ids}
                    )

        own_ids = [row["page_id"] for row in self._inventory_rows(blocks.get(audited_company, {}))]
        competitor_ids: list[str] = []
        # Put pages cited for this exact question first. Generic company pages
        # remain available afterwards, but cannot push the question-specific
        # evidence out of the bounded planner input.
        for winner in winner_names:
            competitor_ids.extend(cited_by_winner.get(winner, []))
        for winner in winner_names:
            for block_name, block in blocks.items():
                if block_name == audited_company or not self._matching_company(winner, block_name):
                    continue
                competitor_ids.extend(row["page_id"] for row in self._inventory_rows(block))
        competitor_ids = list(dict.fromkeys(page_id for page_id in competitor_ids if page_id in pages))
        return {
            **row,
            "winners": winners,
            "assistant_reasons": answer_reasons,
            "winner_cited_page_ids": cited_by_winner,
            "available_competitor_page_ids": competitor_ids,
            "available_audited_page_ids": own_ids,
            "has_two_sided_evidence": bool(competitor_ids and own_ids),
        }

    def _planner_input(
        self,
        card: dict[str, Any],
        pages: dict[str, dict[str, Any]],
        audited_company: str,
    ) -> dict[str, Any]:
        def inventory(page_ids: list[str], limit: int) -> list[dict[str, str]]:
            result = []
            for page_id in page_ids[:limit]:
                page = pages[page_id]
                result.append(
                    {
                        "page_id": page_id,
                        "company_name": str(page.get("company_name", "")),
                        "url": str(page.get("url", "")),
                        "title": str(page.get("title", "")),
                    }
                )
            return result

        return {
            "audited_company": audited_company,
            "question": {
                "question_id": card["question_id"],
                "text": card["question"],
                "category": card.get("category", ""),
                "audited_company_mentions": card.get("answers_naming_the_company", 0),
                "winners": card.get("winners", []),
                "assistant_reasons": card.get("assistant_reasons", []),
            },
            "competitor_page_inventory": inventory(card["available_competitor_page_ids"], 30),
            "audited_company_page_inventory": inventory(card["available_audited_page_ids"], 30),
        }

    @staticmethod
    def _page_for_judge(page: dict[str, Any]) -> dict[str, Any]:
        text = str(page.get("text", ""))
        return {
            "page_id": page.get("page_id"),
            "company_name": page.get("company_name"),
            "url": page.get("url"),
            "title": page.get("title"),
            "text": text[:12000],
            "text_truncated": len(text) > 12000,
            "fetch_provider": page.get("fetch_provider", "stored"),
        }

    def _validate_bundle(
        self,
        judgment: dict[str, Any],
        plan: dict[str, Any],
        pages: dict[str, dict[str, Any]],
        audited_company: str,
    ) -> tuple[bool, list[str]]:
        errors: list[str] = []
        corrections: list[dict[str, str]] = []
        for quote_field, id_field, plan_field in (
            ("competitor_quote", "competitor_page_id", "competitor_page_ids"),
            ("audited_company_quote", "audited_page_id", "audited_page_ids"),
        ):
            normalized_quote = " ".join(
                str(judgment.get(quote_field, "")).casefold().split()
            )
            if not normalized_quote:
                continue
            matching_ids = [
                page_id
                for page_id in plan.get(plan_field, [])
                if normalized_quote
                in " ".join(str(pages.get(page_id, {}).get("text", "")).casefold().split())
            ]
            current_id = str(judgment.get(id_field, ""))
            if current_id not in matching_ids and matching_ids:
                judgment[id_field] = matching_ids[0]
                corrections.append(
                    {"field": id_field, "from": current_id, "to": matching_ids[0]}
                )
        if corrections:
            judgment["deterministic_page_id_corrections"] = corrections
        competitor_id = str(judgment.get("competitor_page_id", ""))
        audited_id = str(judgment.get("audited_page_id", ""))
        if not judgment.get("valid"):
            errors.append(str(judgment.get("rejection_reason") or "AI judge rejected the evidence"))
        if competitor_id not in plan.get("competitor_page_ids", []):
            errors.append("competitor page was not opened for this bundle")
        if audited_id not in plan.get("audited_page_ids", []):
            errors.append("audited-company page was not opened for this bundle")
        competitor_page, audited_page = pages.get(competitor_id), pages.get(audited_id)
        if not competitor_page or not meaningful_text(competitor_page.get("text")):
            errors.append("competitor page has no usable content")
        if not audited_page or not meaningful_text(audited_page.get("text")):
            errors.append("audited-company page has no usable content")
        if competitor_page and self._matching_company(audited_company, str(competitor_page.get("company_name", ""))):
            errors.append("competitor evidence points to the audited company")
        if audited_page and not self._matching_company(audited_company, str(audited_page.get("company_name", ""))):
            errors.append("audited evidence belongs to another company")
        if judgment.get("confidence") == "low":
            errors.append("evidence confidence is low")
        for quote_field, page in (
            ("competitor_quote", competitor_page),
            ("audited_company_quote", audited_page),
        ):
            quote = str(judgment.get(quote_field, "")).strip()
            words = quote.split()
            if len(words) < 8 or len(words) > 60:
                errors.append(f"{quote_field} must contain 8 to 60 words")
            elif page:
                normalized_quote = " ".join(quote.casefold().split())
                normalized_page = " ".join(str(page.get("text", "")).casefold().split())
                if normalized_quote not in normalized_page:
                    errors.append(f"{quote_field} is not an exact passage from its page")
        for field in ("competitor_proof", "audited_company_proof", "proven_gap", "specific_action"):
            if len(str(judgment.get(field, "")).split()) < 4:
                errors.append(f"{field} is too weak")
        return not errors, errors

    @staticmethod
    def _validate_final(
        result: dict[str, Any], selected: list[dict[str, Any]], bundles: dict[str, dict[str, Any]]
    ) -> list[str]:
        errors: list[str] = []
        recommendations = result.get("recommendations", []) or []
        expected = [item["bundle_id"] for item in selected]
        actual = [str(item.get("bundle_id", "")) for item in recommendations]
        if len(recommendations) != 5:
            errors.append("writer did not return exactly five recommendations")
        if set(actual) != set(expected) or len(actual) != len(set(actual)):
            errors.append("writer changed, omitted, or duplicated bundle IDs")
        fingerprints: set[str] = set()
        for item in recommendations:
            bundle = bundles.get(str(item.get("bundle_id", "")))
            if not bundle:
                continue
            if item.get("competitor_page_id") != bundle.get("competitor_page_id"):
                errors.append(f"{item.get('bundle_id')}: competitor page ID changed")
            if item.get("audited_page_id") != bundle.get("audited_page_id"):
                errors.append(f"{item.get('bundle_id')}: audited page ID changed")
            if item.get("improvement_domain") != bundle.get("improvement_domain"):
                errors.append(f"{item.get('bundle_id')}: improvement domain changed")
            fingerprint = re.sub(r"[^a-z0-9]+", "", str(item.get("suggested_change", "")).lower())
            if fingerprint in fingerprints:
                errors.append("two suggested changes are identical")
            fingerprints.add(fingerprint)
            if not item.get("capability_claims"):
                errors.append(f"{item.get('bundle_id')}: no capability claims supplied")
        return errors

    def _ground_evaluation_claims(
        self,
        evaluation: dict[str, Any],
        recommendations: list[dict[str, Any]],
        pages: dict[str, dict[str, Any]],
        bundles: dict[str, dict[str, Any]],
        audited_company: str,
    ) -> dict[str, Any]:
        """Turn evaluator claim checks into deterministic pass/fail results."""
        items_by_id = {
            str(item.get("bundle_id", "")): item
            for item in evaluation.get("items", []) or []
        }
        normalized_items: list[dict[str, Any]] = []
        for recommendation in recommendations:
            bundle_id = str(recommendation.get("bundle_id", ""))
            item = items_by_id.get(
                bundle_id,
                {
                    "bundle_id": bundle_id,
                    "passed": False,
                    "errors": ["evaluator omitted this recommendation"],
                    "feedback": "",
                    "claim_checks": [],
                },
            )
            errors = list(item.get("errors", []) or [])
            expected_claims = [str(value).strip() for value in recommendation.get("capability_claims", []) if str(value).strip()]
            checks = item.get("claim_checks", []) or []
            checked_claims = [str(check.get("claim", "")).strip() for check in checks]
            if checked_claims != expected_claims:
                errors.append("evaluator did not check every capability claim in order")
            bundle = bundles.get(bundle_id, {})
            allowed_page_id = str(bundle.get("audited_page_id", ""))
            for check in checks:
                claim = str(check.get("claim", "")).strip()
                if not check.get("supported"):
                    errors.append(f"unsupported capability claim: {claim}")
                    continue
                page_id = str(check.get("audited_page_id", ""))
                quote = " ".join(str(check.get("supporting_quote", "")).casefold().split())
                page = pages.get(page_id)
                if page_id != allowed_page_id:
                    errors.append(f"claim used an unapproved audited page: {page_id}")
                if not page or not self._matching_company(audited_company, str(page.get("company_name", ""))):
                    errors.append(f"claim page does not belong to audited company: {page_id}")
                page_text = " ".join(str((page or {}).get("text", "")).casefold().split())
                if len(quote.split()) < 4 or quote not in page_text:
                    errors.append(f"claim has no exact audited-page support: {claim}")
            item["errors"] = list(dict.fromkeys(errors))
            item["passed"] = bool(item.get("passed")) and not item["errors"]
            normalized_items.append(item)
        evaluation["items"] = normalized_items
        evaluation["all_passed"] = all(item.get("passed") for item in normalized_items) and not evaluation.get("duplicate_pairs")
        return evaluation

    @staticmethod
    def _apply_independent_capability_checks(
        evaluation: dict[str, Any],
        checks_by_id: dict[str, dict[str, Any]],
        pages: dict[str, dict[str, Any]],
        bundles: dict[str, dict[str, Any]],
    ) -> dict[str, Any]:
        for item in evaluation.get("items", []) or []:
            bundle_id = str(item.get("bundle_id", ""))
            result = checks_by_id.get(bundle_id, {})
            errors = list(item.get("errors", []) or [])
            page_id = str(bundles.get(bundle_id, {}).get("audited_page_id", ""))
            page_text = " ".join(str(pages.get(page_id, {}).get("text", "")).casefold().split())
            capabilities = result.get("assumed_capabilities", []) or []
            if not capabilities:
                errors.append("independent verifier extracted no capability claims")
            for capability in capabilities:
                claim = str(capability.get("claim", "")).strip()
                asserted = bool(capability.get("asserted_as_real"))
                if asserted and not capability.get("supported"):
                    errors.append(f"independent verifier found unsupported capability: {claim}")
                    continue
                if not asserted:
                    continue
                quote = " ".join(str(capability.get("supporting_quote", "")).casefold().split())
                if len(quote.split()) < 4 or quote not in page_text:
                    errors.append(f"independent capability has no exact audited-page support: {claim}")
            if not result.get("safe"):
                errors.append("independent capability verifier marked the action unsafe")
            item["errors"] = list(dict.fromkeys(errors))
            item["passed"] = bool(item.get("passed")) and not item["errors"]
            item["independent_capability_check"] = result
        evaluation["all_passed"] = all(
            item.get("passed") for item in evaluation.get("items", []) or []
        ) and not evaluation.get("duplicate_pairs")
        return evaluation

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
        cards = [
            self._question_card(
                row,
                open_question(row["question_id"], rows, raw_results, labels, pages=pages),
                pages,
                blocks,
                audited_company,
            )
            for row in rows
        ]
        eligible_cards = [card for card in cards if card["has_two_sided_evidence"]]
        manifest = {
            "source_run": str(self.source_run),
            "experiment_output": str(self.output_dir),
            "audited_company": audited_company,
            "question_count": len(cards),
            "eligible_question_count": len(eligible_cards),
            "page_count": len(pages),
            "company_count": len(blocks),
            "candidate_count": self.candidate_count,
            "production_files_modified": False,
        }
        self._write("input_manifest.json", manifest)
        self._write("question_cards.json", cards)
        self._write("page_inventory.json", {"pages": pages, "company_blocks": blocks})

        selector_input = {
            "audited_company": audited_company,
            "number_to_select": self.candidate_count,
            "questions": [
                {
                    "question_id": card["question_id"],
                    "question": card["question"],
                    "category": card.get("category", ""),
                    "audited_company_mentions": card.get("answers_naming_the_company", 0),
                    "winners": card.get("winners", []),
                    "competitor_pages_available": len(card["available_competitor_page_ids"]),
                    "audited_pages_available": len(card["available_audited_page_ids"]),
                }
                for card in eligible_cards
            ],
        }
        selected_result = self._stage(
            "question_selection",
            lambda: self._call_json("question_selection", "all", QUESTION_SELECTOR_PROMPT, selector_input, SELECTOR_SCHEMA),
        )
        card_by_id = {card["question_id"]: card for card in eligible_cards}
        selected_ids = []
        selected_meta: dict[str, dict[str, Any]] = {}
        for item in selected_result.get("groups", []):
            question_id = str(item.get("selected_question_id", ""))
            if question_id in card_by_id and question_id not in selected_ids:
                selected_ids.append(question_id)
                selected_meta[question_id] = item
        selected_ids = selected_ids[: self.candidate_count]
        if len(selected_ids) < 5:
            raise RuntimeError("The selector returned fewer than five eligible questions.")
        self._write(
            "selected_gaps.json",
            {
                "model_output": selected_result,
                "accepted_question_ids": selected_ids,
                "accepted_buyer_needs": {
                    question_id: selected_meta[question_id].get("buyer_need", "")
                    for question_id in selected_ids
                },
            },
        )

        def plan_one(question_id: str) -> tuple[str, dict[str, Any]]:
            data = self._planner_input(card_by_id[question_id], pages, audited_company)
            data["question"]["buyer_need"] = selected_meta[question_id].get("buyer_need", "")
            result = self._call_json("page_planning", question_id, PAGE_PLANNER_PROMPT, data, PAGE_PLAN_SCHEMA)
            if result.get("question_id") != question_id:
                raise RuntimeError(f"Planner changed question ID {question_id}")
            allowed_competitor = set(card_by_id[question_id]["available_competitor_page_ids"])
            allowed_own = set(card_by_id[question_id]["available_audited_page_ids"])
            result["competitor_page_ids"] = list(dict.fromkeys(
                page_id for page_id in result.get("competitor_page_ids", []) if page_id in allowed_competitor
            ))
            result["audited_page_ids"] = list(dict.fromkeys(
                page_id for page_id in result.get("audited_page_ids", []) if page_id in allowed_own
            ))
            if not result["competitor_page_ids"] or not result["audited_page_ids"]:
                raise RuntimeError(f"Planner returned no valid two-sided pages for {question_id}")
            return question_id, result

        def run_parallel(values: list[str], operation: Callable[[str], tuple[str, Any]]) -> dict[str, Any]:
            collected: dict[str, Any] = {}
            with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
                futures = {executor.submit(operation, value): value for value in values}
                for future in as_completed(futures):
                    key, result = future.result()
                    collected[key] = result
            return {key: collected[key] for key in values if key in collected}

        plans = self._stage("page_planning", lambda: run_parallel(selected_ids, plan_one))
        self._write("page_plans.json", plans)

        selected_page_ids = list(dict.fromkeys(
            page_id
            for plan in plans.values()
            for side in ("competitor_page_ids", "audited_page_ids")
            for page_id in plan.get(side, [])
        ))

        def hydrate(page_id: str) -> tuple[str, dict[str, Any]]:
            return page_id, hydrate_writer_page(dict(pages[page_id]), self._firecrawl)

        opened = self._stage("page_hydration", lambda: run_parallel(selected_page_ids, hydrate))
        pages.update(opened)
        self._write("opened_pages.json", {page_id: self._page_for_judge(page) for page_id, page in opened.items()})

        def judge_input(question_id: str) -> dict[str, Any]:
            card, plan = card_by_id[question_id], plans[question_id]
            opened_ids = list(dict.fromkeys(plan["competitor_page_ids"] + plan["audited_page_ids"]))
            return {
                "audited_company": audited_company,
                "question": {
                    "question_id": question_id,
                    "text": card["question"],
                    "category": card.get("category", ""),
                    "buyer_need": selected_meta[question_id].get("buyer_need", ""),
                    "winners": card.get("winners", []),
                    "assistant_reasons": card.get("assistant_reasons", []),
                },
                "opened_pages": [self._page_for_judge(pages[page_id]) for page_id in opened_ids],
            }

        def judge_one(question_id: str) -> tuple[str, dict[str, Any]]:
            data = judge_input(question_id)
            return question_id, self._call_json("evidence_judging", question_id, EVIDENCE_JUDGE_PROMPT, data, JUDGMENT_SCHEMA)

        judgments = self._stage("evidence_judging", lambda: run_parallel(selected_ids, judge_one))
        self._write("evidence_judgments_initial.json", judgments)

        initial_errors: dict[str, list[str]] = {}
        for question_id in selected_ids:
            _valid, errors = self._validate_bundle(
                judgments[question_id], plans[question_id], pages, audited_company
            )
            if errors and judgments[question_id].get("valid"):
                initial_errors[question_id] = errors

        def retry_judge(question_id: str) -> tuple[str, dict[str, Any]]:
            data = judge_input(question_id)
            data["previous_output"] = judgments[question_id]
            data["deterministic_validation_errors"] = initial_errors[question_id]
            repair_instruction = (
                EVIDENCE_JUDGE_PROMPT
                + "\n\nThis is the single correction attempt. Fix the listed validation errors using "
                  "one contiguous exact passage and its correct page ID. Reject the bundle if that is impossible."
            )
            return question_id, self._call_json(
                "evidence_retry", question_id, repair_instruction, data, JUDGMENT_SCHEMA
            )

        retries: dict[str, Any] = {}
        if initial_errors:
            retries = self._stage(
                "evidence_retry",
                lambda: run_parallel(list(initial_errors), retry_judge),
            )
            judgments.update(retries)
        self._write(
            "evidence_retries.json",
            {"initial_errors": initial_errors, "retry_outputs": retries},
        )
        self._write("evidence_judgments.json", judgments)
        validation: dict[str, Any] = {}
        valid_bundles: list[dict[str, Any]] = []
        for index, question_id in enumerate(selected_ids, start=1):
            judgment = judgments[question_id]
            valid, errors = self._validate_bundle(judgment, plans[question_id], pages, audited_company)
            bundle_id = f"bundle-{index:02d}"
            validation[question_id] = {"bundle_id": bundle_id, "valid": valid, "errors": errors}
            if valid:
                valid_bundles.append(
                    {
                        "bundle_id": bundle_id,
                        "question_id": question_id,
                        "question": card_by_id[question_id]["question"],
                        "buyer_need": selected_meta[question_id].get("buyer_need", ""),
                        **judgment,
                    }
                )
        self._write("bundle_validation.json", validation)
        self._write("valid_evidence_bundles.json", valid_bundles)
        if len(valid_bundles) < 5:
            raise RuntimeError(f"Only {len(valid_bundles)} evidence bundles passed; five are required.")

        compact_bundles = [
            {
                key: bundle.get(key)
                for key in (
                    "bundle_id", "question_id", "question", "competitor_name",
                    "competitor_page_id", "audited_page_id", "competitor_quote",
                    "audited_company_quote", "competitor_proof",
                    "audited_company_proof", "proven_gap", "action_type", "target",
                    "specific_action", "improvement_domain", "confidence", "buyer_need",
                )
            }
            for bundle in valid_bundles
        ]
        dedupe = self._stage(
            "dedupe_selection",
            lambda: self._call_json(
                "dedupe_selection", "all", DEDUPE_SELECTOR_PROMPT,
                {"audited_company": audited_company, "valid_bundles": compact_bundles},
                DEDUPE_SCHEMA,
            ),
        )
        bundle_by_id = {bundle["bundle_id"]: bundle for bundle in valid_bundles}
        chosen = []
        for item in dedupe.get("selected", []):
            bundle_id = str(item.get("bundle_id", ""))
            if bundle_id in bundle_by_id and bundle_id not in [row["bundle_id"] for row in chosen]:
                chosen.append(item)
        if len(chosen) != 5:
            raise RuntimeError("Dedupe step did not choose five valid, unique bundle IDs.")
        chosen_needs = [normalize_name(str(bundle_by_id[item["bundle_id"]].get("buyer_need", ""))) for item in chosen]
        if any(not need for need in chosen_needs) or len(chosen_needs) != len(set(chosen_needs)):
            raise RuntimeError("Dedupe step repeated an underlying buyer need.")
        self._write("dedupe_selection.json", {"model_output": dedupe, "accepted": chosen})

        writer_bundles = []
        for selection in chosen:
            source_bundle = bundle_by_id[selection["bundle_id"]]
            # Do not pass the judge's draft gap or action to the final writer.
            # Those fields are useful for selection, but can anchor the writer
            # to an over-broad interpretation. The final stages reason again
            # from the question and the two deterministically verified quotes.
            bundle = {
                key: source_bundle.get(key)
                for key in (
                    "bundle_id",
                    "question_id",
                    "question",
                    "buyer_need",
                    "competitor_name",
                    "competitor_page_id",
                    "audited_page_id",
                    "competitor_quote",
                    "audited_company_quote",
                    "improvement_domain",
                    "confidence",
                )
            }
            bundle["grouped_question_ids"] = selection.get("grouped_question_ids", [])
            bundle["distinct_reason"] = selection.get("distinct_reason", "")
            writer_bundles.append(bundle)
        writer_input = {"audited_company": audited_company, "validated_evidence_bundles": writer_bundles}
        self._write("writer_input.json", writer_input)
        writer_output = self._stage(
            "final_writing",
            lambda: self._call_json("final_writing", "all", FINAL_WRITER_PROMPT, writer_input, WRITER_SCHEMA),
        )
        self._write("writer_output.json", writer_output)
        deterministic_errors = self._validate_final(writer_output, chosen, bundle_by_id)
        if deterministic_errors:
            raise RuntimeError("Final writer validation failed: " + "; ".join(deterministic_errors))

        evaluator_input = {
            "audited_company": audited_company,
            "validated_evidence_bundles": writer_bundles,
            "written_recommendations": writer_output["recommendations"],
        }
        evaluation = self._stage(
            "final_evaluation",
            lambda: self._call_json("final_evaluation", "initial", FINAL_EVALUATOR_PROMPT, evaluator_input, EVALUATOR_SCHEMA),
        )
        evaluation = self._ground_evaluation_claims(
            evaluation,
            writer_output["recommendations"],
            pages,
            {bundle["bundle_id"]: bundle for bundle in writer_bundles},
            audited_company,
        )
        writer_bundle_by_id = {bundle["bundle_id"]: bundle for bundle in writer_bundles}

        def verify_capability(bundle_id: str) -> tuple[str, dict[str, Any]]:
            recommendation = next(
                item for item in writer_output["recommendations"] if item.get("bundle_id") == bundle_id
            )
            bundle = writer_bundle_by_id[bundle_id]
            data = {
                "audited_company": audited_company,
                "suggested_change": recommendation.get("suggested_change", ""),
                "observation": recommendation.get("observation", ""),
                "audited_company_page_id": bundle.get("audited_page_id", ""),
                "audited_company_passage": bundle.get("audited_company_quote", ""),
            }
            return bundle_id, self._call_json(
                "capability_verification",
                bundle_id,
                CAPABILITY_VERIFIER_PROMPT,
                data,
                CAPABILITY_VERIFIER_SCHEMA,
            )

        capability_checks = self._stage(
            "capability_verification",
            lambda: run_parallel([bundle["bundle_id"] for bundle in writer_bundles], verify_capability),
        )
        evaluation = self._apply_independent_capability_checks(
            evaluation, capability_checks, pages, writer_bundle_by_id
        )
        self._write("capability_checks_initial.json", capability_checks)
        self._write("final_validation_initial.json", evaluation)

        def failed_bundle_ids(result: dict[str, Any]) -> list[str]:
            values = [
                str(item.get("bundle_id", ""))
                for item in result.get("items", [])
                if not item.get("passed")
            ]
            values.extend(
                str(pair.get("second_bundle_id", ""))
                for pair in result.get("duplicate_pairs", []) or []
            )
            return list(
                dict.fromkeys(value for value in values if value in bundle_by_id)
            )

        repaired = False
        repair_rounds = 0
        # Bounded evaluator-optimizer loop: never more than two repairs.
        for repair_round in (1, 2):
            failed_ids = failed_bundle_ids(evaluation)
            if not failed_ids:
                break
            repair_rounds = repair_round
            feedback = [
                item
                for item in evaluation.get("items", [])
                if item.get("bundle_id") in failed_ids
            ]
            repair_input = {
                "audited_company": audited_company,
                "failed_recommendations": [
                    item
                    for item in writer_output["recommendations"]
                    if item.get("bundle_id") in failed_ids
                ],
                "validated_bundles": [
                    bundle
                    for bundle in writer_bundles
                    if bundle.get("bundle_id") in failed_ids
                ],
                "evaluator_feedback": feedback,
                "other_passed_recommendations": [
                    item
                    for item in writer_output["recommendations"]
                    if item.get("bundle_id") not in failed_ids
                ],
            }
            repair_stage = "repair" if repair_round == 1 else "repair_second"
            repair_output = self._stage(
                repair_stage,
                lambda repair_round=repair_round, repair_input=repair_input: self._call_json(
                    "repair",
                    f"round_{repair_round}",
                    REPAIR_PROMPT,
                    repair_input,
                    REPAIR_SCHEMA,
                ),
            )
            repairs = {
                item.get("bundle_id"): item
                for item in repair_output.get("recommendations", [])
            }
            writer_output["recommendations"] = [
                repairs.get(item.get("bundle_id"), item)
                for item in writer_output["recommendations"]
            ]
            repaired = True
            self._write(f"repair_output_round_{repair_round}.json", repair_output)
            repair_errors = self._validate_final(writer_output, chosen, bundle_by_id)
            if repair_errors:
                raise RuntimeError(
                    "Repair validation failed: " + "; ".join(repair_errors)
                )
            evaluator_input["written_recommendations"] = writer_output["recommendations"]
            evaluation_stage = (
                "final_re_evaluation"
                if repair_round == 1
                else "final_second_re_evaluation"
            )
            evaluation = self._stage(
                evaluation_stage,
                lambda repair_round=repair_round: self._call_json(
                    "final_evaluation",
                    f"after_repair_{repair_round}",
                    FINAL_EVALUATOR_PROMPT,
                    evaluator_input,
                    EVALUATOR_SCHEMA,
                ),
            )
            evaluation = self._ground_evaluation_claims(
                evaluation,
                writer_output["recommendations"],
                pages,
                writer_bundle_by_id,
                audited_company,
            )
            verification_stage = (
                "capability_re_verification"
                if repair_round == 1
                else "capability_second_re_verification"
            )
            capability_checks = self._stage(
                verification_stage,
                lambda: run_parallel(
                    [bundle["bundle_id"] for bundle in writer_bundles],
                    verify_capability,
                ),
            )
            evaluation = self._apply_independent_capability_checks(
                evaluation, capability_checks, pages, writer_bundle_by_id
            )
            self._write(
                f"capability_checks_after_repair_{repair_round}.json",
                capability_checks,
            )

        materialized = []
        for item in writer_output["recommendations"]:
            result = dict(item)
            competitor_page = pages[item["competitor_page_id"]]
            audited_page = pages[item["audited_page_id"]]
            bundle = bundle_by_id[item["bundle_id"]]
            result["competitor_source"] = {
                "company_name": competitor_page.get("company_name"),
                "url": competitor_page.get("url"),
                "title": competitor_page.get("title"),
                "supporting_passage": bundle.get("competitor_quote"),
            }
            result["audited_company_source"] = {
                "company_name": audited_page.get("company_name"),
                "url": audited_page.get("url"),
                "title": audited_page.get("title"),
                "supporting_passage": bundle.get("audited_company_quote"),
            }
            materialized.append(result)
        final_output = {
            "recommendations": materialized,
            "summary": writer_output.get("summary", ""),
            "evaluation": evaluation,
        }
        self._write("final_validation.json", evaluation)
        self._write("final_recommendations.json", final_output)
        self.timings["total"] = round(time.perf_counter() - total_started, 3)
        self._write("stage_timings.json", self.timings)
        summary = {
            **manifest,
            "selected_question_count": len(selected_ids),
            "valid_bundle_count": len(valid_bundles),
            "recommendation_count": len(materialized),
            "repaired": repaired,
            "repair_rounds": repair_rounds,
            "final_evaluator_passed": bool(evaluation.get("all_passed")) and not evaluation.get("duplicate_pairs"),
            "llm_call_count": len(self.llm_calls),
            "firecrawl_requests": self._firecrawl.request_count if self._firecrawl else 0,
            "timings_seconds": self.timings,
        }
        self._write("run_summary.json", summary)
        return summary


def default_output_dir(source_run: Path) -> Path:
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    return Path("experiments/structured_writer_runs") / f"{timestamp}-{source_run.name}"
