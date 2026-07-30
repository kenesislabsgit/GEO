from __future__ import annotations

import json
import re
from typing import Any

from .json_tools import extract_json_object
from .llm import LLMNotConfigured, build_chat_payload, call_chat_completion


PROFILE_SYSTEM_PROMPT = """You are an experienced buyer-research analyst.

Build an evidence-backed company and buyer profile that will be used to create
natural, unbranded questions from real prospective customers.

Use only the supplied website pages and evidence. Do not use outside knowledge.
Do not infer company size from visual design or writing style.
Do not invent regions, budgets, buyer roles, industries, or engagement models.
Use "Unknown" or an empty array when the website does not support a value.
An office address is a company location, not proof that customers are served
only in that region. Put addresses in company_locations. Only populate
regions_served when a page explicitly describes a market or service area.
Do not convert missing pricing into "custom pricing" or "contact sales".
Do not invent likely objections, buying triggers, organization sizes, or
constraints from general marketing benefits.

Separate the person who buys the offering from the person who uses it.
Describe customer needs in buyer language, not SEO language.
Build competitor_scope around direct peers, not famous companies. A direct peer
description should combine the supported provider type, specialization, and
customer scope. Do not name competitors. Do not describe the company as small,
boutique, local, mid-market, or enterprise unless the website explicitly
supports that positioning. Larger alternative types are structurally different
options a buyer may consider, not direct competitors.
For every important profile value, provide a short exact quote copied from the
page. Do not paraphrase evidence quotes. The value in claim_evidence must
exactly match the corresponding scalar or array item.
The backend calculates confidence; your confidence is only a candidate.

Return only valid JSON with this exact top-level structure:
{
  "company_name": "",
  "category": "",
  "target_audience": "",
  "business_type": "",
  "delivery_model": "",
  "company_locations": [],
  "regions_served": [],
  "industries": [],
  "features": [],
  "use_cases": [],
  "problems_solved": [],
  "unique_value_proposition": "",
  "pricing_model": "",
  "keywords": [],
  "core_messaging": [],
  "primary_offerings": [],
  "customer_segments": [],
  "buyer_personas": [
    {
      "persona_id": "",
      "buyer_role": "",
      "end_users": [],
      "organization_type": "",
      "organization_sizes": [],
      "industries": [],
      "regions": [],
      "jobs_to_be_done": [],
      "buying_triggers": [],
      "decision_factors": [],
      "constraints": [],
      "confidence": "High|Medium|Low",
      "evidence_refs": [],
      "claim_evidence": [
        {
          "field": "buyer_role|end_users|organization_type|organization_sizes|industries|regions|jobs_to_be_done|buying_triggers|decision_factors|constraints",
          "value": "",
          "page_id": "",
          "quote": ""
        }
      ]
    }
  ],
  "purchase_context": {
    "engagement_models": [],
    "deployment_or_delivery": [],
    "pricing_signals": [],
    "common_objections": []
  },
  "competitor_scope": {
    "direct_peer_description": "",
    "larger_alternative_types": [],
    "excluded_provider_types": []
  },
  "evidence": {
    "supporting_pages": [],
    "unclear_or_missing": [],
    "field_evidence": [
      {
        "field": "",
        "value": "",
        "page_id": "",
        "quote": ""
      }
    ]
  }
}
"""


def build_company_profile_payload(
    snapshot: dict[str, Any],
    website_evidence: dict[str, Any],
) -> dict[str, Any]:
    compact_snapshot = compact_snapshot_for_llm(snapshot)
    user_prompt = json.dumps(
        {
            "website_snapshot": compact_snapshot,
            "website_evidence": website_evidence,
        },
        indent=2,
        ensure_ascii=False,
    )
    return build_chat_payload(
        PROFILE_SYSTEM_PROMPT,
        user_prompt,
        temperature=0.1,
        json_response=True,
    )


def generate_company_profile(
    snapshot: dict[str, Any],
    website_evidence: dict[str, Any],
) -> tuple[dict[str, Any] | None, dict[str, Any], str | None]:
    payload = build_company_profile_payload(snapshot, website_evidence)
    try:
        raw_response = call_chat_completion(payload)
    except TimeoutError:
        try:
            raw_response = call_chat_completion(payload)
        except (LLMNotConfigured, RuntimeError, TimeoutError) as exc:
            return None, payload, f"Company profile request failed: {exc}"
    except (LLMNotConfigured, RuntimeError) as exc:
        return None, payload, str(exc)

    parsed = extract_json_object(raw_response)
    return normalize_company_profile(parsed, snapshot), payload, None


