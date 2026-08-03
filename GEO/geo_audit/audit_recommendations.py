from __future__ import annotations

import json
import re
from typing import Any
from urllib.parse import urlparse

from .json_tools import extract_json_array, extract_json_object
from .firecrawl import (
    FirecrawlClient,
    FirecrawlError,
    environment_int,
    firecrawl_document_to_page,
)
from .llm import LLMNotConfigured, build_chat_payload, call_chat_completion


EVIDENCE_TYPES = (
    "homepage_message",
    "use_case_page",
    "feature_page",
    "pricing_page",
    "faq_page",
    "customer_proof",
    "documentation",
    "comparison_page",
    "external_mention",
)

def build_free_preview_recommendations(
    company_profile: dict[str, Any],
    recommendation_patterns: dict[str, Any],
) -> list[dict[str, Any]]:
    company_name = str(company_profile.get("company_name", "This company"))
    summary = recommendation_patterns.get("user_recommendation_summary", {})
    responses = int(summary.get("responses_analyzed", 0) or 0)
    mentions = int(summary.get("user_mentions", 0) or 0)
    top_competitors = [
        str(item.get("company_name", "")).strip()
        for item in recommendation_patterns.get("top_competitors", [])[:3]
        if str(item.get("company_name", "")).strip()
    ]
    competitor_text = ", ".join(top_competitors) or "other providers"
    categories = list(
        dict.fromkeys(
            str(item.get("category", "")).strip()
            for item in summary.get("prompts_where_user_was_not_recommended", [])
            if str(item.get("category", "")).strip()
        )
    )[:2]
    focus = " and ".join(categories) or str(
        company_profile.get("category", "the core category")
    )

    if mentions:
        observation = (
            f"{company_name} appeared in {mentions} of {responses} sampled AI answers."
        )
        action = (
            f"Strengthen the pages explaining {focus} with specific capabilities, "
            "customer outcomes, and verifiable proof."
        )
    else:
        observation = (
            f"{company_name} was not recommended in the {responses} sampled AI answers."
        )
        action = (
            f"Create clearer, evidence-backed pages connecting {company_name} to "
            f"{focus}, including concrete capabilities and customer outcomes."
        )

    return [
        {
            "observation": observation,
            "evidence": (
                f"The sampled model recommended {competitor_text} instead. "
                "This free preview uses one AI model and does not independently "
                "verify those competitors."
            ),
            "suggested_change": action,
            "expected_impact": (
                "Makes the company offering and proof easier for buyers and AI "
                "systems to understand."
            ),
            "confidence": "Low",
            "evidence_types": [],
            "evidence_refs": [],
            "supporting_evidence": [],
            "evidence_validation": {
                "mode": "free_preview_answer_only",
                "requested_refs": [],
                "accepted_refs": [],
                "rejected_refs": [],
            },
        }
    ]


