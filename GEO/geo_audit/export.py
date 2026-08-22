from __future__ import annotations

from datetime import datetime, timezone
import re
from typing import Any

from .aggregation import (
    build_user_keys,
    canonical_company_key,
    grouped_company_name,
    is_user_company,
)
from .costs import per_call_usd
from .scoring import build_scorecard


def build_frontend_export(
    company_profile: dict[str, Any],
    prompts: list[dict[str, Any]],
    raw_results: list[dict[str, Any]],
    recommendation_patterns: dict[str, Any],
    competitor_evidence: dict[str, Any],
    comparison: dict[str, Any],
    recommendations: list[dict[str, Any]],
    quality_summary: dict[str, Any],
    web_presence: dict[str, Any] | None = None,
    *,
    free_preview: bool = False,
    summary: str = "",
    website_snapshot: dict[str, Any] | None = None,
    requested_assistants: list[str] | None = None,
) -> dict[str, Any]:
    web_presence = web_presence or {}
    score = build_scorecard(
        raw_results,
        recommendation_patterns,
        competitor_evidence,
        quality_summary,
    )
    score["competitor_scores"] = build_competitor_report_rows(
        score.get("competitor_scores", []),
        raw_results,
        competitor_evidence,
        audited_company=company_profile.get("company_name"),
        allow_answer_only=free_preview,
    )
    brand_name = company_profile.get("company_name", "Unknown")
    domain = audited_domain(company_profile, website_snapshot)
    prompt_matrix = build_prompt_matrix(prompts, recommendation_patterns)
    query_results = build_query_results(
        raw_results,
        brand_name,
        web_presence,
        recommendation_patterns.get("company_name_groups"),
    )
    provider_coverage = build_provider_coverage(raw_results)
    # A provider is partial when it answered but recommended nobody — or when
    # it was asked and never answered at all. The second case used to be
    # invisible: four providers could fail every question and the scan still
    # said "completed", silently reporting whoever was left.
    partial_providers = [
        provider
        for provider, coverage in provider_coverage.items()
        if coverage["responses"] > 0 and coverage["recommendations"] == 0
    ]
    for provider in requested_assistants or []:
        responses = provider_coverage.get(provider, {}).get("responses", 0)
        if responses == 0 and provider not in partial_providers:
            partial_providers.append(provider)

    return {
        "schema_version": "geo_audit.frontend_export.v3",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "brand": {
            "name": brand_name,
            "domain": domain,
            "category": company_profile.get("category"),
            "description": company_profile.get("unique_value_proposition"),
            "target_audience": company_profile.get("target_audience"),
            "aliases": [brand_name],
        },
        "scan": {
            "status": "partial" if partial_providers else "completed",
            "methodology_version": recommendation_patterns.get("summary", {}).get(
                "methodology_version", "geo-audit-mvp"
            ),
            "provider_ids": sorted(
                recommendation_patterns.get("summary", {}).get(
                    "responses_by_assistant", {}
                )
            ),
            "prompt_count": len(prompts),
            "response_count": len(raw_results),
            "provider_coverage": provider_coverage,
            "partial_providers": partial_providers,
            "preview_mode": free_preview,
            "data_confidence": (
                "low"
                if free_preview
                and not any(
                    result.get("provider_source_urls")
                    for result in raw_results
                )
                else "standard"
            ),
        },
        "score": score,
        # Where this company stands, written once by the step that had every
        # finding in front of it. The dashboard used to pick one of three
        # sentences off the mention rate and call that an executive verdict.
        "summary": " ".join(str(summary or "").split()),
        "prompt_matrix": prompt_matrix,
        "query_results": query_results,
        "top_competitors": [
            {
                "name": item.get("name", "Unknown"),
                "mentions": item.get("mentions", 0),
                "average_rank": item.get("average_rank"),
                "mentions_by_assistant": item.get("mentions_by_assistant", {}),
            }
            for item in score["competitor_scores"]
        ],
        "citations": build_citation_rows(raw_results),
        "web_presence": web_presence,
        "competitor_evidence": compact_competitor_evidence(competitor_evidence),
        "comparison": {
            "summary": comparison.get("summary", {}),
            "recurring_patterns": comparison.get("recurring_competitor_patterns", []),
        },
        "recommendations": build_action_rows(
            recommendations,
            competitor_evidence=competitor_evidence,
            comparison=comparison,
        ),
        "quality": quality_summary,
    }