def compact_snapshot_for_llm(snapshot: dict[str, Any]) -> dict[str, Any]:
    pages = []
    for index, page in enumerate(snapshot.get("pages", []), start=1):
        pages.append(
            {
                "page_id": f"page-{index:03d}",
                "url": page.get("url", ""),
                "title": page.get("title", ""),
                "meta_description": page.get("meta_description", ""),
                "headings": page.get("headings", {}),
                "schema_json_ld": page.get("schema_json_ld", []),
                "navigation": page.get("navigation", [])[:30],
                "main_text": page.get("main_text", "")[:6000],
                "fetch_provider": page.get(
                    "fetch_provider", "deterministic_crawler"
                ),
            }
        )

    return {
        "input_url": snapshot.get("input_url", ""),
        "domain": snapshot.get("domain", ""),
        "pages": pages,
        "failed_pages": snapshot.get("failed_pages", []),
    }


def normalize_company_profile(
    profile: dict[str, Any],
    snapshot: dict[str, Any],
) -> dict[str, Any]:
    normalized = dict(profile)
    page_texts, page_urls = build_page_evidence_index(snapshot)
    scalar_defaults = {
        "company_name": "Unknown",
        "category": "Unknown",
        "target_audience": "Unknown",
        "business_type": "Unknown",
        "delivery_model": "Unknown",
        "unique_value_proposition": "Unknown",
        "pricing_model": "Unknown",
    }
    list_fields = (
        "company_locations",
        "regions_served",
        "industries",
        "features",
        "use_cases",
        "problems_solved",
        "keywords",
        "core_messaging",
        "primary_offerings",
        "customer_segments",
    )
    for field, fallback in scalar_defaults.items():
        normalized[field] = clean_scalar(normalized.get(field), fallback)
    for field in list_fields:
        normalized[field] = clean_string_list(
            normalized.get(field),
            object_text_keys=("description", "name", "segment"),
        )

    if not normalized["primary_offerings"]:
        normalized["primary_offerings"] = list(normalized["features"])

    evidence = normalized.get("evidence")
    if not isinstance(evidence, dict):
        evidence = {}
    field_evidence = validate_claim_evidence(
        evidence.get("field_evidence"),
        page_texts,
    )

    for field in (
        "category",
        "target_audience",
        "business_type",
        "delivery_model",
        "unique_value_proposition",
    ):
        value = normalized[field]
        if value != "Unknown" and not value_has_support(
            field,
            value,
            field_evidence,
            page_texts,
        ):
            normalized[field] = "Unknown"

    for field in (
        "industries",
        "features",
        "use_cases",
        "problems_solved",
        "primary_offerings",
        "customer_segments",
    ):
        normalized[field] = [
            value
            for value in normalized[field]
            if value_has_support(
                field,
                value,
                field_evidence,
                page_texts,
            )
        ]

    normalized["regions_served"] = [
        value
        for value in normalized["regions_served"]
        if value_has_explicit_claim(
            "regions_served",
            value,
            field_evidence,
            validator=region_claim_describes_service_area,
        )
    ]
    normalized["pricing_model"] = validated_pricing_value(
        normalized["pricing_model"],
        field_evidence,
    )

    personas = []
    raw_personas = normalized.get("buyer_personas")
    if isinstance(raw_personas, list):
        for index, raw in enumerate(raw_personas[:6], start=1):
            if not isinstance(raw, dict):
                continue
            claims = validate_claim_evidence(
                raw.get("claim_evidence"),
                page_texts,
            )
            buyer_role = validated_persona_scalar(
                raw.get("buyer_role"),
                "buyer_role",
                claims,
                page_texts,
            )
            organization_type = validated_persona_scalar(
                raw.get("organization_type"),
                "organization_type",
                claims,
                page_texts,
            )
            persona = {
                "persona_id": clean_scalar(
                    raw.get("persona_id"), f"persona-{index:02d}"
                ),
                "buyer_role": buyer_role,
                "end_users": validated_persona_list(
                    raw.get("end_users"),
                    "end_users",
                    claims,
                    page_texts,
                ),
                "organization_type": organization_type,
                "organization_sizes": validated_persona_list(
                    raw.get("organization_sizes"),
                    "organization_sizes",
                    claims,
                    page_texts,
                    require_explicit=True,
                    claim_validator=organization_size_claim_is_explicit,
                ),
                "industries": validated_persona_list(
                    raw.get("industries"),
                    "industries",
                    claims,
                    page_texts,
                ),
                "regions": validated_persona_list(
                    raw.get("regions"),
                    "regions",
                    claims,
                    page_texts,
                    require_explicit=True,
                    claim_validator=region_claim_describes_service_area,
                ),
                "jobs_to_be_done": validated_persona_list(
                    raw.get("jobs_to_be_done"),
                    "jobs_to_be_done",
                    claims,
                    page_texts,
                ),
                "buying_triggers": validated_persona_list(
                    raw.get("buying_triggers"),
                    "buying_triggers",
                    claims,
                    page_texts,
                    require_explicit=True,
                ),
                "decision_factors": validated_persona_list(
                    raw.get("decision_factors"),
                    "decision_factors",
                    claims,
                    page_texts,
                    require_explicit=True,
                ),
                "constraints": validated_persona_list(
                    raw.get("constraints"),
                    "constraints",
                    claims,
                    page_texts,
                    require_explicit=True,
                ),
                "confidence": confidence_from_claims(claims),
                "evidence_refs": list(
                    dict.fromkeys(claim["page_id"] for claim in claims)
                ),
                "claim_evidence": claims,
            }
            if (
                persona["buyer_role"] != "Unknown"
                or persona["organization_type"] != "Unknown"
            ) and persona["jobs_to_be_done"]:
                personas.append(persona)

    if not personas and normalized["target_audience"] != "Unknown":
        personas.append(
            {
                "persona_id": "persona-01",
                "buyer_role": "Unknown",
                "end_users": [],
                "organization_type": normalized["target_audience"],
                "organization_sizes": [],
                "industries": list(normalized["industries"]),
                "regions": list(normalized["regions_served"]),
                "jobs_to_be_done": list(normalized["problems_solved"]),
                "buying_triggers": [],
                "decision_factors": [],
                "constraints": [],
                "confidence": "Low",
                "evidence_refs": [],
                "claim_evidence": [],
            }
        )
    normalized["buyer_personas"] = personas

    purchase = normalized.get("purchase_context")
    if not isinstance(purchase, dict):
        purchase = {}
    normalized["purchase_context"] = {
        field: [
            value
            for value in clean_string_list(purchase.get(field))
            if purchase_value_is_supported(
                field,
                value,
                field_evidence,
                page_texts,
            )
        ]
        for field in (
            "engagement_models",
            "deployment_or_delivery",
            "pricing_signals",
            "common_objections",
        )
    }

    scope = normalized.get("competitor_scope")
    if not isinstance(scope, dict):
        scope = {}
    normalized["competitor_scope"] = {
        "direct_peer_description": clean_scalar(
            scope.get("direct_peer_description"), "Unknown"
        ),
        "larger_alternative_types": clean_string_list(
            scope.get("larger_alternative_types")
        ),
        "excluded_provider_types": clean_string_list(
            scope.get("excluded_provider_types")
        ),
    }

    known_urls = {
        str(page.get("url", "")).rstrip("/")
        for page in snapshot.get("pages", [])
        if page.get("url")
    }
    evidence_urls = [
        page_urls[claim["page_id"]]
        for claim in field_evidence
        if claim["page_id"] in page_urls
    ]
    for persona in personas:
        evidence_urls.extend(
            page_urls[ref]
            for ref in persona.get("evidence_refs", [])
            if ref in page_urls
        )
    normalized["evidence"] = {
        "supporting_pages": list(
            dict.fromkeys(
                [
                    url
                    for url in clean_string_list(
                        evidence.get("supporting_pages")
                    )
                    if url.rstrip("/") in known_urls
                ]
                + evidence_urls
            )
        ),
        "unclear_or_missing": clean_string_list(
            evidence.get("unclear_or_missing")
        ),
        "field_evidence": field_evidence,
        "validation": {
            "mode": "exact_quote_and_lexical_support",
            "validated_field_claims": len(field_evidence),
            "validated_persona_claims": sum(
                len(persona.get("claim_evidence", []))
                for persona in personas
            ),
        },
    }
    return normalized