AUDIT_RECOMMENDATION_SYSTEM_PROMPT = """You are an AI recommendation audit analyst.

Generate prioritized recommendations using only the provided evidence.

Every recommendation must include:
- observation
- evidence
- suggested_change
- expected_impact
- confidence
- evidence_types
- evidence_refs
- affected_loss_refs

Start from the buyer questions the audited company lost.
recommendation_patterns.user_company_recommendation_summary.prompt_losses lists
each lost question with a loss_id and the companies recommended instead.
Order recommendations so the ones addressing lost questions come first.
Select up to 3 affected_loss_refs, using loss_id values only from prompt_losses.
Only select a loss when the suggested change would change what a reader learns
about that specific question. Return an empty list when none apply.

Worked example of the expected specificity:

  observation: "Three lost questions asked about PPE compliance monitoring, and
    the site has no page describing that workflow."
  evidence: "Lost loss-002 and loss-005 to Coram and Triya. Both publish a
    dedicated PPE compliance page describing detection, alerting, and reporting."
  suggested_change: "Publish a PPE compliance monitoring page covering detection
    coverage, alert routing, and the reporting output, with a named deployment."
  affected_loss_refs: ["loss-002", "loss-005"]

Avoid recommendations that would read the same for any company in this category.

Do not give generic SEO advice.
Do not frame impact as search engine ranking, search snippets, or SEO visibility.
Do not claim that any change will make an AI system recommend the company.
Do not say a change will increase the likelihood or chances of being recommended.
Frame impact as improving clarity, machine readability, evidence quality, or alignment with observed competitor patterns.
Every recommendation must connect to at least one observed AI recommendation result, cited source pattern, prompt loss, or recurring competitor pattern.
Do not imply causation from competitor patterns. Use phrasing such as "observed among repeatedly recommended competitors" instead of "caused recommendations".
If competitor website collection failed or a field is Unknown, do not treat it as Missing.
Prefer recommendations that address the user's prompt losses and source evidence before generic website gaps.
Say "Unknown" when evidence is missing.

user_website_pages holds the audited company's own pages in its own words.
Read them before writing any advice, and say what is actually true of the site
rather than what its missing page types imply.

- When a page already makes the point, say so and ask for it to be developed.
  "Your home page mentions this in one line while the competitor devotes a page
  to it" is accurate, specific, and something the reader can act on today.
- Only call something absent when you have read the pages and it is absent.
  Telling a company to start saying what it already says reads as though nobody
  looked at their site, and the rest of the report is disbelieved with it.
- Quote their own words back when you have them. A short quote from their page
  beside a competitor's is the clearest way to show the difference in depth.

Select up to 3 evidence_refs only from evidence_catalog.

A citation is what lets the reader check a claim without taking your word for
it, so it has to carry its own weight. Each item gives you an address, the page
title and an extract. Nothing tells you what kind of page it is, because that
judgement is yours to make from what you can see.

- Cite a page a buyer could reach and read. Checkout screens, cart and basket
  pages, machine endpoints, session links and anything behind a login are not
  pages a buyer lands on while looking for a provider.
- Quote something the company states: a claim, a capability it describes, a
  price it publishes, a customer it names. Interface wording is not a
  statement. Totals, form fields, button labels, cookie notices and navigation
  describe the screen rather than the company.
- The extract must support the exact point being made, closely enough that a
  reader sees the connection without it being explained.
- Where several items carry the same fact, cite the one a buyer would find
  first. A pricing page and a checkout screen may show the same number; only
  one of them is where a buyer would read it.
- Cite nothing rather than the nearest thing. A point left unsupported is
  honest; a point propped up by an unrelated page is not.

Do not select evidence merely because its company name or a broad word appears in the recommendation.
If no catalog item directly supports a recommendation, return empty evidence_types and evidence_refs.

summary is the one thing the reader sees first: three or four sentences saying
where this company stands and why. Say what the AI assistants take this company
to be, where it is recommended and where it is passed over, and which
competitor it keeps losing to. Name the single most useful thing to change.

Write it to somebody who owns the company and has thirty seconds. No preamble,
no restating the question, no advice to "consider" anything. Numbers where they
carry weight: "recommended in six of twenty answers, ranked first in three of
those" tells them more than "moderate visibility". If they were never
recommended, say that plainly rather than softening it.

Return only the required JSON object.
"""

# Four sentences read in thirty seconds, not a page.
AUDIT_SUMMARY_LENGTH = 700
AUDIT_RECOMMENDATION_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "recommendations": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "observation": {"type": "string"},
                    "evidence": {"type": "string"},
                    "suggested_change": {"type": "string"},
                    "expected_impact": {"type": "string"},
                    "confidence": {
                        "type": "string",
                        "enum": ["High", "Medium", "Low"],
                    },
                    "evidence_types": {
                        "type": "array",
                        "items": {"type": "string", "enum": list(EVIDENCE_TYPES)},
                        "maxItems": 3,
                    },
                    "evidence_refs": {
                        "type": "array",
                        "items": {"type": "string"},
                        "maxItems": 3,
                    },
                    "affected_loss_refs": {
                        "type": "array",
                        "items": {"type": "string"},
                        "maxItems": 3,
                    },
                },
                "required": [
                    "observation",
                    "evidence",
                    "suggested_change",
                    "expected_impact",
                    "confidence",
                    "evidence_types",
                    "evidence_refs",
                    "affected_loss_refs",
                ],
            },
        },
        "summary": {"type": "string"},
    },
    "required": ["recommendations", "summary"],
}


