from __future__ import annotations

import json
import os
import re
from typing import Any
from urllib.parse import urlparse

from .crawler import fetch_html, parse_page
from .json_tools import extract_json_object
from .llm import build_chat_payload, call_chat_completion


FREE_RECOMMENDATION_SYSTEM_PROMPT = """Create at most one trustworthy website improvement for a free AI visibility audit.

The measured buyer answers identify a lost question and the competitor chosen
instead. You also receive two small page sets: pages cited for that competitor,
and pages already read from the audited company.

Choose the strongest supplied buyer candidate, then choose one audited-company
page whose actual text is directly relevant to the same buyer need. Compare
only what those passages prove. Recommend a website communication change only
when the audited passage proves the company already supports the subject. Never
turn a competitor capability into a new capability for the audited company.
Never infer from a title alone. Never invent a URL, feature, certification,
customer, metric, or page. If both sides do not support a safe comparison, or
if both pages already communicate the same point equally clearly, return
no_action. State the exact missing explanation, proof, organization, or buyer
focus. Any capability in the action must be proven by the selected audited page.
Include one short exact support quote from each selected page.

Keep the action under 45 words. It may only reorganize, repeat, connect, or
explain facts present in the audited support quote. Do not add implementation
details, examples, metrics, integrations, compliance claims, or buyer segments
that are absent from that quote.

Return JSON with exactly these fields:
status (action or no_action), title, observation, action, expected_impact,
buyer_candidate_id, audited_page_id, competitor_page_id, confidence,
audited_support_quote, competitor_support_quote, no_action_reason.
Use only supplied page IDs.
"""


def clean(value: Any, limit: int = 1200) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()[:limit]


def normalized_name(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value or "").lower())