def build_page_evidence_index(
    snapshot: dict[str, Any],
) -> tuple[dict[str, str], dict[str, str]]:
    texts = {}
    urls = {}
    for index, page in enumerate(snapshot.get("pages", []), start=1):
        page_id = f"page-{index:03d}"
        texts[page_id] = normalize_evidence_text(
            " ".join(
                [
                    str(page.get("title", "")),
                    str(page.get("meta_description", "")),
                    json.dumps(page.get("headings", {}), ensure_ascii=False),
                    str(page.get("main_text", "")),
                ]
            )
        )
        urls[page_id] = str(page.get("url", ""))
    return texts, urls


def validate_claim_evidence(
    value: Any,
    page_texts: dict[str, str],
) -> list[dict[str, str]]:
    if not isinstance(value, list):
        return []
    claims = []
    seen = set()
    for item in value:
        if not isinstance(item, dict):
            continue
        field = canonical_field_name(item.get("field"))
        if isinstance(item.get("value"), (list, dict)):
            continue
        claim_value = clean_scalar(item.get("value"), "")
        page_id = clean_scalar(
            item.get("page_id") or item.get("page_ref"), ""
        )
        quote = clean_scalar(item.get("quote"), "")
        normalized_quote = normalize_evidence_text(quote)
        if (
            not field
            or not claim_value
            or page_id not in page_texts
            or len(normalized_quote) < 12
            or normalized_quote not in page_texts[page_id]
            or not claim_value_is_supported_by_quote(
                claim_value,
                normalized_quote,
            )
        ):
            continue
        key = (field, normalize_evidence_text(claim_value), page_id, normalized_quote)
        if key in seen:
            continue
        seen.add(key)
        claims.append(
            {
                "field": field,
                "value": claim_value,
                "page_id": page_id,
                "quote": quote,
            }
        )
    return claims