def generate_audit_recommendations(
    company_profile: dict[str, Any],
    user_evidence: dict[str, Any],
    recommendation_patterns: dict[str, Any],
    competitor_evidence: dict[str, Any],
    comparison: dict[str, Any],
    *,
    user_snapshot: dict[str, Any] | None = None,
    firecrawl_client: FirecrawlClient | None = None,
    limit: int | None = None,
) -> tuple[list[dict[str, Any]] | None, dict[str, Any], str | None]:
    """limit keeps only the top N written actions. The free audit asks for one,
    and that one must be the model's own writing — the deterministic
    top-competitor finding is kept only as a fallback when the model returns
    nothing at all."""
    evidence_catalog = build_verified_evidence_catalog(competitor_evidence)
    payload = build_audit_recommendations_payload(
        company_profile,
        user_evidence,
        recommendation_patterns,
        competitor_evidence,
        comparison,
        evidence_catalog=evidence_catalog,
        user_snapshot=user_snapshot,
    )
    try:
        raw_response = call_chat_completion(payload)
    except LLMNotConfigured as exc:
        return None, payload, str(exc)

    if raw_response.lstrip().startswith("["):
        parsed = extract_json_array(raw_response)
        summary = ""
    else:
        response = extract_json_object(raw_response)
        parsed = response.get("recommendations", [])
        summary = concise_text(response.get("summary"), AUDIT_SUMMARY_LENGTH)
    if not isinstance(parsed, list):
        parsed = []
    # Where the report stands is written once, in the call that already knows
    # everything, and read straight off the payload afterwards. A dashboard
    # that picked one of three sentences off the mention rate was the only
    # thing standing in for it.
    payload["summary"] = summary

    prompt_losses = compact_recommendation_patterns(recommendation_patterns)[
        "user_company_recommendation_summary"
    ]["prompt_losses"]

    normalized = [normalize_recommendation(item) for item in parsed]
    if limit:
        normalized = normalized[:limit]
    if limit and normalized:
        with_top_finding = normalized
    else:
        with_top_finding = ensure_top_competitor_finding(
            normalized,
            recommendation_patterns,
            competitor_evidence,
            evidence_catalog=evidence_catalog,
            company_name=str(company_profile.get("company_name", "")),
            prompt_losses=prompt_losses,
        )[: limit or None]
    resolved = resolve_recommendation_evidence(
        with_top_finding, evidence_catalog
    )
    resolved = resolve_affected_prompts(resolved, prompt_losses)
    if firecrawl_client is not None:
        resolved = verify_selected_evidence_with_firecrawl(
            resolved, firecrawl_client
        )
    return resolved, payload, None


def build_audit_recommendations_payload(
    company_profile: dict[str, Any],
    user_evidence: dict[str, Any],
    recommendation_patterns: dict[str, Any],
    competitor_evidence: dict[str, Any],
    comparison: dict[str, Any],
    *,
    evidence_catalog: list[dict[str, Any]] | None = None,
    user_snapshot: dict[str, Any] | None = None,
) -> dict[str, Any]:
    catalog = (
        evidence_catalog
        if evidence_catalog is not None
        else build_verified_evidence_catalog(competitor_evidence)
    )
    data = {
        "company_profile": company_profile,
        "user_website_evidence": user_evidence,
        "user_website_pages": user_page_excerpts(user_snapshot),
        "recommendation_patterns": compact_recommendation_patterns(
            recommendation_patterns
        ),
        "competitor_evidence": compact_competitor_evidence(competitor_evidence),
        "comparison": compact_comparison(comparison),
        "evidence_catalog": [readable_evidence_row(row) for row in catalog],
    }
    payload = build_chat_payload(
        AUDIT_RECOMMENDATION_SYSTEM_PROMPT,
        json.dumps(data, separators=(",", ":"), ensure_ascii=False),
        temperature=0.2,
        json_response=True,
    )
    payload["response_format"] = {
        "type": "json_schema",
        "json_schema": {
            "name": "audit_recommendations",
            "strict": True,
            "schema": AUDIT_RECOMMENDATION_SCHEMA,
        },
    }
    return payload


