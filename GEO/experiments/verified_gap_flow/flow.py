from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
import json
import os
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
    ACTIONABILITY_EVALUATOR_PROMPT,
    CRITIC_PROMPT,
    EVIDENCE_RESEARCHER_PROMPT,
    FINAL_WRITER_PROMPT,
    GAP_SELECTOR_PROMPT,
    INVESTIGATION_PLANNER_PROMPT,
    QUESTION_ANALYZER_PROMPT,
)


def _object(properties: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "object",
        "properties": properties,
        "required": list(properties),
        "additionalProperties": False,
    }


STRING_ARRAY = {"type": "array", "items": {"type": "string"}}
GAP_TYPES = [
    "industry_positioning",
    "use_case_explanation",
    "product_explanation",
    "comparison_content",
    "customer_proof",
    "case_study_proof",
    "technical_documentation",
    "faq_coverage",
    "entity_clarity",
    "trust_signals",
    "external_mentions",
    "public_proof",
    "content_structure",
    "internal_linking",
    "discoverability",
    "pricing_clarity",
    "integration_explanation",
    "workflow_education",
]

QUESTION_SCHEMA = _object(
    {
        "questions": {
            "type": "array",
            "items": _object(
                {"question_id": {"type": "string"}, "buyer_need": {"type": "string"}}
            ),
        }
    }
)

PLAN_SCHEMA = _object(
    {
        "question_id": {"type": "string"},
        "winner_company": {"type": "string"},
        "hypotheses": {
            "type": "array",
            "items": {"type": "string"},
            "minItems": 1,
            "maxItems": 3,
        },
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
        "selection_reason": {"type": "string"},
    }
)

RESEARCH_SCHEMA = _object(
    {
        "status": {
            "type": "string",
            "enum": [
                "SUPPORTED_GAP",
                "WEAK_EVIDENCE",
                "NO_MEANINGFUL_DIFFERENCE",
                "INSUFFICIENT_DATA",
            ],
        },
        "question_id": {"type": "string"},
        "winner_company": {"type": "string"},
        "buyer_need": {"type": "string"},
        "competitor_page_id": {"type": "string"},
        "competitor_passage_ids": {
            "type": "array", "items": {"type": "string"}, "maxItems": 3
        },
        "audited_page_id": {"type": "string"},
        "audited_passage_ids": {
            "type": "array", "items": {"type": "string"}, "maxItems": 3
        },
        "competitor_proof": {"type": "string"},
        "audited_company_proof": {"type": "string"},
        "direct_difference": {"type": "string"},
        "buyer_need_connection": {"type": "string"},
        "gap_type": {"type": "string", "enum": GAP_TYPES},
        "gap_kind": {"type": "string", "enum": ["missing", "weak", "hard_to_discover"]},
        "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
        "rejection_reason": {"type": "string"},
    }
)

SELECT_SCHEMA = _object(
    {
        "selected": {
            "type": "array",
            "minItems": 1,
            "maxItems": 5,
            "items": _object(
                {
                    "evidence_id": {"type": "string"},
                    "grouped_evidence_ids": STRING_ARRAY,
                    "selection_reason": {"type": "string"},
                }
            ),
        },
        "rejected": {
            "type": "array",
            "items": _object(
                {"evidence_id": {"type": "string"}, "reason": {"type": "string"}}
            ),
        },
    }
)

ACTIONABILITY_SCHEMA = _object(
    {
        "items": {
            "type": "array",
            "items": _object(
                {
                    "evidence_id": {"type": "string"},
                    "actionable": {"type": "boolean"},
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
                    "reason": {"type": "string"},
                }
            ),
        }
    }
)

RECOMMENDATION_SCHEMA = _object(
    {
        "evidence_id": {"type": "string"},
        "title": {"type": "string"},
        "lost_buyer_need": {"type": "string"},
        "competitor_advantage": {"type": "string"},
        "audited_company_current_state": {"type": "string"},
        "observed_gap": {"type": "string"},
        "suggested_change": {"type": "string"},
        "why_this_action": {"type": "string"},
        "expected_impact": {"type": "string"},
        "confidence": {"type": "string", "enum": ["high", "medium"]},
    }
)

WRITER_SCHEMA = _object(
    {
        "recommendations": {
            "type": "array",
            "minItems": 1,
            "maxItems": 5,
            "items": RECOMMENDATION_SCHEMA,
        },
        "summary": {"type": "string"},
    }
)

