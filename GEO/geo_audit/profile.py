from __future__ import annotations

import json
import re
import time
from typing import Any
from urllib.parse import urlparse

from .json_tools import extract_json_object
from .llm import LLMNotConfigured, build_chat_payload, call_chat_completion
from .site_facts import detect_site_facts


PROFILE_RULES = """You are an experienced buyer-research analyst.

Build an evidence-backed company and buyer profile that will be used to create
natural, unbranded questions from real prospective customers.

Use only the supplied website pages and evidence. Do not use outside knowledge.
Do not infer company size from visual design or writing style.
Do not invent regions, budgets, buyer roles, industries, or engagement models.
Use "Unknown" or an empty array when the website does not support a value.
An office address is not proof that customers are served only in that region.
Only populate regions_served when a page explicitly describes a market or
service area.
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
The backend calculates confidence; your confidence is only a candidate."""


PROFILE_STYLE = """Writing style. This profile is machine input, not prose.
Nothing here is read by a person, so extra words only cost time.

- Write each list item as a phrase of at most 10 words.
- Drop articles, auxiliary verbs and hedging such as "typically" or "often".
- Never repeat the field name inside its own value.
- State each fact once, in the single field where it fits best. Do not restate
  an offering as a use case, or a use case as a problem.
- Prefer wording that already appears on the page over paraphrase."""


PROFILE_MARKET_RULES = """Who buys from this company. Do not label them. Copy
down what the site shows and let the next step do the thinking.

named_customers: every customer the site names, one row each. Client logo
walls, case studies, testimonials, "trusted by" strips, press quotes, portfolio
pages. Copy the name exactly as written. Put in described_as whatever the site
says that customer is or what was done for them, in its own words, and leave it
empty when the site only shows a name. Give the page_id you found it on.
List every one you find, not a sample and not a summary. Five customers listed
as five rows is the point; "educational institutions and manufacturers" throws
away the very thing we need.
A name in a form field, a placeholder, an "e.g.", a partner or investor logo,
or the company's own brands are not customers. Leave the list empty when the
site names nobody, which is a real and useful answer.

buying_signals: how a purchase happens here, from what the site shows.
pricing_visible: true when any price or plan cost is published.
purchase_path: self_serve when a buyer can sign up and start alone, contact_
sales when they must talk to someone first, both when the site offers each,
unknown when the site shows neither.
buyer_facing_terms: words the site uses for the people it sells to, copied from
the page: "founders", "IT teams", "hospitals", "growing brands".
company_self_description: the words the company uses about itself and its own
standing, copied from the page: "premium global technology partner", "India's
largest broker". These are claims, not facts, and later steps treat them so.

company_name_variants: every way this company's own site writes its own name.

Copy each one exactly as it appears on a page. Nothing else belongs here. Do
not build a variant by shortening a name, by adding or removing a domain
ending, by expanding an abbreviation, or by writing the name the way you think
the company would write it. If the spelling is not printed somewhere on the
site, it does not go in the list.

Include the short name, the full legal name, and the name of the single product
when the site uses that name for the company itself - each only when the site
actually prints it that way. Do not include separate products the company also
sells.

A later step counts how often AI assistants recommend this company and compares
against this list, so one invented spelling adds mentions the company never
earned. A short, honest list is right. A longer, guessed one is not.

site_pages: an inventory of the pages you were given. One row per page that
does a job for a buyer. Say what the page is for in your own plain words, not
by picking from a list of types: "lists three plans with monthly prices",
"walks a new user through setting up on a Mac", "a law firm's account of
switching to it", "answers common questions about billing".

Give the page_id of the page you are describing. Skip pages that carry no
buyer-facing content of their own - a login screen, a cookie notice, an empty
category page. Never describe a page you were not given, and never describe
what a page ought to contain rather than what it does.

This inventory is later compared against the same inventory for competitor
sites, and the advice the company pays for is written from the difference. A
page missing from this list reads as a page the company does not have."""


PROFILE_EVIDENCE_RULES = """Supporting quotes. Only these fields need one:

- regions_served, in evidence.field_evidence
- buyer_role or organization_type, jobs_to_be_done, organization_sizes,
  buying_triggers, decision_factors and constraints, in persona claim_evidence

Copy each quote exactly from the page and keep it under 20 words. The value in
a claim must match the corresponding scalar or array item. Every other field is
checked against the page text directly, so do not write quotes for them."""