def compact_recommendation_patterns(
    recommendation_patterns: dict[str, Any],
) -> dict[str, Any]:
    # aggregation.py writes "user_recommendation_summary"; read that exact key.
    user_summary = recommendation_patterns.get("user_recommendation_summary", {})
    return {
        "summary": recommendation_patterns.get("summary", {}),
        "user_company_recommendation_summary": {
            "responses": user_summary.get("responses_analyzed"),
            "user_mentions": user_summary.get("user_mentions"),
            "mention_rate": user_summary.get("user_mention_rate"),
            "average_rank": user_summary.get("user_average_rank"),
            "prompt_losses": [
                {
                    "loss_id": f"loss-{position:03d}",
                    "prompt": item.get("prompt"),
                    "category": item.get("category"),
                    "assistant": item.get("assistant"),
                    "recommended_instead": item.get("recommended_instead", [])[:5],
                }
                for position, item in enumerate(
                    user_summary.get(
                        "prompts_where_user_was_not_recommended", []
                    )[:10],
                    start=1,
                )
            ],
            "prompt_wins": [
                {
                    "prompt": item.get("prompt"),
                    "category": item.get("category"),
                    "assistant": item.get("assistant"),
                    "rank": item.get("rank"),
                }
                for item in user_summary.get(
                    "prompts_where_user_was_recommended", []
                )[:10]
            ],
        },
        "top_competitors": [
            {
                "company_name": item.get("company_name"),
                "mention_frequency": item.get("mention_frequency"),
                "average_rank": item.get("average_rank"),
                "assistants": item.get("assistants", []),
                "models": item.get("models", []),
                "sample_reasoning": item.get("sample_reasoning", [])[:2],
                "prompts": item.get("prompts", [])[:3],
            }
            for item in recommendation_patterns.get("top_competitors", [])[:10]
        ],
    }


def compact_competitor_evidence(
    competitor_evidence: dict[str, Any],
) -> dict[str, Any]:
    return {
        "summary": competitor_evidence.get("summary", {}),
        "competitors": [
            {
                "company_name": item.get("company_name", "Unknown"),
                "recommendation_pattern": item.get("recommendation_pattern", {}),
                "website_verified": bool(item.get("website_evidence")),
                "collection_status": item.get("collection_status", "Unknown"),
            }
            for item in competitor_evidence.get("competitors", [])
        ],
    }


def compact_comparison(comparison: dict[str, Any]) -> dict[str, Any]:
    return {
        "summary": comparison.get("summary", {}),
        "comparisons": [
            {
                "field": item.get("field"),
                "label": item.get("label"),
                "user_status": (item.get("user_result") or {}).get("status"),
                "competitors": [
                    {
                        "company_name": row.get("company_name"),
                        "status": (row.get("result") or {}).get("status"),
                    }
                    for row in item.get("competitor_results", [])
                ],
                "gap": item.get("gap", {}),
            }
            for item in comparison.get("comparisons", [])
        ],
    }


EVIDENCE_ROW_FIELDS_FOR_MODEL = (
    "evidence_id",
    "company_name",
    "title",
    "url",
    "excerpt",
)


def readable_evidence_row(row: dict[str, Any]) -> dict[str, Any]:
    """An evidence row with our guess about the page removed.

    We label pages by looking for words in their address, which is a guess and
    was wrong. A checkout screen reached us as "Product or feature page" solely
    because the address carried "?products=", and the model believed the label
    over the address and the extract sitting beside it, both of which said cart.

    What is left is only what we actually know: where the page is, what it is
    called, and what it says. Deciding what kind of page that makes it is the
    model's job, and it reads the evidence better than a keyword ever did.
    """
    return {
        field: row.get(field, "")
        for field in EVIDENCE_ROW_FIELDS_FOR_MODEL
        if row.get(field, "") != ""
    }


USER_PAGE_EXCERPT_LENGTH = 700


