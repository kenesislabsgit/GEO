from __future__ import annotations

import json
from typing import Any

from .json_tools import extract_json_array
from .llm import LLMNotConfigured, build_chat_payload, call_chat_completion


INTENT_SYSTEM_PROMPT = """You create natural questions that real buyers type into an AI assistant while looking for a provider.

Use the supplied buyer profile as the only source of customer context.
The required_search_frame is the boundary for every question. It describes the
kind of provider, offering, customer, and buying need that make a recommendation
a direct peer. Do not broaden it into a structurally different provider class,
market tier, delivery model, or buying need.
Do not mention the audited company or its domain.
Do not write SEO keywords, survey questions, or formal research language.
Do not ask how to build or implement something.
Every question must clearly request recommendations or a comparison of suitable
providers or products. Write questions in varied, conversational English.

Use only buyer roles, needs, regions, industries, and decision factors supported
by the profile. Do not add a region, budget, company size, or technical
requirement when it is Unknown. Do not force every known detail into every
question. A normal buyer usually expresses one main need and one or two useful
constraints.

Keep each question concise enough to resemble a normal search or chat message.
Use one clear need and no more than two helpful scope details. Spread additional
profile dimensions across the set instead of repeating the full company profile
inside every question.

Every question must contain:
1. A specific supported offering, use case, or customer problem.
2. At least one supported scope anchor: direct provider type, customer type,
   organization size, industry, region, delivery model, or decision factor.

The audited company's own employee count is not a buyer constraint. Use
organization size only when it describes the customers served and is supported.
Do not ask for larger alternative provider types or excluded provider types.
Do not replace the supported market definition with a broader generic category.

Create a balanced direct-peer set covering discovery, problem, use case,
comparison, industry, features, pricing, and decision-making. Only create
pricing or regional questions when those facts are supported.

First draft more questions than requested. Then silently inspect each draft
against required_search_frame and keep only direct-peer buyer searches.

Return only a valid JSON array with exactly requested_question_count objects:
[
  {
    "category": "",
    "buying_stage": "",
    "persona_id": "",
    "intent": "",
    "profile_evidence": [],
    "prompt": ""
  }
]
"""

INTENT_REVIEW_SYSTEM_PROMPT = """You are the final quality reviewer for buyer questions used in an AI visibility audit.

Review the complete candidate set against required_search_frame. Judge meaning,
buyer intent, provider scope, customer scope, and market fit using reasoning,
not keyword matching.

Rewrite or replace any candidate that is generic, unnatural, unsupported,
brand-led, implementation-focused, or likely to compare a specialist provider
with a structurally different class of company. Do not introduce facts absent
from the profile. Do not mention the audited company. Preserve variety across
real discovery, problem, use-case, comparison, and decision-stage searches.
Reject marketing-style or overstuffed wording. Each question should normally be
one short sentence with one buyer need and no more than two scope details.
Distribute industries, delivery preferences, decision factors, and use cases
across different questions rather than repeating them in every question.

Return only a valid JSON array with exactly requested_question_count objects.
Each object must contain category, buying_stage, persona_id, intent,
profile_evidence, and prompt. Every prompt must be a natural question that asks
for suitable providers or products."""


def build_customer_intent_payload(
    company_profile: dict[str, Any],
    *,
    count: int = 30,
) -> dict[str, Any]:
    user_prompt = json.dumps(
        {
            "requested_question_count": count,
            "buyer_profile": build_question_profile_context(company_profile),
        },
        indent=2,
        ensure_ascii=False,
    )
    return build_chat_payload(INTENT_SYSTEM_PROMPT, user_prompt, temperature=0.2)


def build_customer_intent_review_payload(
    company_profile: dict[str, Any],
    candidates: list[dict[str, Any]],
    *,
    count: int,
) -> dict[str, Any]:
    return build_chat_payload(
        INTENT_REVIEW_SYSTEM_PROMPT,
        json.dumps(
            {
                "requested_question_count": count,
                "buyer_profile": build_question_profile_context(
                    company_profile
                ),
                "required_search_frame": build_required_search_frame(
                    company_profile
                ),
                "candidate_questions": candidates,
            },
            indent=2,
            ensure_ascii=False,
        ),
        temperature=0.1,
    )