PROFILE_SCHEMA = """Return only valid JSON with this exact top-level structure:
{
  "company_name": "",
  "company_name_variants": [],
  "site_pages": [
    {"page_id": "", "what_it_is_for": ""}
  ],
  "category": "",
  "target_audience": "",
  "business_type": "",
  "delivery_model": "",
  "regions_served": [],
  "industries": [],
  "use_cases": [],
  "problems_solved": [],
  "unique_value_proposition": "",
  "primary_offerings": [],
  "buyer_personas": [
    {
      "persona_id": "",
      "buyer_role": "",
      "organization_type": "",
      "organization_sizes": [],
      "jobs_to_be_done": [],
      "buying_triggers": [],
      "decision_factors": [],
      "constraints": [],
      "confidence": "High|Medium|Low",
      "claim_evidence": [
        {
          "field": "buyer_role|organization_type|organization_sizes|jobs_to_be_done|buying_triggers|decision_factors|constraints",
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
  "named_customers": [
    {"name": "", "described_as": "", "page_id": ""}
  ],
  "buying_signals": {
    "pricing_visible": true,
    "purchase_path": "self_serve|contact_sales|both|unknown",
    "buyer_facing_terms": [],
    "company_self_description": []
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
        "field": "regions_served",
        "value": "",
        "page_id": "",
        "quote": ""
      }
    ]
  }
}"""


def build_profile_system_prompt(*, lean: bool = False) -> str:
    max_personas = 1 if lean else 3
    persona_line = (
        "the single most important buyer persona"
        if lean
        else f"at most {max_personas} buyer personas"
    )
    limits = f"""Limits. Return {persona_line}, and at most 5 primary_offerings,
5 use_cases, 5 problems_solved, 5 industries, 4 regions_served, and 3 items in
each purchase_context list. Anything beyond these limits is discarded, so spend
the effort on the strongest items instead."""
    return "\n\n".join(
        [
            PROFILE_RULES,
            PROFILE_STYLE,
            PROFILE_MARKET_RULES,
            PROFILE_EVIDENCE_RULES,
            limits,
            PROFILE_SCHEMA,
        ]
    )


PROFILE_SYSTEM_PROMPT = build_profile_system_prompt()


PROFILE_PAGE_SELECTION_PROMPT = """Choose the website pages that best explain
the company. Select at most five pages that together show what the company is,
what it sells, who it serves, and useful buying proof. Include the homepage.
Prefer pages with different purposes. Use only the supplied page IDs.
Return only JSON: {"page_ids": ["page-001"]}."""


def compact_page_options(snapshot: dict[str, Any]) -> list[dict[str, Any]]:
    """Small page list for the fast page-selection call."""
    options = []
    for index, page in enumerate(snapshot.get("pages", []), start=1):
        headings = page.get("headings")
        if not isinstance(headings, dict):
            headings = {}
        options.append(
            {
                "page_id": f"page-{index:03d}",
                "url": str(page.get("url", ""))[:500],
                "title": str(page.get("title", ""))[:240],
                "meta_description": str(page.get("meta_description", ""))[:400],
                "headings": {
                    level: [str(value)[:240] for value in headings.get(level, [])[:5]]
                    for level in ("h1", "h2")
                    if headings.get(level)
                },
            }
        )
    return options


def build_profile_page_selection_payload(
    snapshot: dict[str, Any],
) -> dict[str, Any]:
    return build_chat_payload(
        PROFILE_PAGE_SELECTION_PROMPT,
        json.dumps(
            {
                "domain": snapshot.get("domain", ""),
                "pages": compact_page_options(snapshot),
            },
            ensure_ascii=False,
        ),
        temperature=0,
        json_response=True,
    )