def user_page_excerpts(snapshot: dict[str, Any] | None) -> list[dict[str, str]]:
    """The audited company's own pages, in its own words.

    Competitors reached this step as pages with real text while the company
    paying for the audit arrived as a headline and a row of true/false flags.
    So the model could read what a rival says and only whether the customer
    owns a page type, which is not enough to tell "they never mention this"
    from "they mention it once on the home page". Those need opposite advice,
    and only the second one can be quoted back to them.

    A longer excerpt than a competitor gets, because this is the site the
    advice is about.
    """
    pages = (snapshot or {}).get("pages")
    if not isinstance(pages, list):
        return []
    rows = []
    seen: set[str] = set()
    for page in pages:
        if not isinstance(page, dict):
            continue
        key = canonical_url(page.get("url"))
        text = concise_text(page.get("main_text"), USER_PAGE_EXCERPT_LENGTH)
        if not key or key in seen or not text:
            continue
        seen.add(key)
        rows.append(
            {
                "url": str(page.get("url", "")),
                "title": concise_text(page.get("title"), 100),
                "text": text,
            }
        )
    return rows


def page_urls_for_field(value: Any) -> list[str]:
    """Every URL an evidence field points at, however it recorded them."""
    if not isinstance(value, dict) or not value.get("found"):
        return []
    matches = value.get("matches")
    if isinstance(matches, list):
        return [
            str(item.get("url", ""))
            for item in matches
            if isinstance(item, dict) and item.get("url")
        ]
    return [str(url) for url in value.get("urls", []) or []]


def build_verified_evidence_catalog(
    competitor_evidence: dict[str, Any],
) -> list[dict[str, Any]]:
    catalog: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str]] = set()

    def add(
        company_name: str,
        evidence_type: str,
        label: str,
        url: Any,
        *,
        title: Any = None,
        excerpt: Any = None,
        provenance: str = "competitor_website",
    ) -> None:
        clean_url = valid_http_url(url)
        if not clean_url:
            return
        key = (normalize_name(company_name), evidence_type, clean_url)
        if key in seen:
            return
        seen.add(key)
        catalog.append(
            {
                "evidence_id": f"ev-{len(catalog) + 1:03d}",
                "company_name": company_name,
                "evidence_type": evidence_type,
                "label": label,
                "title": concise_text(title or page_name_from_url(clean_url), 100),
                "url": clean_url,
                "excerpt": concise_text(excerpt, 220),
                "provenance": provenance,
            }
        )

    field_map = (
        ("use_case_pages_found", "use_case_page", "Use-case page"),
        ("feature_pages_found", "feature_page", "Product or feature page"),
        ("pricing_page_found", "pricing_page", "Pricing page"),
        ("faq_page_found", "faq_page", "FAQ page"),
        (
            "testimonials_or_case_studies_found",
            "customer_proof",
            "Customer proof or case study",
        ),
        ("documentation_found", "documentation", "Documentation"),
        ("comparison_pages_found", "comparison_page", "Comparison page"),
    )

    for competitor in competitor_evidence.get("competitors", []):
        company_name = str(competitor.get("company_name", "Unknown"))
        website = competitor.get("website_evidence") or {}
        snapshot_pages = {
            canonical_url(page.get("url")): page
            for page in (competitor.get("website_snapshot") or {}).get("pages", [])
            if page.get("url")
        }
        homepage_url = website.get("homepage_url")
        for field, label in (
            ("homepage_headline", "Homepage headline"),
            ("homepage_subheadline", "Homepage subheadline"),
        ):
            excerpt = str(website.get(field, "")).strip()
            if meaningful_text(excerpt):
                add(
                    company_name,
                    "homepage_message",
                    label,
                    homepage_url,
                    title=label,
                    excerpt=excerpt,
                    provenance=page_provenance(
                        snapshot_pages.get(canonical_url(homepage_url))
                    ),
                )

        # Every page we actually read, not the ones a keyword list approved.
        # Triya was recommended fourteen times and reached the model with one
        # citable page, its home page, because the rest of its site had not
        # landed in a bucket named after a word in its address. The pages were
        # fetched and sitting right here. Which one proves a point is a
        # judgement, and the model makes it better than the address does.
        typed_urls = {
            canonical_url(url): evidence_type
            for field, evidence_type, _label in field_map
            for url in page_urls_for_field(website.get(field))
        }
        for key, page in snapshot_pages.items():
            if key == canonical_url(homepage_url):
                continue
            add(
                company_name,
                typed_urls.get(key, "site_page"),
                "Page on the competitor's website",
                page.get("url"),
                title=page.get("title"),
                excerpt=page_excerpt(page),
                provenance=page_provenance(page),
            )

        for mention in competitor.get("verified_web_mentions", [])[:3]:
            if (
                not mention.get("verified")
                or mention.get("source_type") == "official_site"
                or not mention.get("matched_context_terms")
            ):
                continue
            add(
                company_name,
                "external_mention",
                "Independent web mention",
                mention.get("url"),
                title=mention.get("title") or mention.get("domain"),
                excerpt=mention.get("snippet"),
                provenance="independent_web_search",
            )
    return catalog