def generate_customer_intents(
    company_profile: dict[str, Any],
    *,
    count: int = 30,
) -> tuple[list[dict[str, Any]] | None, dict[str, Any], str | None]:
    payload = build_customer_intent_payload(company_profile, count=count)
    profile_issue = question_profile_issue(company_profile)
    if profile_issue:
        return None, payload, profile_issue
    try:
        raw_response = call_chat_completion(payload)
    except (LLMNotConfigured, RuntimeError, TimeoutError) as exc:
        return None, payload, str(exc)

    candidates = sanitize_prompt_records(
        extract_json_array(raw_response), company_profile
    )
    review_payload = build_customer_intent_review_payload(
        company_profile,
        candidates,
        count=count,
    )
    payload["review_payload"] = review_payload
    try:
        reviewed_response = call_chat_completion(review_payload)
    except (LLMNotConfigured, RuntimeError, TimeoutError) as exc:
        return None, payload, f"Question review failed: {exc}"
    prompts = sanitize_prompt_records(
        extract_json_array(reviewed_response), company_profile
    )
    if len(prompts) < count:
        return (
            None,
            payload,
            "Question review did not return enough distinct, profile-matched questions.",
        )
    return prompts[:count], payload, None


def generate_free_customer_intents(
    company_profile: dict[str, Any],
) -> tuple[
    list[dict[str, Any]] | None,
    dict[str, Any],
    str | None,
]:
    profile_issue = question_profile_issue(company_profile)
    if profile_issue:
        return None, {
            "mode": "ai_profile_review",
            "question_count": 0,
            "inputs": build_question_profile_context(company_profile),
        }, profile_issue
    prompts, payload, error = generate_customer_intents(
        company_profile,
        count=5,
    )
    payload["mode"] = "ai_generated_free_preview"
    payload["question_count"] = 5
    payload["inputs"] = build_question_profile_context(company_profile)
    return prompts, payload, error


def question_profile_issue(company_profile: dict[str, Any]) -> str | None:
    category = str(company_profile.get("category", "")).strip()
    offerings = clean_profile_list(
        company_profile.get("primary_offerings")
        or company_profile.get("features", [])
    )
    needs = clean_profile_list(
        company_profile.get("use_cases", [])
    ) + clean_profile_list(company_profile.get("problems_solved", []))
    personas = reliable_buyer_personas(company_profile)
    target_audience = str(
        company_profile.get("target_audience", "")
    ).strip()
    has_audience = (
        isinstance(personas, list)
        and any(
            isinstance(persona, dict)
            and (
                str(persona.get("organization_type", "")).strip().lower()
                not in {"", "unknown"}
                or str(persona.get("buyer_role", "")).strip().lower()
                not in {"", "unknown"}
            )
            for persona in personas
        )
    ) or target_audience.lower() not in {"", "unknown"}

    missing = []
    if category.lower() in {"", "unknown"}:
        missing.append("company category")
    if not offerings and not needs:
        missing.append("offering or customer need")
    if not has_audience:
        missing.append("target customer")
    if not missing:
        return None
    return (
        "The website did not provide enough evidence to generate reliable buyer "
        f"questions. Missing: {', '.join(missing)}."
    )


def build_question_profile_context(
    company_profile: dict[str, Any],
) -> dict[str, Any]:
    personas = reliable_buyer_personas(company_profile)
    return {
        "company_name": company_profile.get("company_name", "Unknown"),
        "category": company_profile.get("category", "Unknown"),
        "business_type": company_profile.get("business_type", "Unknown"),
        "delivery_model": company_profile.get("delivery_model", "Unknown"),
        "regions_served": company_profile.get("regions_served", []),
        "primary_offerings": (
            company_profile.get("primary_offerings")
            or company_profile.get("features", [])
        ),
        "use_cases": company_profile.get("use_cases", []),
        "problems_solved": company_profile.get("problems_solved", []),
        "industries": company_profile.get("industries", []),
        "buyer_personas": personas,
        "purchase_context": company_profile.get("purchase_context", {}),
        "competitor_scope": company_profile.get("competitor_scope", {}),
        "required_search_frame": build_required_search_frame(
            company_profile,
            personas=personas,
        ),
        "unclear_or_missing": company_profile.get("evidence", {}).get(
            "unclear_or_missing", []
        ),
    }


def reliable_buyer_personas(
    company_profile: dict[str, Any],
) -> list[dict[str, Any]]:
    raw_personas = company_profile.get("buyer_personas")
    if not isinstance(raw_personas, list):
        return []
    target_audience = concise_profile_value(
        company_profile.get("target_audience"), ""
    )
    top_level_jobs = (
        clean_profile_list(company_profile.get("problems_solved"))
        + clean_profile_list(company_profile.get("use_cases"))
    )
    reliable = []
    for item in raw_personas:
        if not isinstance(item, dict):
            continue
        persona = dict(item)
        if str(persona.get("confidence", "Medium")).strip().lower() == "low":
            persona["buyer_role"] = "Unknown"
            persona["organization_sizes"] = []
            persona["regions"] = []
            persona["buying_triggers"] = []
            persona["decision_factors"] = []
            persona["constraints"] = []
            persona["organization_type"] = target_audience or "Unknown"
            persona["jobs_to_be_done"] = top_level_jobs
        reliable.append(persona)
    return reliable