def select_profile_page_ids(
    snapshot: dict[str, Any],
    *,
    max_pages: int = 5,
) -> tuple[list[str] | None, dict[str, Any] | None, str | None]:
    page_ids = [
        f"page-{index:03d}"
        for index, _ in enumerate(snapshot.get("pages", []), start=1)
    ]
    if len(page_ids) <= max_pages:
        return page_ids, None, None

    payload = build_profile_page_selection_payload(snapshot)
    started = time.perf_counter()
    try:
        response = call_chat_completion(payload)
    except (LLMNotConfigured, RuntimeError, TimeoutError) as exc:
        payload["duration_seconds"] = round(time.perf_counter() - started, 3)
        # Keep the old full-page behaviour when selection fails. Accuracy wins
        # over speed on this rare path.
        return None, payload, f"Profile page selection failed: {exc}"

    parsed = extract_json_object(response)
    payload["duration_seconds"] = round(time.perf_counter() - started, 3)
    payload["selection_response"] = parsed
    requested = parsed.get("page_ids")
    if not isinstance(requested, list):
        return None, payload, "Profile page selection returned no page IDs."

    valid = []
    for value in requested:
        page_id = str(value).strip()
        if page_id in page_ids and page_id not in valid:
            valid.append(page_id)

    homepage_id = page_ids[0]
    valid = [homepage_id, *[page_id for page_id in valid if page_id != homepage_id]]
    if len(valid) < 2:
        return None, payload, "Profile page selection returned too few valid pages."
    return valid[:max_pages], payload, None


def build_company_profile_payload(
    snapshot: dict[str, Any],
    website_evidence: dict[str, Any],
    *,
    lean: bool = False,
    selected_page_ids: list[str] | None = None,
) -> dict[str, Any]:
    compact_snapshot = compact_snapshot_for_llm(
        snapshot,
        selected_page_ids=selected_page_ids,
    )
    user_prompt = json.dumps(
        {
            "website_snapshot": compact_snapshot,
            "website_evidence": website_evidence,
        },
        indent=2,
        ensure_ascii=False,
    )
    return build_chat_payload(
        build_profile_system_prompt(lean=lean),
        user_prompt,
        temperature=0.1,
        json_response=True,
    )


def generate_company_profile(
    snapshot: dict[str, Any],
    website_evidence: dict[str, Any],
    *,
    lean: bool = False,
) -> tuple[dict[str, Any] | None, dict[str, Any], str | None]:
    selected_page_ids, selection_payload, selection_error = (
        select_profile_page_ids(snapshot)
    )
    payload = build_company_profile_payload(
        snapshot,
        website_evidence,
        lean=lean,
        selected_page_ids=selected_page_ids,
    )
    profile_started = time.perf_counter()
    try:
        raw_response = call_chat_completion(payload)
    except TimeoutError:
        try:
            raw_response = call_chat_completion(payload)
        except (LLMNotConfigured, RuntimeError, TimeoutError) as exc:
            payload["page_selection"] = {
                "selected_page_ids": selected_page_ids,
                "error": selection_error,
                "request": selection_payload,
            }
            payload["profile_generation_seconds"] = round(
                time.perf_counter() - profile_started, 3
            )
            return None, payload, f"Company profile request failed: {exc}"
    except (LLMNotConfigured, RuntimeError) as exc:
        payload["page_selection"] = {
            "selected_page_ids": selected_page_ids,
            "error": selection_error,
            "request": selection_payload,
        }
        payload["profile_generation_seconds"] = round(
            time.perf_counter() - profile_started, 3
        )
        return None, payload, str(exc)

    parsed = extract_json_object(raw_response)
    payload["page_selection"] = {
        "selected_page_ids": selected_page_ids,
        "error": selection_error,
        "request": selection_payload,
    }
    payload["profile_generation_seconds"] = round(
        time.perf_counter() - profile_started, 3
    )
    return normalize_company_profile(parsed, snapshot), payload, None


# Pages every website carries that describe no part of its business.
BOILERPLATE_PATH_WORDS = frozenset(
    {
        "privacy",
        "terms",
        "tos",
        "legal",
        "cookie",
        "cookies",
        "gdpr",
        "disclaimer",
        "careers",
        "career",
        "jobs",
        "hiring",
        "login",
        "signin",
        "signup",
        "register",
        "cart",
        "checkout",
        "sitemap",
        "unsubscribe",
    }
)
# Words that carry no meaning of their own in a path. They round out a
# boilerplate name ("terms-of-service") without making a page one.
FILLER_PATH_WORDS = frozenset(
    {
        "policy",
        "policies",
        "notice",
        "notices",
        "statement",
        "agreement",
        "agreements",
        "conditions",
        "page",
        # Singular only. "services" on its own is what a company sells.
        "service",
        "of",
        "and",
        "the",
        "our",
        "use",
        "us",
    }
)
HOME_TEXT_BUDGET = 9000
PAGE_TEXT_BUDGET = 6000
BOILERPLATE_TEXT_BUDGET = 500