CRITIC_SCHEMA = _object(
    {
        "all_passed": {"type": "boolean"},
        "items": {
            "type": "array",
            "items": _object(
                {
                    "evidence_id": {"type": "string"},
                    "passed": {"type": "boolean"},
                    "errors": STRING_ARRAY,
                    "unsupported_capability_claims": STRING_ARRAY,
                }
            ),
        },
        "duplicate_pairs": {
            "type": "array",
            "items": _object(
                {
                    "first_evidence_id": {"type": "string"},
                    "second_evidence_id": {"type": "string"},
                    "reason": {"type": "string"},
                }
            ),
        },
    }
)

STOP_WORDS = {
    "a", "an", "and", "are", "as", "at", "be", "best", "by", "can", "does",
    "for", "from", "how", "in", "into", "is", "it", "of", "on", "or", "that",
    "the", "their", "this", "to", "what", "when", "which", "who", "with",
}


class VerifiedGapFlow:
    """Question-by-question evidence flow that never changes production data."""

    def __init__(
        self,
        source_run: Path,
        output_dir: Path,
        *,
        candidate_count: int = 14,
        max_workers: int = 4,
        model: str | None = None,
        llm_call: Callable[[dict[str, Any]], dict[str, Any]] = call_chat_message,
    ) -> None:
        self.source_run = Path(source_run).resolve()
        self.output_dir = Path(output_dir).resolve()
        self.candidate_count = max(5, min(candidate_count, 20))
        self.max_workers = max(1, min(max_workers, 6))
        self.model = model
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
        prompt: str,
        data: Any,
        schema: dict[str, Any],
    ) -> dict[str, Any]:
        payload = build_chat_payload(
            prompt,
            json.dumps(data, separators=(",", ":"), ensure_ascii=False),
            model=self.model,
            temperature=0.1,
            json_response=True,
        )
        if str(payload.get("model", "")).startswith("gpt-5"):
            payload.pop("temperature", None)
        safe_name = re.sub(r"[^a-z0-9_]+", "_", f"{stage}_{key}".lower()).strip("_")
        payload["response_format"] = {
            "type": "json_schema",
            "json_schema": {"name": safe_name[:60], "strict": True, "schema": schema},
        }
        started = time.perf_counter()
        raw = ""
        parsed: dict[str, Any] = {}
        error = ""
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
                "input": data,
                "raw_output": raw,
                "parsed_output": parsed,
                "error": error,
            }
            with self._trace_lock:
                self.llm_calls.append(record)
                self._write("llm_calls.json", self.llm_calls)

    @staticmethod
    def _matching_company(left: str, right: str) -> bool:
        a, b = normalize_name(left), normalize_name(right)
        return bool(a and b and (a == b or a in b or b in a))

    @staticmethod
    def _inventory_rows(block: dict[str, Any]) -> list[dict[str, str]]:
        rows: list[dict[str, str]] = []
        seen: set[str] = set()
        groups = (
            ("pages_on_their_own_website", "own_website"),
            ("pages_the_assistants_cited_while_answering", "assistant_cited"),
            ("pages_the_wider_internet_holds_about_them", "wider_web"),
        )
        for field, source_type in groups:
            for page in block.get(field, []) or []:
                page_id = str(page.get("page_id", ""))
                if not page_id or page_id in seen:
                    continue
                seen.add(page_id)
                url = str(page.get("url", ""))
                rows.append(
                    {
                        "page_id": page_id,
                        "url": url,
                        "title": str(page.get("title", "")),
                        "source_type": source_type,
                        "page_type": VerifiedGapFlow._page_type(url, str(page.get("title", ""))),
                    }
                )
        return rows

    @staticmethod
    def _page_type(url: str, title: str) -> str:
        value = f"{urlparse(url).path} {title}".casefold()
        checks = (
            ("pricing", ("pricing", "plans")),
            ("comparison", ("compare", "alternative", " versus ", " vs ")),
            ("case_study", ("case-study", "case_study", "customers", "customer-story")),
            ("documentation", ("docs", "documentation", "developers", "api")),
            ("integration", ("integration", "integrations")),
            ("industry", ("industry", "industries")),
            ("use_case", ("use-case", "use_case", "solutions")),
            ("faq", ("faq", "frequently")),
            ("product", ("product", "features")),
            ("blog", ("blog", "resources", "article")),
        )
        for page_type, markers in checks:
            if any(marker in value for marker in markers):
                return page_type
        return "homepage" if urlparse(url).path.strip("/") == "" else "other"

    def _matching_block(self, name: str, blocks: dict[str, dict[str, Any]]) -> str:
        return next((key for key in blocks if self._matching_company(name, key)), "")

    def _question_detail(
        self,
        row: dict[str, Any],
        rows: list[dict[str, Any]],
        raw_results: list[dict[str, Any]],
        labels: dict[str, str],
        pages: dict[str, dict[str, Any]],
    ) -> dict[str, Any]:
        return open_question(
            str(row.get("question_id", "")), rows, raw_results, labels, pages=pages
        )

    def _loss_matrix(
        self,
        rows: list[dict[str, Any]],
        raw_results: list[dict[str, Any]],
        labels: dict[str, str],
        pages: dict[str, dict[str, Any]],
        blocks: dict[str, dict[str, Any]],
        audited_company: str,
    ) -> list[dict[str, Any]]:
        matrix: list[dict[str, Any]] = []
        for row in rows:
            target_count = int(row.get("answers_naming_the_company", 0) or 0)
            winners = []
            for item in row.get("who_was_named", []) or []:
                name = str(item.get("company", "")).strip()
                block_name = self._matching_block(name, blocks)
                if not name or not block_name or self._matching_company(block_name, audited_company):
                    continue
                count = int(item.get("named_by", 0) or 0)
                if count <= target_count:
                    continue
                winners.append(
                    {
                        "company": block_name,
                        "recommendation_count": count,
                        "position": item.get("position"),
                    }
                )
            winners.sort(key=lambda item: (-item["recommendation_count"], item.get("position") or 99))
            detail = self._question_detail(row, rows, raw_results, labels, pages)
            reasons: list[dict[str, Any]] = []
            cited: dict[str, list[str]] = {item["company"]: [] for item in winners}
            for answer in detail.get("answers", []) or []:
                for named in answer.get("companies_it_named", []) or []:
                    actual = str(named.get("company", ""))
                    winner = next(
                        (item["company"] for item in winners if self._matching_company(item["company"], actual)),
                        "",
                    )
                    if not winner:
                        continue
                    page_ids = [
                        page_id
                        for page_id in named.get("assistant_cited_page_ids", []) or []
                        if page_id in pages
                    ]
                    cited[winner].extend(page_ids)
                    reason = str(named.get("reason", "")).strip()
                    if reason and len(reasons) < 12:
                        reasons.append({"company": winner, "reason": reason, "page_ids": page_ids})
            matrix.append(
                {
                    "question_id": str(row.get("question_id", "")),
                    "question": str(row.get("question", "")),
                    "category": str(row.get("category", "")),
                    "audited_company": audited_company,
                    "audited_company_recommendation_count": target_count,
                    "winning_top_competitors": winners,
                    "primary_winner": winners[0] if winners else None,
                    "assistant_reasons": reasons,
                    "winner_cited_page_ids": {
                        key: list(dict.fromkeys(values)) for key, values in cited.items()
                    },
                    "eligible": bool(winners),
                }
            )
        return matrix

    @staticmethod
    def _tokens(value: str) -> set[str]:
        return {
            token
            for token in re.findall(r"[a-z0-9][a-z0-9+-]{2,}", value.casefold())
            if token not in STOP_WORDS
        }

    @staticmethod
    def _passages(page: dict[str, Any], size: int = 105, overlap: int = 18) -> list[dict[str, str]]:
        words = re.sub(r"\s+", " ", str(page.get("text", ""))).strip().split()
        if not words:
            return []
        passages = []
        step = max(1, size - overlap)
        for index, start in enumerate(range(0, len(words), step), start=1):
            chunk = words[start : start + size]
            if len(chunk) < 12 and passages:
                break
            passages.append(
                {
                    "passage_id": f"{page.get('page_id')}:s{index:03d}",
                    "page_id": str(page.get("page_id", "")),
                    "text": " ".join(chunk),
                }
            )
            if start + size >= len(words):
                break
        return passages

    def _relevant_passages(
        self,
        page: dict[str, Any],
        query: str,
        limit: int = 5,
    ) -> list[dict[str, str]]:
        passages = self._passages(page)
        if not passages:
            return []
        query_tokens = self._tokens(query)
        title_tokens = self._tokens(f"{page.get('title', '')} {page.get('url', '')}")
        ranked = []
        for index, passage in enumerate(passages):
            tokens = self._tokens(passage["text"])
            overlap = len(tokens & query_tokens)
            score = overlap * 3 + len(tokens & title_tokens) - (index * 0.001)
            ranked.append((score, index, passage))
        chosen = [item[2] for item in sorted(ranked, key=lambda item: (-item[0], item[1]))[:limit]]
        if passages[0]["passage_id"] not in {item["passage_id"] for item in chosen}:
            chosen[-1] = passages[0]
        return sorted(chosen, key=lambda item: item["passage_id"])

    def _run_parallel(
        self, values: list[str], operation: Callable[[str], tuple[str, Any]]
    ) -> dict[str, Any]:
        collected: dict[str, Any] = {}
        with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
            futures = {executor.submit(operation, value): value for value in values}
            for future in as_completed(futures):
                key, result = future.result()
                collected[key] = result
        return {key: collected[key] for key in values if key in collected}

    def _validate_research(
        self,
        result: dict[str, Any],
        investigation: dict[str, Any],
        plan: dict[str, Any],
        pages: dict[str, dict[str, Any]],
        passage_store: dict[str, dict[str, str]],
        audited_company: str,
    ) -> list[str]:
        errors: list[str] = []
        if result.get("status") != "SUPPORTED_GAP":
            return errors
        if result.get("question_id") != investigation.get("question_id"):
            errors.append("question ID changed")
        if not self._matching_company(
            str(result.get("winner_company", "")), str(investigation.get("winner_company", ""))
        ):
            errors.append("winner company changed")
        competitor_id = str(result.get("competitor_page_id", ""))
        audited_id = str(result.get("audited_page_id", ""))
        if competitor_id not in plan.get("competitor_page_ids", []):
            errors.append("competitor page was not selected and opened")
        if audited_id not in plan.get("audited_page_ids", []):
            errors.append("audited-company page was not selected and opened")
        competitor_page = pages.get(competitor_id, {})
        audited_page = pages.get(audited_id, {})
        if not meaningful_text(competitor_page.get("text")):
            errors.append("competitor page has no usable content")
        if not meaningful_text(audited_page.get("text")):
            errors.append("audited-company page has no usable content")
        if not self._matching_company(
            str(competitor_page.get("company_name", "")), str(investigation.get("winner_company", ""))
        ):
            errors.append("competitor page belongs to another company")
        if not self._matching_company(str(audited_page.get("company_name", "")), audited_company):
            errors.append("audited page belongs to another company")
        for field, expected_page in (
            ("competitor_passage_ids", competitor_id),
            ("audited_passage_ids", audited_id),
        ):
            ids = list(dict.fromkeys(str(value) for value in result.get(field, []) or []))
            if not ids:
                errors.append(f"{field} is empty")
            for passage_id in ids:
                passage = passage_store.get(passage_id)
                if not passage or passage.get("page_id") != expected_page:
                    errors.append(f"invalid passage ID: {passage_id}")
        if result.get("confidence") == "low":
            errors.append("confidence is low")
        for field in (
            "competitor_proof",
            "audited_company_proof",
            "direct_difference",
            "buyer_need_connection",
        ):
            if len(str(result.get(field, "")).split()) < 5:
                errors.append(f"{field} is too weak")
        return list(dict.fromkeys(errors))

    @staticmethod
    def _compact_evidence(record: dict[str, Any]) -> dict[str, Any]:
        return {
            "evidence_id": record.get("evidence_id"),
            "question_id": record.get("question_id"),
            "question": record.get("question"),
            "buyer_need": record.get("buyer_need"),
            "winner_company": record.get("winner_company"),
            "winner_recommendation_count": record.get("winner_recommendation_count"),
            "audited_company_recommendation_count": record.get("audited_company_recommendation_count"),
            "gap_type": record.get("gap_type"),
            "gap_kind": record.get("gap_kind"),
            "confidence": record.get("confidence"),
            "direct_difference": record.get("direct_difference"),
            "buyer_need_connection": record.get("buyer_need_connection"),
            "competitor_evidence": record.get("competitor_evidence"),
            "audited_company_evidence": record.get("audited_company_evidence"),
            "actionability": record.get("actionability"),
        }

    @staticmethod
    def _research_schema_for(
        plan: dict[str, Any], research_input: dict[str, Any]
    ) -> dict[str, Any]:
        competitor_pages = list(plan.get("competitor_page_ids", []))
        audited_pages = list(plan.get("audited_page_ids", []))
        competitor_passages: list[str] = []
        audited_passages: list[str] = []
        for packet in research_input.get("opened_page_passages", []) or []:
            target = (
                competitor_passages
                if packet.get("page_id") in competitor_pages
                else audited_passages
            )
            target.extend(
                str(item.get("passage_id", ""))
                for item in packet.get("passages", []) or []
                if item.get("passage_id")
            )
        schema = json.loads(json.dumps(RESEARCH_SCHEMA))
        properties = schema["properties"]
        properties["competitor_page_id"] = {"type": "string", "enum": competitor_pages}
        properties["audited_page_id"] = {"type": "string", "enum": audited_pages}
        properties["competitor_passage_ids"]["items"] = {
            "type": "string", "enum": competitor_passages or [""]
        }
        properties["audited_passage_ids"]["items"] = {
            "type": "string", "enum": audited_passages or [""]
        }
        return schema

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
        matrix = self._loss_matrix(
            rows, raw_results, labels, pages, blocks, audited_company
        )
        eligible = [item for item in matrix if item["eligible"]]
        self._write("loss_matrix.json", matrix)

        analyzer_input = {
            "audited_company": audited_company,
            "questions": [
                {
                    "question_id": item["question_id"],
                    "question": item["question"],
                    "category": item["category"],
                }
                for item in eligible
            ],
        }
        analyzed = self._stage(
            "question_analysis",
            lambda: self._call_json(
                "question_analysis", "all", QUESTION_ANALYZER_PROMPT, analyzer_input, QUESTION_SCHEMA
            ),
        )
        needs = {
            str(item.get("question_id", "")): str(item.get("buyer_need", "")).strip()
            for item in analyzed.get("questions", []) or []
        }
        for item in eligible:
            item["buyer_need"] = needs.get(item["question_id"]) or item["category"]

        eligible.sort(
            key=lambda item: (
                item["audited_company_recommendation_count"],
                -int(item["primary_winner"]["recommendation_count"]),
                item["question_id"],
            )
        )
        selected_candidates: list[dict[str, Any]] = []
        remaining = list(eligible)
        round_number = 0
        while remaining and len(selected_candidates) < self.candidate_count:
            round_number += 1
            used: dict[str, int] = {}
            next_remaining = []
            for item in remaining:
                need = normalize_name(item["buyer_need"])
                if used.get(need, 0) < round_number and len(selected_candidates) < self.candidate_count:
                    selected_candidates.append(item)
                    used[need] = used.get(need, 0) + 1
                else:
                    next_remaining.append(item)
            if len(next_remaining) == len(remaining):
                selected_candidates.extend(next_remaining[: self.candidate_count - len(selected_candidates)])
                break
            remaining = next_remaining

        investigations: dict[str, dict[str, Any]] = {}
        for item in selected_candidates:
            question_id = item["question_id"]
            winner = item["primary_winner"]
            winner_name = str(winner["company"])
            investigations[question_id] = {
                "investigation_id": f"inv-{len(investigations) + 1:02d}",
                "question_id": question_id,
                "question": item["question"],
                "buyer_need": item["buyer_need"],
                "audited_company": audited_company,
                "audited_company_recommendation_count": item["audited_company_recommendation_count"],
                "winner_company": winner_name,
                "winner_recommendation_count": winner["recommendation_count"],
                "other_winners": item["winning_top_competitors"][1:],
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
            competitor_inventory.sort(key=lambda item: (item["page_id"] not in cited, item["source_type"] != "own_website"))
            data = {
                "observed_loss": investigation,
                "competitor_page_inventory": competitor_inventory[:40],
                "audited_company_page_inventory": audited_inventory[:40],
            }
            plan = self._call_json(
                "investigation_planning", question_id, INVESTIGATION_PLANNER_PROMPT, data, PLAN_SCHEMA
            )
            allowed_competitor = {item["page_id"] for item in competitor_inventory}
            allowed_audited = {item["page_id"] for item in audited_inventory}
            plan["competitor_page_ids"] = list(dict.fromkeys(
                page_id for page_id in plan.get("competitor_page_ids", []) if page_id in allowed_competitor
            ))
            plan["audited_page_ids"] = list(dict.fromkeys(
                page_id for page_id in plan.get("audited_page_ids", []) if page_id in allowed_audited
            ))
            if not plan["competitor_page_ids"] or not plan["audited_page_ids"]:
                raise RuntimeError(f"No valid two-sided page plan for {question_id}")
            plan["question_id"] = question_id
            plan["winner_company"] = winner_name
            return question_id, plan

        plans = self._stage(
            "investigation_planning",
            lambda: self._run_parallel(list(investigations), plan_one),
        )
        self._write("investigation_plans.json", plans)

        selected_page_ids = list(dict.fromkeys(
            page_id
            for plan in plans.values()
            for field in ("competitor_page_ids", "audited_page_ids")
            for page_id in plan.get(field, [])
        ))

        def hydrate(page_id: str) -> tuple[str, dict[str, Any]]:
            page = hydrate_writer_page(dict(pages[page_id]), self._firecrawl)
            page["page_id"] = page_id
            return page_id, page

        opened = self._stage(
            "page_hydration", lambda: self._run_parallel(selected_page_ids, hydrate)
        )
        pages.update(opened)
        self._write(
            "opened_pages.json",
            {
                page_id: {
                    "page_id": page_id,
                    "company_name": page.get("company_name"),
                    "url": page.get("url"),
                    "title": page.get("title"),
                    "has_content": meaningful_text(page.get("text")),
                    "text_length": len(str(page.get("text", ""))),
                    "fetch_provider": page.get("fetch_provider", "stored"),
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
                    investigation["buyer_need"],
                    *plan.get("hypotheses", []),
                    *(reason["reason"] for reason in investigation["assistant_reasons"]),
                ]
            )
            page_packets = []
            for page_id in plan["competitor_page_ids"] + plan["audited_page_ids"]:
                page = pages[page_id]
                passages = self._relevant_passages(page, query)
                for passage in passages:
                    passage_store[passage["passage_id"]] = passage
                page_packets.append(
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
                "opened_page_passages": page_packets,
            }
        self._write("passage_store.json", passage_store)
        self._write("research_inputs.json", research_inputs)

        def research_one(question_id: str) -> tuple[str, dict[str, Any]]:
            research_schema = self._research_schema_for(
                plans[question_id], research_inputs[question_id]
            )
            result = self._call_json(
                "evidence_research", question_id, EVIDENCE_RESEARCHER_PROMPT,
                research_inputs[question_id], research_schema,
            )
            errors = self._validate_research(
                result, investigations[question_id], plans[question_id], pages,
                passage_store, audited_company,
            )
            if errors:
                retry_input = {
                    **research_inputs[question_id],
                    "previous_output": result,
                    "validation_errors": errors,
                }
                result = self._call_json(
                    "evidence_repair",
                    question_id,
                    EVIDENCE_RESEARCHER_PROMPT
                    + "\n\nCorrect the listed ID or support errors once. Reject the investigation if they cannot be corrected.",
                    retry_input,
                    research_schema,
                )
            return question_id, result

        research_results = self._stage(
            "evidence_research",
            lambda: self._run_parallel(list(investigations), research_one),
        )
        self._write("research_results_raw.json", research_results)

        evidence_records: list[dict[str, Any]] = []
        validation: dict[str, Any] = {}
        for question_id, result in research_results.items():
            errors = self._validate_research(
                result, investigations[question_id], plans[question_id], pages,
                passage_store, audited_company,
            )
            accepted = result.get("status") == "SUPPORTED_GAP" and not errors
            validation[question_id] = {
                "status": result.get("status"),
                "accepted": accepted,
                "errors": errors,
                "rejection_reason": result.get("rejection_reason", ""),
            }
            if not accepted:
                continue
            competitor_passages = [
                passage_store[passage_id]
                for passage_id in result.get("competitor_passage_ids", [])
                if passage_id in passage_store
            ]
            audited_passages = [
                passage_store[passage_id]
                for passage_id in result.get("audited_passage_ids", [])
                if passage_id in passage_store
            ]
            competitor_page = pages[result["competitor_page_id"]]
            audited_page = pages[result["audited_page_id"]]
            evidence_records.append(
                {
                    "evidence_id": f"ev-{len(evidence_records) + 1:02d}",
                    **investigations[question_id],
                    "status": result["status"],
                    "gap_type": result["gap_type"],
                    "gap_kind": result["gap_kind"],
                    "confidence": result["confidence"],
                    "competitor_evidence": {
                        "page_id": result["competitor_page_id"],
                        "url": competitor_page.get("url", ""),
                        "title": competitor_page.get("title", ""),
                        "passage_ids": result["competitor_passage_ids"],
                        "excerpts": [item["text"] for item in competitor_passages],
                        "what_it_proves": result["competitor_proof"],
                    },
                    "audited_company_evidence": {
                        "page_id": result["audited_page_id"],
                        "url": audited_page.get("url", ""),
                        "title": audited_page.get("title", ""),
                        "passage_ids": result["audited_passage_ids"],
                        "excerpts": [item["text"] for item in audited_passages],
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

        actionability = self._stage(
            "actionability_evaluation",
            lambda: self._call_json(
                "actionability_evaluation",
                "all",
                ACTIONABILITY_EVALUATOR_PROMPT,
                {
                    "audited_company": audited_company,
                    "verified_evidence_records": [
                        self._compact_evidence(record) for record in evidence_records
                    ],
                },
                ACTIONABILITY_SCHEMA,
            ),
        )
        actionability_by_id = {
            str(item.get("evidence_id", "")): item
            for item in actionability.get("items", []) or []
        }
        actionable_records: list[dict[str, Any]] = []
        for record in evidence_records:
            evaluation = actionability_by_id.get(record["evidence_id"], {})
            allowed_passages = set(record["audited_company_evidence"]["passage_ids"])
            capability_ids_valid = all(
                str(item.get("supporting_passage_id", "")) in allowed_passages
                for item in evaluation.get("supported_target_capabilities", []) or []
            )
            if not evaluation.get("actionable") or not capability_ids_valid:
                continue
            actionable_records.append({**record, "actionability": evaluation})
        self._write(
            "actionability_evaluation.json",
            {"model_output": actionability, "actionable_records": actionable_records},
        )
        if not actionable_records:
            raise RuntimeError("No verified gap supports a safe website or visibility action.")

        selector_input = {
            "audited_company": audited_company,
            "verified_evidence_records": [
                self._compact_evidence(record) for record in actionable_records
            ],
        }
        selection = self._stage(
            "gap_selection",
            lambda: self._call_json(
                "gap_selection", "all", GAP_SELECTOR_PROMPT, selector_input, SELECT_SCHEMA
            ),
        )
        by_evidence_id = {item["evidence_id"]: item for item in actionable_records}
        selected: list[dict[str, Any]] = []
        seen_ids: set[str] = set()
        seen_audited_pages: set[str] = set()
        for item in selection.get("selected", []) or []:
            evidence_id = str(item.get("evidence_id", ""))
            if evidence_id not in by_evidence_id or evidence_id in seen_ids:
                continue
            candidate = by_evidence_id[evidence_id]
            audited_page_id = str(candidate.get("audited_company_evidence", {}).get("page_id", ""))
            if audited_page_id in seen_audited_pages:
                continue
            seen_ids.add(evidence_id)
            seen_audited_pages.add(audited_page_id)
            grouped = [
                value for value in item.get("grouped_evidence_ids", []) or []
                if value in by_evidence_id and value != evidence_id
            ]
            selected.append(
                {
                    **by_evidence_id[evidence_id],
                    "grouped_evidence_ids": list(dict.fromkeys(grouped)),
                    "selection_reason": item.get("selection_reason", ""),
                }
            )
        selected = selected[:5]
        if not selected:
            raise RuntimeError("The selection step returned no valid evidence IDs.")
        self._write("gap_selection.json", {"model_output": selection, "selected": selected})

        writer_input = {
            "audited_company": audited_company,
            "number_to_write": len(selected),
            "verified_gaps": [self._compact_evidence(record) for record in selected],
        }
        writer_output = self._stage(
            "final_writing",
            lambda: self._call_json(
                "final_writing", "all", FINAL_WRITER_PROMPT, writer_input, WRITER_SCHEMA
            ),
        )
        expected_ids = [item["evidence_id"] for item in selected]
        actual_ids = [str(item.get("evidence_id", "")) for item in writer_output.get("recommendations", [])]
        writer_errors = []
        if actual_ids != expected_ids:
            writer_errors.append("The writer did not preserve every selected evidence ID in order.")
        safe_scope_by_id = {
            item["evidence_id"]: str(item.get("actionability", {}).get("safe_action_scope", ""))
            for item in selected
        }
        for recommendation in writer_output.get("recommendations", []) or []:
            evidence_id = str(recommendation.get("evidence_id", ""))
            if evidence_id in safe_scope_by_id:
                recommendation["suggested_change"] = safe_scope_by_id[evidence_id]
        self._write("writer_output_initial.json", writer_output)

        critic_input = {
            "verified_gaps": selected,
            "recommendations": writer_output.get("recommendations", []),
        }
        critic = self._stage(
            "recommendation_critique",
            lambda: self._call_json(
                "recommendation_critique", "all", CRITIC_PROMPT, critic_input, CRITIC_SCHEMA
            ),
        )
        self._write("recommendation_critique_initial.json", critic)
        needs_repair = bool(writer_errors) or not critic.get("all_passed") or bool(critic.get("duplicate_pairs"))
        if needs_repair:
            repair_input = {
                **writer_input,
                "previous_recommendations": writer_output,
                "critic_feedback": critic,
                "deterministic_errors": writer_errors,
            }
            writer_output = self._stage(
                "final_repair",
                lambda: self._call_json(
                    "final_repair",
                    "all",
                    FINAL_WRITER_PROMPT
                    + "\n\nRewrite the full set once. Correct every listed problem while preserving the evidence IDs in order.",
                    repair_input,
                    WRITER_SCHEMA,
                ),
            )
            for recommendation in writer_output.get("recommendations", []) or []:
                evidence_id = str(recommendation.get("evidence_id", ""))
                if evidence_id in safe_scope_by_id:
                    recommendation["suggested_change"] = safe_scope_by_id[evidence_id]
            critic_input["recommendations"] = writer_output.get("recommendations", [])
            critic = self._stage(
                "final_critique",
                lambda: self._call_json(
                    "final_critique", "all", CRITIC_PROMPT, critic_input, CRITIC_SCHEMA
                ),
            )
        self._write("writer_output.json", writer_output)
        self._write("recommendation_critique.json", critic)

        selected_by_id = {item["evidence_id"]: item for item in selected}
        final_recommendations = []
        for recommendation in writer_output.get("recommendations", []) or []:
            evidence_id = str(recommendation.get("evidence_id", ""))
            evidence = selected_by_id.get(evidence_id)
            if not evidence:
                continue
            final_recommendations.append(
                {
                    **recommendation,
                    "question_id": evidence["question_id"],
                    "question": evidence["question"],
                    "winner_company": evidence["winner_company"],
                    "winner_recommendation_count": evidence["winner_recommendation_count"],
                    "audited_company_recommendation_count": evidence["audited_company_recommendation_count"],
                    "gap_type": evidence["gap_type"],
                    "evidence": {
                        "competitor": evidence["competitor_evidence"],
                        "audited_company": evidence["audited_company_evidence"],
                    },
                    "grouped_evidence_ids": evidence.get("grouped_evidence_ids", []),
                }
            )
        final = {
            "audited_company": audited_company,
            "recommendations": final_recommendations,
            "summary": writer_output.get("summary", ""),
            "critic": critic,
        }
        self._write("final_recommendations.json", final)
        self.timings["total"] = round(time.perf_counter() - total_started, 3)
        self._write("stage_timings.json", self.timings)
        summary = {
            "audited_company": audited_company,
            "eligible_losses": len(eligible),
            "investigations": len(investigations),
            "verified_gaps": len(evidence_records),
            "actionable_gaps": len(actionable_records),
            "recommendations": len(final_recommendations),
            "critic_passed": bool(critic.get("all_passed")),
            "llm_calls": len(self.llm_calls),
            "total_seconds": self.timings["total"],
            "production_files_modified": False,
        }
        self._write("run_summary.json", summary)
        return summary


def default_output_dir(source_run: Path) -> Path:
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    return Path("experiments/verified_gap_runs") / f"{timestamp}-{Path(source_run).name}"