def build_required_search_frame(
    company_profile: dict[str, Any],
    *,
    personas: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    personas = personas if personas is not None else reliable_buyer_personas(
        company_profile
    )
    organization_types = clean_profile_list(
        [
            persona.get("organization_type")
            for persona in personas
            if isinstance(persona, dict)
        ]
    )
    organization_sizes = clean_profile_list(
        [
            size
            for persona in personas
            if isinstance(persona, dict)
            for size in clean_profile_list(persona.get("organization_sizes"))
        ]
    )
    return {
        "direct_provider_type": natural_provider_type(company_profile),
        "category": concise_profile_value(
            company_profile.get("category"), "Unknown"
        ),
        "offerings": clean_profile_list(
            company_profile.get("primary_offerings")
            or company_profile.get("features", [])
        )[:5],
        "customer_problems": (
            clean_profile_list(company_profile.get("problems_solved"))
            + clean_profile_list(company_profile.get("use_cases"))
        )[:6],
        "customer_types": organization_types
        or clean_profile_list([company_profile.get("target_audience")]),
        "customer_organization_sizes": organization_sizes,
        "industries": clean_profile_list(company_profile.get("industries"))[:5],
        "regions": clean_profile_list(company_profile.get("regions_served"))[:4],
        "delivery_model": concise_profile_value(
            company_profile.get("delivery_model"), "Unknown"
        ),
        "excluded_provider_types": clean_profile_list(
            (
                company_profile.get("competitor_scope")
                if isinstance(company_profile.get("competitor_scope"), dict)
                else {}
            ).get("excluded_provider_types")
        ),
    }


def concise_profile_value(value: Any, fallback: str, max_length: int = 120) -> str:
    text = " ".join(str(value or "").split()).strip(" .")
    if not text:
        return fallback
    if len(text) <= max_length:
        return text
    return text[: max_length - 3].rstrip() + "..."


def sanitize_prompt_records(
    prompts: list[Any],
    company_profile: dict[str, Any],
) -> list[dict[str, str]]:
    banned_terms = build_banned_terms(company_profile)
    sanitized = []
    seen: set[str] = set()
    for item in prompts:
        if isinstance(item, dict):
            prompt = str(item.get("prompt", "")).strip()
            category = str(item.get("category", "Unknown")).strip() or "Unknown"
            buying_stage = str(item.get("buying_stage", "Unknown")).strip() or "Unknown"
        else:
            prompt = str(item).strip()
            category = "Unknown"
            buying_stage = "Unknown"

        prompt = " ".join(prompt.split())
        if prompt and not prompt.endswith("?"):
            prompt = f"{prompt.rstrip('.')}?"
        key = prompt.lower()
        if (
            not prompt
            or len(prompt) > 260
            or key in seen
            or contains_banned_term(prompt, banned_terms)
        ):
            continue
        seen.add(key)
        sanitized.append(
            {
                "category": category,
                "buying_stage": buying_stage,
                "persona_id": str(item.get("persona_id", "Unknown")).strip()
                if isinstance(item, dict)
                else "Unknown",
                "intent": str(item.get("intent", "Unknown")).strip()
                if isinstance(item, dict)
                else "Unknown",
                "profile_evidence": clean_profile_list(
                    item.get("profile_evidence", [])
                )
                if isinstance(item, dict)
                else [],
                "prompt": prompt,
            }
        )
    return sanitized


def clean_profile_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return list(
        dict.fromkeys(
            text
            for item in value
            if (text := concise_profile_value(item, ""))
            and text.lower() != "unknown"
        )
    )


def natural_provider_type(company_profile: dict[str, Any]) -> str:
    scope = company_profile.get("competitor_scope")
    if isinstance(scope, dict):
        direct = concise_profile_value(
            scope.get("direct_peer_description"), ""
        )
        if direct and direct.lower() != "unknown":
            return direct
    for field in ("delivery_model", "business_type", "category"):
        value = concise_profile_value(company_profile.get(field), "")
        if value and value.lower() != "unknown":
            return value
    return "Unknown"


def build_banned_terms(company_profile: dict[str, Any]) -> set[str]:
    terms = set()
    company_name = str(company_profile.get("company_name", "")).strip()
    if company_name and company_name != "Unknown":
        terms.add(company_name.lower())
        for part in company_name.split():
            if len(part) > 3:
                terms.add(part.lower())

    for page in company_profile.get("evidence", {}).get("supporting_pages", []):
        value = str(page).lower()
        if "://" in value:
            domain = value.split("://", 1)[1].split("/", 1)[0]
            terms.add(domain)
            terms.add(domain.removeprefix("www.").split(".", 1)[0])

    return {term for term in terms if term}


def contains_banned_term(prompt: str, banned_terms: set[str]) -> bool:
    value = prompt.casefold()
    return any(term.casefold() in value for term in banned_terms)