def build_provider_coverage(
    raw_results: list[dict[str, Any]],
) -> dict[str, dict[str, int]]:
    coverage: dict[str, dict[str, int]] = {}
    for result in raw_results:
        provider = str(result.get("assistant", "unknown"))
        row = coverage.setdefault(
            provider,
            {"responses": 0, "recommendations": 0, "rejections": 0},
        )
        row["responses"] += 1
        row["recommendations"] += len(result.get("recommended_companies", []))
        row["rejections"] += len(result.get("recommendation_rejections", []))
    return coverage


def build_prompt_matrix(
    prompts: list[dict[str, Any]],
    recommendation_patterns: dict[str, Any],
) -> list[dict[str, Any]]:
    outcomes = recommendation_patterns.get("prompt_statistics", {}).get(
        "prompt_outcomes", []
    )
    rows = []
    for index, prompt in enumerate(prompts, start=1):
        matches = [
            outcome for outcome in outcomes if outcome.get("prompt") == prompt.get("prompt")
        ]
        rows.append(
            {
                "prompt_index": index,
                "prompt": prompt.get("prompt", ""),
                "prompt_type": prompt.get("category", "Unknown"),
                "buyer_stage": prompt.get("buying_stage", "Unknown"),
                # Present only on geo-localized questions (Pro+ market runs).
                "market": prompt.get("market"),
                "market_country": prompt.get("market_country"),
                "mentioned": any(match.get("user_recommended") for match in matches),
                "provider_results": [
                    {
                        "assistant": match.get("assistant"),
                        "model": match.get("model"),
                        "user_recommended": match.get("user_recommended"),
                        "user_rank": match.get("user_rank"),
                        "top_recommendations": match.get("top_recommendations", []),
                    }
                    for match in matches
                ],
            }
        )
    return rows


def build_query_results(
    raw_results: list[dict[str, Any]],
    brand_name: str,
    web_presence: dict[str, Any] | None = None,
    company_name_groups: dict[str, str] | None = None,
) -> list[dict[str, Any]]:
    web_presence = web_presence or {}
    # One question, one answer: whether a name is the audited company is
    # decided in a single place. Matching the brand name exactly here while the
    # counting step accepted anything starting with it meant a spelling could
    # be the customer in the numbers and a stranger in the answers shown
    # beside them.
    brand_keys = build_user_keys(brand_name, None)
    rows = []
    # A page written about a company is a fact about that company, not about
    # one answer. Attached per answer, the same page was written out once for
    # every answer naming its company: a run finding 45 pages exported 306 rows
    # and stored all 306. Each page is now carried by the first answer that
    # named its company, which keeps the association and drops the copies.
    exported_mentions: set[str] = set()
    for result in raw_results:
        recommendations = result.get("recommended_companies", [])
        provider_source_urls = result.get("provider_source_urls", [])
        cited_urls = sorted(set(provider_source_urls))
        brand_mentions = citation_brand_mentions(result)
        verified_mentions = []
        for mention in mentions_for_recommendations(
            recommendations, web_presence, company_name_groups
        ):
            url = str(mention.get("url", "")).strip()
            if not url or url in exported_mentions:
                continue
            exported_mentions.add(url)
            verified_mentions.append(mention)
        brand_rec = next(
            (
                item
                for item in recommendations
                if is_user_company(
                    item.get("company_name", ""), brand_keys, company_name_groups
                )
            ),
            None,
        )
        rows.append(
            {
                "prompt_index": result.get("prompt_index"),
                "prompt": result.get("prompt"),
                "prompt_category": result.get("prompt_category"),
                "provider": result.get("assistant"),
                "model": result.get("model"),
                "raw_answer": result.get("raw_response", ""),
                "answer_summary": result.get("overall_reasoning", ""),
                "brand_mentioned": bool(brand_rec),
                "brand_position": brand_rec.get("rank") if brand_rec else None,
                "recommended_brands": [
                    {
                        "name": item.get("company_name", "Unknown"),
                        "position": item.get("rank"),
                        "reasonRecommended": item.get("reasoning", ""),
                    }
                    for item in recommendations
                ],
                "citations": [
                    {
                        "url": url,
                        "title": None,
                        "domain": safe_domain(url),
                        # True only when the fetched page actually names the
                        # audited company. None when it could not be checked.
                        "citedForBrand": brand_mentions.get(url),
                        "citedForCompetitor": False,
                        "provenance": "provider_grounded",
                    }
                    for url in cited_urls
                ],
                "verified_mentions": verified_mentions,
                "provider_source_urls": provider_source_urls,
                "parse_error": result.get("parse_error"),
                "analysis_confidence": result.get("analysis_confidence"),
                "collection_mode": result.get("collection_mode"),
                # Conservative flat estimate; the ledger settles against it.
                "estimated_cost": per_call_usd(str(result.get("assistant") or "")),
            }
        )
    return rows