def claim_value_is_supported_by_quote(
    value: str,
    normalized_quote: str,
) -> bool:
    stop_words = {
        "and",
        "for",
        "from",
        "into",
        "that",
        "the",
        "their",
        "this",
        "with",
        "without",
        "or",
        "a",
        "an",
    }
    tokens = {
        token
        for token in normalize_evidence_text(value).split()
        if len(token) >= 3 and token not in stop_words
    }
    if not tokens:
        return False
    quote_tokens = set(normalized_quote.split())
    required = 1 if len(tokens) == 1 else min(2, len(tokens))
    return len(tokens & quote_tokens) >= required


def canonical_field_name(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(value or "").strip().lower()).strip("_")


def normalize_evidence_text(value: Any) -> str:
    return " ".join(
        re.sub(r"[^a-z0-9]+", " ", str(value or "").lower()).split()
    )


def matching_claims(
    field: str,
    value: str,
    claims: list[dict[str, str]],
) -> list[dict[str, str]]:
    target_field = canonical_field_name(field)
    target_value = normalize_evidence_text(value)
    return [
        claim
        for claim in claims
        if claim["field"].endswith(target_field)
        and normalize_evidence_text(claim["value"]) == target_value
    ]


def value_has_explicit_claim(
    field: str,
    value: str,
    claims: list[dict[str, str]],
    *,
    validator=None,
) -> bool:
    matches = matching_claims(field, value, claims)
    if validator is None:
        return bool(matches)
    return any(validator(claim) for claim in matches)


def value_has_support(
    field: str,
    value: str,
    claims: list[dict[str, str]],
    page_texts: dict[str, str],
) -> bool:
    return value_has_explicit_claim(field, value, claims) or lexical_support(
        value, page_texts
    )


def lexical_support(value: str, page_texts: dict[str, str]) -> bool:
    stop_words = {
        "and",
        "for",
        "from",
        "into",
        "that",
        "the",
        "their",
        "this",
        "with",
        "without",
        "company",
        "business",
        "solution",
        "service",
        "platform",
    }
    tokens = [
        token
        for token in normalize_evidence_text(value).split()
        if len(token) >= 3 and token not in stop_words
    ]
    if not tokens:
        return False
    combined = " ".join(page_texts.values())
    matched = sum(1 for token in set(tokens) if token in combined.split())
    required = 1 if len(set(tokens)) == 1 else min(2, len(set(tokens)))
    return matched >= required