def verify_selected_evidence_with_firecrawl(
    recommendations: list[dict[str, Any]],
    client: FirecrawlClient,
) -> list[dict[str, Any]]:
    max_pages = max(0, environment_int("FIRECRAWL_MAX_FINAL_EVIDENCE_PAGES", 6))
    cache: dict[str, dict[str, Any] | None] = {}
    attempts = 0
    for recommendation in recommendations:
        verified_rows = []
        rejected = recommendation.get("evidence_validation", {}).setdefault(
            "rejected_refs", []
        )
        for row in recommendation.get("supporting_evidence", []):
            url = valid_http_url(row.get("url"))
            if not url:
                continue
            needs_stronger_content = (
                not meaningful_text(row.get("excerpt"))
                or row.get("evidence_type") == "external_mention"
            )
            if not needs_stronger_content:
                verified_rows.append(row)
                continue
            key = canonical_url(url)
            if key not in cache and attempts < max_pages and client.can_request():
                attempts += 1
                try:
                    document = client.scrape(url)
                    cache[key] = document
                except FirecrawlError:
                    cache[key] = None
            document = cache.get(key)
            if not document:
                verified_rows.append(row)
                continue
            page = firecrawl_document_to_page(document, url)
            if not page_supports_evidence(row, page):
                rejected.append(
                    {
                        "evidence_id": row.get("evidence_id"),
                        "reason": "firecrawl_content_mismatch",
                    }
                )
                continue
            verified_rows.append(
                {
                    **row,
                    "title": page.get("title") or row.get("title"),
                    "excerpt": page_excerpt(page),
                    "provenance": "firecrawl_verified",
                    "verification": {
                        "provider": "firecrawl",
                        "status": "verified",
                        "url": page.get("url") or url,
                        "fetched_at": page.get("fetched_at"),
                    },
                }
            )
        recommendation["supporting_evidence"] = verified_rows
        recommendation["evidence_validation"]["accepted_refs"] = [
            row.get("evidence_id") for row in verified_rows
        ]
    return recommendations


def normalize_recommendation(item: Any) -> dict[str, Any]:
    if not isinstance(item, dict):
        return {
            "observation": str(item),
            "evidence": "Unknown",
            "suggested_change": "Unknown",
            "expected_impact": "Unknown",
            "confidence": "Low",
            "evidence_types": [],
            "evidence_refs": [],
            "affected_loss_refs": [],
        }
    return {
        "observation": str(item.get("observation", "Unknown")),
        "evidence": item.get("evidence", "Unknown"),
        "suggested_change": item.get("suggested_change", "Unknown"),
        "expected_impact": str(item.get("expected_impact", "Unknown")),
        "confidence": normalize_confidence(item.get("confidence", "Low")),
        "evidence_types": normalize_evidence_types(item.get("evidence_types", [])),
        "evidence_refs": normalize_string_list(item.get("evidence_refs", []))[:3],
        "affected_loss_refs": normalize_string_list(
            item.get("affected_loss_refs", [])
        )[:3],
    }