def profile_text_budget(url: str) -> int:
    """How much of a page is worth sending to the profile model.

    Size on a website has nothing to do with how much it says about the
    company. On one live site the privacy policy was the largest page we sent;
    on another it was a service agreement in Thai, and both crowded out the
    pages naming customers. Boilerplate is trimmed rather than dropped so that
    every page stays quotable, and the home page earns the most room because
    it is the one page that always describes the business.
    """
    path = urlparse(url).path.strip("/")
    if not path:
        return HOME_TEXT_BUDGET
    if any(is_boilerplate_segment(part) for part in path.split("/")):
        return BOILERPLATE_TEXT_BUDGET
    return PAGE_TEXT_BUDGET


def is_boilerplate_segment(segment: str) -> bool:
    """True when a path segment is only boilerplate naming and nothing else.

    Matching a word anywhere in the path is too blunt. A legaltech firm's
    /legal-tech-solutions and a consent vendor's /products/cookie-manager are
    the products those companies sell, so a segment only counts when every
    word in it is boilerplate or filler.
    """
    words = [word for word in re.split(r"[^a-z0-9]+", segment.lower()) if word]
    if not words or not any(word in BOILERPLATE_PATH_WORDS for word in words):
        return False
    return all(
        word in BOILERPLATE_PATH_WORDS or word in FILLER_PATH_WORDS
        for word in words
    )