def build_top_competitors(
    recommendation_patterns: dict[str, Any],
) -> list[dict[str, Any]]:
    return [
        {
            "name": item.get("company_name", "Unknown"),
            "mentions": item.get("mention_frequency", 0),
            "average_rank": item.get("average_rank"),
            "mentions_by_assistant": item.get("mentions_by_assistant", {}),
            "source_analysis": item.get("source_analysis", {}),
        }
        for item in recommendation_patterns.get("top_competitors", [])
    ]


def citation_brand_mentions(result: dict[str, Any]) -> dict[str, bool | None]:
    """Per cited URL: did the fetched page name the audited company?"""
    mentions: dict[str, bool | None] = {}
    for check in result.get("provider_citation_verification", []):
        if not isinstance(check, dict):
            continue
        for key in ("resolved_url", "url"):
            url = str(check.get(key) or "").strip()
            if url:
                mentions[url] = check.get("mentions_company")
    return mentions


def build_citation_rows(raw_results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows = []
    for result in raw_results:
        brand_mentions = citation_brand_mentions(result)
        for url in result.get("provider_source_urls", []):
            rows.append(
                {
                    "url": url,
                    "domain": safe_domain(url),
                    "provider": result.get("assistant"),
                    "prompt_index": result.get("prompt_index"),
                    "mentions_brand": brand_mentions.get(url),
                    "provenance": "provider_grounded",
                }
            )
    return rows


def mentions_for_recommendations(
    recommendations: list[dict[str, Any]],
    web_presence: dict[str, Any],
    company_name_groups: dict[str, str] | None = None,
) -> list[dict[str, Any]]:
    # Web presence is gathered for the merged competitor list, so its entities
    # carry group names while each answer still carries its own spelling.
    # Compare group names, or a page found for "Otter.ai" never reaches the
    # answer that said "Otter Voice Notes".
    company_names = {
        str(
            grouped_company_name(item.get("company_name"), company_name_groups)
        ).lower().strip()
        for item in recommendations
    }
    rows = []
    seen = set()
    for entity in web_presence.get("entities", []):
        if (
            entity.get("entity_type") != "user_company"
            and str(entity.get("company_name", "")).lower().strip()
            not in company_names
        ):
            continue
        for mention in entity.get("verified_mentions", []):
            url = str(mention.get("url", "")).strip()
            if not url or url in seen:
                continue
            seen.add(url)
            rows.append(mention)
    return rows


def compact_competitor_evidence(
    competitor_evidence: dict[str, Any],
) -> list[dict[str, Any]]:
    return [
        {
            "company_name": item.get("company_name", "Unknown"),
            "website_url": item.get("website_url", "Unknown"),
            "collection_status": item.get("collection_status", "Unknown"),
            "collection_error": item.get("collection_error"),
            "site_discovery": item.get("site_discovery", {}),
            "source_analysis": item.get("source_analysis", {}),
            "verified_web_mentions": item.get("verified_web_mentions", []),
            "web_presence_summary": item.get("web_presence_summary", {}),
            "has_website_evidence": bool(item.get("website_evidence")),
            "website_evidence": item.get("website_evidence"),
        }
        for item in competitor_evidence.get("competitors", [])
    ]


def build_competitor_report_rows(
    score_rows: list[dict[str, Any]],
    raw_results: list[dict[str, Any]],
    competitor_evidence: dict[str, Any],
    *,
    audited_company: str | None = None,
    allow_answer_only: bool = False,
) -> list[dict[str, Any]]:
    evidence_by_name = {
        canonical_company_key(item.get("company_name", "")): item
        for item in competitor_evidence.get("competitors", [])
    }
    rows = []
    for score_row in score_rows:
        name = str(score_row.get("name", "Unknown"))
        if audited_company and canonical_company_key(name) == canonical_company_key(
            audited_company
        ):
            continue
        evidence = evidence_by_name.get(canonical_company_key(name), {})
        answer_evidence = answer_evidence_for_company(name, raw_results)
        website_evidence = website_proof_rows(
            evidence.get("website_evidence") or {}
        )
        verified_mentions = verified_mention_rows(
            evidence.get("verified_web_mentions", [])
        )
        has_native_source = any(
            row.get("source_urls") for row in answer_evidence
        )
        has_verified_support = bool(
            website_evidence or verified_mentions or has_native_source
        )
        if not answer_evidence or not (has_verified_support or allow_answer_only):
            continue
        rows.append(
            {
                **score_row,
                "official_website": official_site_url(evidence.get("website_url")),
                "collection_status": evidence.get("collection_status", "Unknown"),
                "answer_evidence": answer_evidence,
                "website_evidence": website_evidence,
                "verified_mentions": verified_mentions,
                "evidence_status": (
                    "verified"
                    if has_verified_support
                    else "answer_only_unverified"
                ),
            }
        )
    return rows


def answer_evidence_for_company(
    company_name: str,
    raw_results: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    rows = []
    # Matched on the canonical key so an answer that wrote "Kenesis Labs"
    # still counts as evidence for the merged "Kenesis" row.
    company_key = canonical_company_key(company_name)
    for result in raw_results:
        for recommendation in result.get("recommended_companies", []):
            if canonical_company_key(recommendation.get("company_name", "")) != company_key:
                continue
            rows.append(
                {
                    "question": result.get("prompt", ""),
                    "provider": result.get("assistant", "unknown"),
                    "model": result.get("model", "unknown"),
                    "rank": recommendation.get("rank"),
                    "reason": recommendation.get("reasoning", ""),
                    "answer_excerpt": recommendation.get("evidence_quote", ""),
                    "source_urls": [
                        url
                        for url in recommendation.get("source_urls", [])
                        if usable_url(url)
                    ][:3],
                    "provenance": "ai_answer",
                }
            )
    return [
        row
        for row in rows
        if meaningful_text(row.get("answer_excerpt"))
    ][:5]


def website_proof_rows(website_evidence: dict[str, Any]) -> list[dict[str, Any]]:
    if not website_evidence:
        return []

    rows = []
    homepage_url = usable_url(website_evidence.get("homepage_url"))
    for label, field in (
        ("Homepage headline", "homepage_headline"),
        ("Homepage subheadline", "homepage_subheadline"),
    ):
        excerpt = str(website_evidence.get(field, "")).strip()
        if meaningful_text(excerpt):
            rows.append(
                {
                    "label": label,
                    "excerpt": excerpt,
                    "url": homepage_url,
                    "provenance": "competitor_website",
                }
            )

    used_urls = {row["url"] for row in rows if row.get("url")}
    for label, field in (
        ("Use-case page", "use_case_pages_found"),
        ("Product or feature page", "feature_pages_found"),
        ("Pricing page", "pricing_page_found"),
        ("FAQ page", "faq_page_found"),
        ("Customer proof or case study", "testimonials_or_case_studies_found"),
        ("Documentation", "documentation_found"),
        ("Comparison page", "comparison_pages_found"),
    ):
        value = website_evidence.get(field, {})
        if not isinstance(value, dict) or not value.get("found"):
            continue
        candidates = value.get("matches") or [
            {"url": url, "text": ""}
            for url in value.get("urls", [])
        ]
        for candidate in candidates:
            resolved_url = usable_url(candidate.get("url"))
            if not resolved_url or resolved_url in used_urls:
                continue
            rows.append(
                {
                    "label": label,
                    "excerpt": candidate.get("excerpt"),
                    "url": resolved_url,
                    "page_title": str(candidate.get("text", "")).strip() or None,
                    "provenance": (
                        "firecrawl_verified"
                        if candidate.get("fetch_provider") == "firecrawl"
                        else "competitor_website"
                    ),
                }
            )
            used_urls.add(resolved_url)
            break
    return dedupe_evidence_rows(rows)[:8]


def verified_mention_rows(mentions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows = []
    for mention in mentions:
        url = usable_url(mention.get("url"))
        if (
            not url
            or not mention.get("verified")
            or mention.get("source_type") == "official_site"
            or not mention.get("matched_context_terms")
        ):
            continue
        rows.append(
            {
                "title": mention.get("title") or mention.get("domain") or url,
                "snippet": concise_mention_excerpt(
                    mention.get("snippet", ""),
                    mention.get("company_name", ""),
                ),
                "url": url,
                "domain": mention.get("domain"),
                "source_type": mention.get("source_type", "other_source"),
                "provenance": "independent_web_search",
            }
        )
    return rows[:8]


# Each recommendation evidence_type maps to exactly one comparison field, so the
# "N of M competitors do this" context is looked up, never keyword-guessed.
EVIDENCE_TYPE_TO_COMPARISON_FIELD = {
    "homepage_message": "homepage_headline",
    "use_case_page": "use_case_pages_found",
    "feature_page": "feature_pages_found",
    "pricing_page": "pricing_page_found",
    "faq_page": "faq_page_found",
    "customer_proof": "testimonials_or_case_studies_found",
    "documentation": "documentation_found",
    "comparison_page": "comparison_pages_found",
}


def competitor_gap_context(
    recommendation: dict[str, Any],
    comparison: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    """How many recommended competitors show the pattern this action is about."""
    if not comparison:
        return []
    label_by_field = {
        str(check.get("field")): str(check.get("label"))
        for check in comparison.get("checks", [])
        if check.get("field") and check.get("label")
    }
    patterns_by_label = {
        str(pattern.get("pattern")): pattern
        for pattern in comparison.get("recurring_competitor_patterns", [])
        if pattern.get("pattern")
    }
    rows = []
    seen: set[str] = set()
    for evidence_type in recommendation.get("evidence_types", []):
        field = EVIDENCE_TYPE_TO_COMPARISON_FIELD.get(str(evidence_type))
        label = label_by_field.get(field or "")
        pattern = patterns_by_label.get(label or "")
        if not pattern or label in seen:
            continue
        seen.add(str(label))
        rows.append(
            {
                "pattern": label,
                "competitors_with_pattern": pattern.get("competitors_with_pattern"),
                "competitors_checked": pattern.get("competitors_checked"),
                "user_status": pattern.get("user_status"),
                "gap_level": pattern.get("gap_level"),
                "example_competitors": pattern.get("example_competitors", [])[:4],
            }
        )
    return rows[:2]


def build_action_rows(
    recommendations: list[dict[str, Any]],
    *,
    competitor_evidence: dict[str, Any] | None = None,
    comparison: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    return [
        {
            "title": item.get("observation", "Recommendation"),
            "explanation": item.get("suggested_change", "Unknown"),
            "evidence": {
                "summary": item.get("evidence", "Unknown"),
                "supporting_evidence": validated_supporting_evidence(item),
                "validation_mode": (
                    item.get("evidence_validation", {}).get("mode")
                    if isinstance(item.get("evidence_validation"), dict)
                    else None
                ),
                "evidence_validation": item.get("evidence_validation", {}),
                "evidence_types": item.get("evidence_types", []),
                "competitor_evidence_reason": item.get(
                    "competitor_evidence_reason"
                ),
                "audited_company_evidence_reason": item.get(
                    "audited_company_evidence_reason"
                ),
                "competitor_gaps": competitor_gap_context(item, comparison),
            },
            "priority": index,
            "estimated_impact": item.get("expected_impact"),
            "confidence": item.get("confidence", "Low"),
            # Lost buyer questions this improvement was tied to, resolved from
            # model-selected loss_ids against the real loss list.
            "affected_prompts": item.get("affected_prompts", []),
            "status": "open",
        }
        for index, item in enumerate(recommendations, start=1)
    ]


def validated_supporting_evidence(
    recommendation: dict[str, Any],
) -> list[dict[str, Any]]:
    validation = recommendation.get("evidence_validation", {})
    if not isinstance(validation, dict) or validation.get("mode") != "catalog_ids":
        return []
    rows = []
    seen = set()
    for row in recommendation.get("supporting_evidence", []):
        if not isinstance(row, dict):
            continue
        url = usable_url(row.get("url"))
        evidence_id = str(row.get("evidence_id", "")).strip()
        if not url or not evidence_id or evidence_id in seen:
            continue
        seen.add(evidence_id)
        rows.append(
            {
                "evidence_id": evidence_id,
                "company_name": row.get("company_name"),
                "evidence_type": row.get("evidence_type"),
                "label": row.get("label"),
                "page_title": row.get("title"),
                "excerpt": row.get("excerpt"),
                "url": url,
                  "provenance": row.get("provenance"),
                  "verification": row.get("verification"),
              }
        )
    return rows[:3]


def meaningful_text(value: Any) -> bool:
    text = " ".join(str(value or "").split()).strip()
    if not text or text.lower() == "unknown":
        return False
    generic = {
        "features",
        "our features",
        "products",
        "our products",
        "solutions",
        "our solutions",
        "use cases",
        "learn more",
    }
    if text.lower().strip(" .:") in generic:
        return False
    return len(text.split()) >= 3


def dedupe_evidence_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    deduped = []
    seen = set()
    for row in rows:
        key = row.get("url")
        if key in seen:
            continue
        seen.add(key)
        deduped.append(row)
    return deduped


def concise_mention_excerpt(
    value: Any,
    company_name: Any,
    *,
    max_length: int = 320,
) -> str:
    text = " ".join(str(value or "").split())
    if not text:
        return ""
    sentences = re.split(r"(?<=[.!?])\s+", text)
    company = str(company_name or "").lower()
    selected = next(
        (sentence for sentence in sentences if company and company in sentence.lower()),
        sentences[0],
    )
    if len(selected) <= max_length:
        return selected
    return selected[: max_length - 1].rstrip() + "..."


def normalize_name(value: Any) -> str:
    return " ".join(str(value).lower().split())


def usable_url(value: Any) -> str | None:
    url = str(value or "").strip()
    return url if url.startswith(("http://", "https://")) else None


def official_site_url(value: Any) -> str | None:
    url = usable_url(value)
    if not url:
        return None
    try:
        from urllib.parse import urlparse

        parsed = urlparse(url)
        return f"{parsed.scheme}://{parsed.netloc}" if parsed.netloc else None
    except ValueError:
        return None


def audited_domain(
    company_profile: dict[str, Any],
    website_snapshot: dict[str, Any] | None = None,
) -> str | None:
    """Which website this audit is about.

    This used to be read only out of the profile's ``supporting_pages``, which
    the model fills in. When a run produced no validated field evidence that
    list came back empty, the export carried ``"domain": null``, and the
    frontend threw away an otherwise complete audit with
    "audit_export.brand.domain is required" — about eighty seconds and every
    answer, competitor and recommendation, lost at the last step.

    The website we were told to audit is known before any model runs, so take
    it from the crawl and keep the model's evidence only as a fallback.
    """
    snapshot = website_snapshot or {}
    for key in ("domain", "normalized_url", "input_url"):
        domain = host_from_value(snapshot.get(key))
        if domain:
            return domain
    for page in snapshot.get("pages", []) or []:
        if isinstance(page, dict):
            domain = host_from_value(page.get("url"))
            if domain:
                return domain
    return extract_domain(company_profile)


def extract_domain(company_profile: dict[str, Any]) -> str | None:
    for page in company_profile.get("evidence", {}).get("supporting_pages", []):
        domain = safe_domain(page)
        if domain:
            return domain
    return None


def host_from_value(value: Any) -> str | None:
    """Host from either a full URL or a bare hostname.

    The snapshot stores ``domain`` as a bare host and ``normalized_url`` as a
    URL, and urlparse returns an empty netloc for the bare form.
    """
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not text:
        return None
    if "://" in text:
        return safe_domain(text)
    host = text.split("/", 1)[0].lower()
    host = host.removeprefix("www.")
    return host or None


def safe_domain(url: str) -> str | None:
    try:
        from urllib.parse import urlparse

        domain = urlparse(url).netloc.lower()
    except ValueError:
        return None
    return domain[4:] if domain.startswith("www.") else domain or None