def validated_persona_scalar(
    value: Any,
    field: str,
    claims: list[dict[str, str]],
    page_texts: dict[str, str],
) -> str:
    text = clean_scalar(value, "Unknown")
    if text == "Unknown":
        return text
    return text if value_has_support(field, text, claims, page_texts) else "Unknown"


def validated_persona_list(
    value: Any,
    field: str,
    claims: list[dict[str, str]],
    page_texts: dict[str, str],
    *,
    require_explicit: bool = False,
    claim_validator=None,
) -> list[str]:
    rows = clean_string_list(value)
    if require_explicit:
        return [
            row
            for row in rows
            if value_has_explicit_claim(
                field,
                row,
                claims,
                validator=claim_validator,
            )
        ]
    return [
        row
        for row in rows
        if value_has_support(field, row, claims, page_texts)
    ]


def confidence_from_claims(claims: list[dict[str, str]]) -> str:
    supported_fields = {claim["field"] for claim in claims}
    has_identity = any(
        field.endswith(("buyer_role", "organization_type"))
        for field in supported_fields
    )
    has_need = any(field.endswith("jobs_to_be_done") for field in supported_fields)
    if has_identity and has_need and len(claims) >= 4:
        return "High"
    if has_identity and has_need:
        return "Medium"
    return "Low"


def region_claim_describes_service_area(claim: dict[str, str]) -> bool:
    quote = normalize_evidence_text(claim.get("quote", ""))
    return any(
        phrase in quote
        for phrase in (
            "serve ",
            "serving ",
            "available in ",
            "customers in ",
            "clients in ",
            "across ",
            "worldwide",
            "global ",
            "operates in ",
            "operating in ",
        )
    )


def organization_size_claim_is_explicit(claim: dict[str, str]) -> bool:
    value = normalize_evidence_text(claim.get("value", ""))
    quote = normalize_evidence_text(claim.get("quote", ""))
    aliases = {
        "small": ("small business", "small company", "smb"),
        "medium": ("medium business", "mid size", "mid market", "smb"),
        "large": ("large business", "large company", "enterprise"),
    }
    terms = aliases.get(value, (value,))
    return any(term and term in quote for term in terms)


def validated_pricing_value(
    value: str,
    claims: list[dict[str, str]],
) -> str:
    if value == "Unknown":
        return value
    matches = matching_claims("pricing_model", value, claims)
    return (
        value
        if any(pricing_claim_is_explicit(item) for item in matches)
        else "Unknown"
    )


def pricing_claim_is_explicit(claim: dict[str, str]) -> bool:
    quote = normalize_evidence_text(claim.get("quote", ""))
    if quote_describes_missing_data(quote):
        return False
    return any(
        term in quote
        for term in (
            "price",
            "pricing",
            "cost",
            "per month",
            "per year",
            "subscription",
            "plan",
            "request a quote",
            "contact for a quote",
        )
    )


def quote_describes_missing_data(value: str) -> bool:
    text = normalize_evidence_text(value)
    return any(
        phrase in text
        for phrase in (
            "no pricing",
            "pricing not",
            "not available",
            "not found",
            "unknown",
        )
    )


def purchase_value_is_supported(
    field: str,
    value: str,
    claims: list[dict[str, str]],
    page_texts: dict[str, str],
) -> bool:
    full_field = f"purchase_context_{field}"
    if field in {"pricing_signals", "common_objections"}:
        return value_has_explicit_claim(full_field, value, claims) and not (
            field == "pricing_signals" and quote_describes_missing_data(value)
        )
    return value_has_support(full_field, value, claims, page_texts)


def clean_scalar(value: Any, fallback: str) -> str:
    text = " ".join(str(value or "").split()).strip()
    return text if text else fallback


def clean_string_list(
    value: Any,
    *,
    object_text_keys: tuple[str, ...] = (),
) -> list[str]:
    if not isinstance(value, list):
        return []
    rows = []
    for item in value:
        candidate = item
        if isinstance(item, dict):
            candidate = next(
                (
                    item.get(key)
                    for key in object_text_keys
                    if item.get(key)
                ),
                "",
            )
        text = " ".join(str(candidate or "").split()).strip()
        if text and text.lower() != "unknown":
            rows.append(text)
    return list(dict.fromkeys(rows))


def normalize_confidence(value: Any) -> str:
    text = str(value or "").strip().title()
    return text if text in {"High", "Medium", "Low"} else "Low"