def compact_snapshot_for_llm(
    snapshot: dict[str, Any],
    *,
    selected_page_ids: list[str] | None = None,
) -> dict[str, Any]:
    selected = set(selected_page_ids) if selected_page_ids is not None else None
    pages = []
    for index, page in enumerate(snapshot.get("pages", []), start=1):
        page_id = f"page-{index:03d}"
        if selected is not None and page_id not in selected:
            continue
        pages.append(
            {
                "page_id": page_id,
                "url": page.get("url", ""),
                "title": page.get("title", ""),
                "meta_description": page.get("meta_description", ""),
                "headings": page.get("headings", {}),
                "schema_json_ld": page.get("schema_json_ld", []),
                "navigation": page.get("navigation", [])[:30],
                "main_text": page.get("main_text", "")[
                    : profile_text_budget(str(page.get("url", "")))
                ],
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
    for unused_field in (
        "pricing_model",
        "core_messaging",
        "customer_segments",
        "market_signals",
    ):
        normalized.pop(unused_field, None)
    page_texts, page_urls = build_page_evidence_index(snapshot)
    scalar_defaults = {
        "company_name": "Unknown",
        "category": "Unknown",
        "target_audience": "Unknown",
        "business_type": "Unknown",
        "delivery_model": "Unknown",
        "unique_value_proposition": "Unknown",
    }
    list_fields = (
        "company_name_variants",
        "company_locations",
        "regions_served",
        "industries",
        "features",
        "use_cases",
        "problems_solved",
        "keywords",
        "primary_offerings",
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

    normalized["site_pages"] = validate_site_pages(
        normalized.get("site_pages"), page_urls
    )

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

    normalized["named_customers"] = normalize_named_customers(
        normalized.get("named_customers"),
        page_texts,
    )
    site_facts = detect_site_facts(snapshot)
    normalized["buying_signals"] = normalize_buying_signals(
        normalized.get("buying_signals"),
        site_facts,
    )
    # Read off the pages rather than asked for. The model gave Zerodha "India"
    # on one run and "Unknown" on the next from identical input.
    normalized["primary_market"] = site_facts["primary_market"]
    normalized.pop("market_position", None)

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
    normalized["category_validation"] = build_category_validation(normalized)

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


def build_category_validation(profile: dict[str, Any]) -> dict[str, Any]:
    signals = []
    for field in (
        "category",
        "target_audience",
        "industries",
        "use_cases",
        "problems_solved",
        "primary_offerings",
    ):
        value = profile.get(field)
        if isinstance(value, list):
            signals.extend(str(item) for item in value if item)
        elif value and value != "Unknown":
            signals.append(str(value))

    direct_scope = ""
    scope = profile.get("competitor_scope")
    if isinstance(scope, dict):
        direct_scope = clean_scalar(scope.get("direct_peer_description"), "Unknown")
        if direct_scope != "Unknown":
            signals.append(direct_scope)

    signal_count = len([signal for signal in signals if signal.strip()])
    if signal_count >= 5 and direct_scope != "Unknown":
        confidence = "High"
    elif signal_count >= 3:
        confidence = "Medium"
    elif signal_count:
        confidence = "Low"
    else:
        confidence = "Unknown"

    return {
        "confidence": confidence,
        "supported_signal_count": signal_count,
        "direct_peer_description_present": direct_scope != "Unknown",
        "note": (
            "Category confidence is derived from validated website profile fields."
        ),
    }


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


PURCHASE_PATHS = ("self_serve", "contact_sales", "both")
# A customer name is a name. Anything long enough to be a sentence is the
# model summarising a group, which is the one thing this field must not hold.
MAX_CUSTOMER_NAME_WORDS = 8


def normalize_named_customers(
    value: Any,
    page_texts: dict[str, str],
) -> list[dict[str, str]]:
    """Customer names the site really carries, in the site's own words.

    This replaced a five-word tier menu. "enterprise" is a lossy compression of
    "Brakes India, Rajalakshmi Engineering College, Rent Machi" — the label
    dropped four clients out of five and the question writer never saw that the
    company sells to colleges. Names survive that trip; labels do not.

    The name has to appear on the page it is credited to. That is the whole
    check: it costs nothing on a real client wall and it stops an invented
    customer, which no amount of prompt wording reliably does.
    """
    if not isinstance(value, list):
        return []
    rows: list[dict[str, str]] = []
    seen: set[str] = set()
    for item in value:
        if not isinstance(item, dict):
            continue
        name = clean_scalar(item.get("name"), "")
        page_id = clean_scalar(item.get("page_id") or item.get("page_ref"), "")
        key = normalize_evidence_text(name)
        if not key or key in seen or page_id not in page_texts:
            continue
        if len(name.split()) > MAX_CUSTOMER_NAME_WORDS:
            continue
        if key not in page_texts[page_id]:
            continue
        seen.add(key)
        rows.append(
            {
                "name": name,
                "described_as": clean_scalar(item.get("described_as"), ""),
                "page_id": page_id,
            }
        )
    return rows


def normalize_buying_signals(
    value: Any,
    site_facts: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """How a purchase happens here, as shown rather than as judged.

    Whether prices are published and whether a buyer can start alone are both
    countable, and code counts them the same way every run. The model called
    Zerodha and Stripe contact-sales when both let anyone sign up, and said
    Zerodha published no prices while ₹20 per order sits on the page. Only the
    wording fields are left to it, because those are quotations, not counts.
    """
    raw = value if isinstance(value, dict) else {}
    facts = site_facts if isinstance(site_facts, dict) else {}
    path = clean_scalar(
        facts.get("purchase_path") or raw.get("purchase_path"), ""
    ).strip().lower()
    return {
        "pricing_visible": bool(
            facts.get("pricing_visible")
            if "pricing_visible" in facts
            else raw.get("pricing_visible")
        ),
        "purchase_path": path if path in PURCHASE_PATHS else "unknown",
        "buyer_facing_terms": clean_string_list(raw.get("buyer_facing_terms")),
        "company_self_description": clean_string_list(
            raw.get("company_self_description")
        ),
    }


def validated_market_evidence(
    value: Any,
    page_texts: dict[str, str],
) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}
    page_id = clean_scalar(value.get("page_id") or value.get("page_ref"), "")
    quote = clean_scalar(value.get("quote"), "")
    if page_id not in page_texts:
        return {}
    kept = quote_or_verbatim_part(quote, page_texts[page_id])
    if not kept:
        return {}
    return {"page_id": page_id, "quote": kept}


def quote_or_verbatim_part(quote: str, page_text: str) -> str:
    """The quote if the page carries it, else the one sentence in it that fits.

    Models stitch two sentences from opposite ends of a page into one quote.
    Stripe lost its whole customer tier that way twice, even though "Powering
    businesses of all sizes" sits on the cited page word for word. Keeping the
    part that survives loses nothing we could check anyway.
    """
    normalized = normalize_evidence_text(quote)
    if len(normalized) >= 12 and normalized in page_text:
        return quote
    for part in re.split(r"[.;|—–]", quote):
        part = part.strip()
        piece = normalize_evidence_text(part)
        if len(piece) >= 20 and piece in page_text:
            return part
    return ""


SITE_PAGES_SYSTEM_PROMPT = """You are given the pages of one company's website.

Say what each page is for, in your own plain words: "lists three plans with
monthly prices", "walks a new user through setting up on a Mac", "a law firm's
account of switching to it", "answers common questions about billing".

Do not sort pages into types. Describe what a buyer would actually get from
each one.

One row per page that does a job for a buyer. Skip pages with no buyer-facing
content of their own - a login screen, a cookie notice, an empty category page.
Never describe a page you were not given, and never describe what a page ought
to contain.

Give the page_id of the page you are describing.

This list is compared against the same list for a rival's site, and the advice
a company pays for is written from the difference. A page you leave out reads
as a page the company does not have. A page you invent sends the advice the
wrong way entirely.

Return only JSON:
{"site_pages": [{"page_id": "", "what_it_is_for": ""}]}
"""


def describe_site_pages(snapshot: dict[str, Any]) -> list[dict[str, str]]:
    """What each page of a competitor's site is for.

    The audited company gets this for free inside its own profile call, which
    already reads every page. A competitor has no such call, and until now its
    site was judged by looking for words like "pricing" in a link - so a rival
    whose prices live at "how much it costs" was reported as publishing none.

    A failure returns an empty list. The audit then carries on with the word
    search it used before rather than stopping.
    """
    pages = snapshot.get("pages") or []
    if not pages:
        return []
    compact = []
    for index, page in enumerate(pages, start=1):
        compact.append(
            {
                "page_id": f"page-{index:03d}",
                "url": page.get("url", ""),
                "title": page.get("title", ""),
                "headings": page.get("headings", {}),
                "text": str(page.get("main_text", ""))[:1500],
            }
        )
    payload = build_chat_payload(
        SITE_PAGES_SYSTEM_PROMPT,
        json.dumps({"pages": compact}, ensure_ascii=False),
        temperature=0,
        json_response=True,
    )
    try:
        response = extract_json_object(call_chat_completion(payload))
    except (LLMNotConfigured, RuntimeError, ValueError):
        return []
    page_urls = {row["page_id"]: row["url"] for row in compact}
    return validate_site_pages(
        response.get("site_pages") if isinstance(response, dict) else None,
        page_urls,
    )


def validate_site_pages(
    value: Any,
    page_urls: dict[str, str],
) -> list[dict[str, str]]:
    """What each page on this site is for, in the model's own words.

    This replaces looking for the word "pricing" in a link. A site whose
    pricing lives at "how much it costs" used to be reported as having no
    pricing page, and the advice the customer paid for then told them to build
    one they already had.

    No supporting quote is asked for here. Elsewhere a quote settles whose page
    this is, because a search result could belong to anybody. These pages were
    crawled from one site we chose, so ownership is not in question and the
    quote would only be checking our own work. The address is taken from the
    crawl by page_id and never from the model, and a page_id we did not send is
    dropped - which is the whole of what needs guarding.
    """
    if not isinstance(value, list):
        return []
    rows = []
    seen = set()
    for item in value:
        if not isinstance(item, dict):
            continue
        page_id = clean_scalar(item.get("page_id") or item.get("page_ref"), "")
        what_for = clean_scalar(
            item.get("what_it_is_for") or item.get("purpose"), ""
        )
        if not page_id or not what_for or page_id not in page_urls or page_id in seen:
            continue
        seen.add(page_id)
        rows.append(
            {
                "page_id": page_id,
                "url": page_urls[page_id],
                "what_it_is_for": what_for,
            }
        )
    return rows


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