def resolve_affected_prompts(
    recommendations: list[dict[str, Any]],
    prompt_losses: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Turn model-selected loss_ids into the real lost questions.

    Mirrors resolve_recommendation_evidence: the model may only reference
    losses that were actually supplied, and anything else is dropped.
    """
    by_id = {
        str(loss.get("loss_id")): loss
        for loss in prompt_losses
        if loss.get("loss_id")
    }
    resolved = []
    for recommendation in recommendations:
        accepted = []
        seen: set[str] = set()
        for loss_id in recommendation.get("affected_loss_refs", []):
            loss = by_id.get(loss_id)
            if loss is None or loss_id in seen:
                continue
            seen.add(loss_id)
            accepted.append(
                {
                    "loss_id": loss_id,
                    "prompt": loss.get("prompt"),
                    "category": loss.get("category"),
                    "assistant": loss.get("assistant"),
                    "recommended_instead": loss.get("recommended_instead", [])[:5],
                }
            )
        resolved.append({**recommendation, "affected_prompts": accepted})
    return resolved


def resolve_recommendation_evidence(
    recommendations: list[dict[str, Any]],
    evidence_catalog: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    by_id = {
        str(row.get("evidence_id")): row
        for row in evidence_catalog
        if row.get("evidence_id")
    }
    resolved = []
    for recommendation in recommendations:
        requested_refs = normalize_string_list(
            recommendation.get("evidence_refs", [])
        )[:3]
        accepted = []
        rejected = []
        seen = set()
        for evidence_id in requested_refs:
            row = by_id.get(evidence_id)
            if row is None:
                rejected.append(
                    {"evidence_id": evidence_id, "reason": "unknown_evidence_id"}
                )
                continue
            if evidence_id in seen:
                continue
            seen.add(evidence_id)
            accepted.append(dict(row))
        # Read off what was cited rather than asked for. The model no longer
        # sees our page labels, so it cannot echo them back, and checking its
        # echo against a label we guessed wrong was never a real check anyway.
        resolved.append(
            {
                **recommendation,
                "evidence_types": normalize_evidence_types(
                    [row.get("evidence_type") for row in accepted]
                ),
                "supporting_evidence": accepted,
                "evidence_validation": {
                    "mode": "catalog_ids",
                    "requested_refs": requested_refs,
                    "accepted_refs": [
                        row.get("evidence_id") for row in accepted
                    ],
                    "rejected_refs": rejected,
                },
            }
        )
    return resolved


def normalize_confidence(value: Any) -> str:
    text = str(value).strip().title()
    return text if text in {"High", "Medium", "Low"} else "Low"


def normalize_evidence_types(value: Any) -> list[str]:
    values = normalize_string_list(value)
    return list(dict.fromkeys(item for item in values if item in EVIDENCE_TYPES))[:3]


def normalize_string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [
        str(item).strip()
        for item in value
        if isinstance(item, (str, int, float)) and str(item).strip()
    ]


def ensure_top_competitor_finding(
    recommendations: list[dict[str, Any]],
    recommendation_patterns: dict[str, Any],
    competitor_evidence: dict[str, Any],
    *,
    evidence_catalog: list[dict[str, Any]] | None = None,
    company_name: str = "",
    prompt_losses: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    audited_company = str(
        company_name
        or recommendation_patterns.get("user_recommendation_summary", {}).get(
            "user_company"
        )
        or "this company"
    ).strip()
    top_competitors = recommendation_patterns.get("top_competitors", [])
    if not top_competitors:
        return recommendations
    top = top_competitors[0]
    name = str(top.get("company_name", "")).strip()
    if not name:
        return recommendations
    if any(
        name.lower()
        in f"{item.get('observation', '')} {item.get('evidence', '')}".lower()
        for item in recommendations
    ):
        return recommendations

    evidence_item = next(
        (
            item
            for item in competitor_evidence.get("competitors", [])
            if normalize_name(item.get("company_name")) == normalize_name(name)
        ),
        {},
    )
    mention_count = int(top.get("mention_frequency", 0) or 0)
    average_rank = top.get("average_rank")
    sample_reasons = [
        str(reason).strip()
        for reason in top.get("sample_reasoning", [])
        if str(reason).strip()
    ]
    website_verified = bool(evidence_item.get("website_evidence"))
    verification_note = (
        "Its official website was verified and crawled."
        if website_verified
        else "Its official website was not verified, so no website comparison is claimed."
    )
    reason_text = (
        f" Recurring AI reasoning included: {sample_reasons[0]}"
        if sample_reasons
        else ""
    )
    preferred = sorted(
        [
            row
            for row in (evidence_catalog or [])
            if normalize_name(row.get("company_name")) == normalize_name(name)
        ],
        key=lambda row: (
            0 if row.get("evidence_type") == "external_mention" else 1,
            str(row.get("evidence_id", "")),
        ),
    )[:2]
    finding = {
        "observation": f"{name} was the most frequently recommended alternative.",
        "evidence": (
            f"{name} appeared in {mention_count} AI answers"
            + (f" with an average rank of {average_rank}" if average_rank else "")
            + f". {verification_note}{reason_text}"
        ),
        "suggested_change": (
            f"Review the buyer questions where {name} appeared and publish clear, "
            "verifiable pages that address the same buyer requirements using "
            f"{audited_company}'s actual capabilities and proof."
        ),
        "expected_impact": (
            "Makes the website's evidence easier to compare with the reasons observed "
            "in AI recommendations."
        ),
        "confidence": "High" if mention_count >= 3 else "Medium",
        "evidence_types": list(
            dict.fromkeys(str(row["evidence_type"]) for row in preferred)
        ),
        "evidence_refs": [str(row["evidence_id"]) for row in preferred],
        # Exact name match against the recorded winners for each lost question,
        # so this finding points only at questions this competitor actually won.
        "affected_loss_refs": [
            str(loss.get("loss_id"))
            for loss in (prompt_losses or [])
            if any(
                normalize_name(company) == normalize_name(name)
                for company in loss.get("recommended_instead", [])
            )
        ][:3],
    }
    return [finding, *recommendations]


def valid_http_url(value: Any) -> str | None:
    url = str(value or "").strip()
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return None
    return url


def canonical_url(value: Any) -> str:
    """One key per page, whatever address it was reached by.

    http://, https:// and the www variant of one page are one page. Keeping
    the scheme meant a competitor's home page filled three citation slots and
    the model could pick whichever it liked, each looking like a separate
    source.
    """
    text = str(value or "").strip().rstrip("/").lower()
    for prefix in ("https://", "http://"):
        if text.startswith(prefix):
            text = text[len(prefix) :]
            break
    return text.removeprefix("www.")


def page_provenance(page: dict[str, Any] | None) -> str:
    if page and page.get("fetch_provider") == "firecrawl":
        return "firecrawl_verified"
    return "competitor_website"


def page_excerpt(page: dict[str, Any] | None, max_length: int = 320) -> str:
    if not page:
        return ""
    text = " ".join(str(page.get("main_text", "")).split())
    title = " ".join(str(page.get("title", "")).split())
    if title and text.lower().startswith(title.lower()):
        text = text[len(title) :].lstrip(" :-|")
    return concise_text(text, max_length)


def page_supports_evidence(
    evidence: dict[str, Any],
    page: dict[str, Any],
) -> bool:
    evidence_type = str(evidence.get("evidence_type", ""))
    url = str(page.get("url", ""))
    title = str(page.get("title", ""))
    content = str(page.get("main_text", ""))
    haystack = f"{url} {title} {content[:5000]}".lower()
    company_name = str(evidence.get("company_name", "")).strip().lower()
    if evidence_type == "external_mention":
        return bool(company_name and company_name in haystack)
    keywords = {
        "use_case_page": ("use case", "solution", "industry"),
        "feature_page": ("feature", "product", "platform", "capabilit"),
        "pricing_page": ("pricing", "price", "plan", "cost"),
        "faq_page": ("faq", "frequently asked", "questions"),
        "customer_proof": ("case study", "customer", "testimonial", "success"),
        "documentation": ("documentation", "docs", "developer", "api"),
        "comparison_page": ("compare", "comparison", "alternative", "versus"),
        "homepage_message": (),
    }.get(evidence_type, ())
    return evidence_type == "homepage_message" or any(
        keyword in haystack for keyword in keywords
    )


def normalize_name(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value or "").lower())


def page_name_from_url(url: str) -> str:
    parsed = urlparse(url)
    segment = parsed.path.rstrip("/").rsplit("/", 1)[-1]
    if not segment:
        return parsed.netloc
    return re.sub(r"[-_]+", " ", segment).strip().title()


def concise_text(value: Any, max_length: int) -> str:
    text = " ".join(str(value or "").split())
    if len(text) <= max_length:
        return text
    return text[: max_length - 3].rstrip() + "..."


def meaningful_text(value: Any) -> bool:
    text = " ".join(str(value or "").split()).strip()
    return bool(text and text.lower() != "unknown" and len(text.split()) >= 3)