def free_search_answers(raw_results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows = [
        row
        for row in raw_results
        if str(row.get("assistant", "")).lower() in {"openai", "openai_search"}
    ]
    rows.sort(key=lambda row: int(row.get("prompt_index", 9999) or 9999))
    return rows[:5]


def cited_urls(company: dict[str, Any]) -> list[str]:
    values = [str(url) for url in company.get("source_urls", []) if url]
    if company.get("official_website"):
        values.append(str(company["official_website"]))
    return list(dict.fromkeys(values))


def fetch_cited_page(urls: list[str]) -> dict[str, str] | None:
    for url in urls[:6]:
        try:
            html, status, final_url = fetch_html(url, timeout=12)
            page = parse_page(final_url, html, status)
            text = clean(page.get("main_text") or page.get("text"), 1200)
            if text:
                return {
                    "url": final_url,
                    "title": clean(page.get("title"), 240),
                    "content": text,
                }
        except Exception:  # Try the next answer-attached citation.
            continue
    return None


def audited_pages(snapshot: dict[str, Any], limit: int = 6) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    for page in snapshot.get("pages", []) or []:
        url = str(page.get("final_url") or page.get("url") or "")
        text = clean(
            page.get("text")
            or page.get("main_text")
            or page.get("markdown")
            or page.get("content")
            or page.get("excerpt"),
            900,
        )
        if not url or not text:
            continue
        rows.append(
            {"url": url, "title": clean(page.get("title"), 240), "content": text}
        )
        if len(rows) >= limit:
            break
    return rows


def model_pages(
    rows: list[dict[str, str]], prefix: str
) -> tuple[list[dict[str, str]], dict[str, dict[str, str]]]:
    supplied: list[dict[str, str]] = []
    lookup: dict[str, dict[str, str]] = {}
    for index, row in enumerate(rows, start=1):
        page_id = f"{prefix}-{index:02d}"
        lookup[page_id] = row
        supplied.append(
            {
                "page_id": page_id,
                "url_path": urlparse(row["url"]).path or "/",
                "title": row["title"],
                "content": row["content"],
            }
        )
    return supplied, lookup


def lost_question_candidates(
    raw_results: list[dict[str, Any]], aliases: list[str], limit: int = 3
) -> tuple[list[dict[str, Any]], dict[str, dict[str, str]], int]:
    own_names = {normalized_name(value) for value in aliases if value}
    candidates: list[dict[str, Any]] = []
    lookup: dict[str, dict[str, str]] = {}
    citations_found = 0
    for answer in free_search_answers(raw_results):
        companies = sorted(
            answer.get("recommended_companies", []) or [],
            key=lambda row: int(row.get("rank", 999) or 999),
        )
        if any(normalized_name(row.get("company_name")) in own_names for row in companies):
            continue
        for company in companies[:2]:
            urls = cited_urls(company)
            citations_found += len(urls)
            page = fetch_cited_page(urls)
            if not page:
                continue
            candidate_id = f"candidate-{len(candidates) + 1:02d}"
            page_id = f"competitor-{len(candidates) + 1:02d}"
            lookup[page_id] = page
            candidates.append(
                {
                    "candidate_id": candidate_id,
                    "question": answer.get("prompt"),
                    "winner": company.get("company_name"),
                    "winner_rank": company.get("rank"),
                    "answer_reason": clean(company.get("reasoning"), 420),
                    "competitor_page": {
                        "page_id": page_id,
                        "url_path": urlparse(page["url"]).path or "/",
                        "title": page["title"],
                        "content": page["content"],
                    },
                }
            )
            break
        if len(candidates) >= limit:
            break
    return candidates, lookup, citations_found


def quote_is_from_page(quote: Any, page: dict[str, str] | None) -> bool:
    wanted = clean(quote, 600).strip('"').lower()
    source = clean((page or {}).get("content"), 2000).lower()
    return bool(wanted) and wanted in source


def generate_free_recommendation(
    company_profile: dict[str, Any],
    snapshot: dict[str, Any],
    raw_results: list[dict[str, Any]],
    *,
    model: str | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any], dict[str, Any], str | None]:
    answers = free_search_answers(raw_results)
    aliases = [str(company_profile.get("company_name") or "")]
    aliases.extend(
        str(value)
        for value in company_profile.get("company_name_variants", []) or []
        if value
    )
    host = urlparse(str(snapshot.get("normalized_url") or snapshot.get("input_url") or ""))
    if host.netloc:
        aliases.append(host.netloc.lower().removeprefix("www."))

    buyer_candidates, competitor_lookup, citations_found = lost_question_candidates(
        answers, aliases, 3
    )
    own_rows = audited_pages(snapshot, 6)
    supplied_own, own_lookup = model_pages(own_rows, "audited")
    page_lookup = {**competitor_lookup, **own_lookup}
    own_names = {normalized_name(value) for value in aliases if value}
    mentions = sum(
        any(
            normalized_name(row.get("company_name")) in own_names
            for row in answer.get("recommended_companies", []) or []
        )
        for answer in answers
    )
    input_data = {
        "audited_company": company_profile.get("company_name"),
        "answers_checked": len(answers),
        "audited_company_mentions": mentions,
        "buyer_candidates": buyer_candidates,
        "audited_company_pages": supplied_own,
    }
    diagnostics = {
        "answers_checked": len(answers),
        "buyer_candidates_supplied": len(buyer_candidates),
        "competitor_citations_found": citations_found,
        "competitor_pages_downloaded": len(buyer_candidates),
        "audited_pages_supplied": len(own_rows),
    }
    if not buyer_candidates or not supplied_own:
        return [], {"input": input_data, "ai_called": False}, diagnostics, (
            "A usable evidence page was not available from both companies."
        )

    selected_model = model or os.environ.get("FREE_AUDIT_WRITER_MODEL", "gpt-5-mini")
    payload = build_chat_payload(
        FREE_RECOMMENDATION_SYSTEM_PROMPT,
        json.dumps(input_data, ensure_ascii=False),
        model=selected_model,
        temperature=0.1,
        json_response=True,
    )
    if selected_model.startswith("gpt-5"):
        payload.pop("temperature", None)
    try:
        action = extract_json_object(call_chat_completion(payload))
    except Exception as exc:
        return [], payload, diagnostics, f"{type(exc).__name__}: {exc}"

    candidate_id = str(action.get("buyer_candidate_id") or "")
    audited_id = str(action.get("audited_page_id") or "")
    competitor_id = str(action.get("competitor_page_id") or "")
    candidate_by_id = {
        str(row.get("candidate_id")): row for row in buyer_candidates
    }
    candidate = candidate_by_id.get(candidate_id)
    expected_competitor_id = str(
        ((candidate or {}).get("competitor_page") or {}).get("page_id") or ""
    )
    if action.get("status") == "no_action":
        diagnostics["model_status"] = "no_action"
        return [], payload, diagnostics, None

    ids_valid = bool(
        candidate
        and expected_competitor_id == competitor_id
        and audited_id in own_lookup
        and competitor_id in competitor_lookup
    )
    quotes_valid = ids_valid and quote_is_from_page(
        action.get("audited_support_quote"), own_lookup.get(audited_id)
    ) and quote_is_from_page(
        action.get("competitor_support_quote"), competitor_lookup.get(competitor_id)
    )
    diagnostics.update({"ids_valid": ids_valid, "quotes_valid": quotes_valid})
    if not ids_valid or not quotes_valid:
        return [], payload, diagnostics, (
            "The model did not return quotes from its selected evidence pages."
            if ids_valid
            else "The model selected an invalid evidence page."
        )

    audited_page = page_lookup[audited_id]
    competitor_page = page_lookup[competitor_id]
    audited_quote = clean(action.get("audited_support_quote"), 600)
    competitor_quote = clean(action.get("competitor_support_quote"), 600)
    winner = str((candidate or {}).get("winner") or "Competitor")
    company_name = str(company_profile.get("company_name") or "Audited company")
    question = str((candidate or {}).get("question") or "")
    recommendation = {
        "observation": clean(action.get("title") or action.get("observation"), 500),
        "evidence": clean(action.get("observation"), 1200),
        "suggested_change": clean(action.get("action"), 1000),
        "expected_impact": clean(action.get("expected_impact"), 800),
        "confidence": action.get("confidence", "Medium"),
        "evidence_types": ["assistant_cited_page", "site_page"],
        "evidence_refs": [competitor_id, audited_id],
        "competitor_evidence_reason": (
            f"{winner}: {competitor_quote}"
        ),
        "audited_company_evidence_reason": (
            f"{company_name}: {audited_quote}"
        ),
        "affected_prompts": [question] if question else [],
        "supporting_evidence": [
            {
                "evidence_id": competitor_id,
                "company_name": winner,
                "evidence_type": "assistant_cited_page",
                "label": "Competitor page cited in the AI answer",
                "title": competitor_page.get("title"),
                "url": competitor_page.get("url"),
                "excerpt": competitor_quote,
                "provenance": "assistant_citation_verified_download",
                "verification": {"status": "verified", "url": competitor_page.get("url")},
            },
            {
                "evidence_id": audited_id,
                "company_name": company_name,
                "evidence_type": "site_page",
                "label": "Page on the audited website",
                "title": audited_page.get("title"),
                "url": audited_page.get("url"),
                "excerpt": audited_quote,
                "provenance": "standard_crawler_verified",
                "verification": {"status": "verified", "url": audited_page.get("url")},
            },
        ],
        "evidence_validation": {
            "mode": "catalog_ids",
            "requested_refs": [competitor_id, audited_id],
            "accepted_refs": [competitor_id, audited_id],
            "rejected_refs": [],
        },
    }
    if not recommendation["observation"] or not recommendation["suggested_change"]:
        return [], payload, diagnostics, "The model returned an incomplete action."
    return [recommendation], payload, diagnostics, None
