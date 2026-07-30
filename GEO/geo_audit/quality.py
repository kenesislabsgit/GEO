from __future__ import annotations

from collections import Counter
from typing import Any


def build_quality_summary(
    raw_results: list[dict[str, Any]],
    recommendation_patterns: dict[str, Any],
    competitor_evidence: dict[str, Any],
    comparison: dict[str, Any],
) -> dict[str, Any]:
    responses_by_assistant = Counter(item.get("assistant", "unknown") for item in raw_results)
    parsed_recommendations_by_assistant: Counter[str] = Counter()
    source_urls_by_assistant: Counter[str] = Counter()
    zero_recommendation_responses = []

    for item in raw_results:
        assistant = item.get("assistant", "unknown")
        recommendations = item.get("recommended_companies", [])
        parsed_recommendations_by_assistant[assistant] += len(recommendations)
        source_urls_by_assistant[assistant] += len(
            item.get("provider_source_urls", [])
        )
        if not recommendations:
            zero_recommendation_responses.append(
                {
                    "assistant": assistant,
                    "model": item.get("model", "Unknown"),
                    "prompt_index": item.get("prompt_index"),
                    "prompt": item.get("prompt", ""),
                    "parse_error": item.get("parse_error"),
                }
            )

    failed_competitor_crawls = [
        {
            "company_name": item.get("company_name", "Unknown"),
            "website_url": item.get("website_url", "Unknown"),
            "collection_status": item.get("collection_status", "Unknown"),
            "collection_error": item.get("collection_error", "Unknown"),
        }
        for item in competitor_evidence.get("competitors", [])
        if item.get("collection_status") == "website_failed"
    ]

    source_analysis = recommendation_patterns.get("source_analysis", {})
    redirect_domains = [
        item
        for item in source_analysis.get("top_domains", [])
        if item.get("domain") == "vertexaisearch.cloud.google.com"
    ]

    warnings = []
    if zero_recommendation_responses:
        warnings.append(
            "Some assistant responses produced no parsed company recommendations."
        )
    if failed_competitor_crawls:
        warnings.append(
            "Some competitor websites failed to crawl; comparison fields for those competitors are Unknown."
        )
    if redirect_domains:
        warnings.append(
            "Some Gemini/Google grounding source URLs remained provider redirects."
        )
    total_source_urls = sum(source_urls_by_assistant.values())
    competitors_with_evidence = competitor_evidence.get("summary", {}).get(
        "with_website_evidence", 0
    )
    if responses_by_assistant and not total_source_urls:
        warnings.append(
            "The sampled AI answers provided no grounded source URLs."
        )
    if recommendation_patterns.get("top_competitors") and not competitors_with_evidence:
        warnings.append(
            "Competitor names come from AI answers only and were not independently verified."
        )

    return {
        "responses_by_assistant": dict(sorted(responses_by_assistant.items())),
        "parsed_recommendations_by_assistant": dict(
            sorted(parsed_recommendations_by_assistant.items())
        ),
        "source_urls_by_assistant": dict(sorted(source_urls_by_assistant.items())),
        "zero_recommendation_responses": zero_recommendation_responses,
        "failed_competitor_crawls": failed_competitor_crawls,
        "competitors_with_website_evidence": competitors_with_evidence,
        "confidence_level": (
            "low"
            if not total_source_urls and not competitors_with_evidence
            else "standard"
        ),
        "comparison_high_gaps": comparison.get("summary", {}).get("high_priority_gaps", []),
        "source_type_counts": source_analysis.get("source_type_counts", []),
        "top_source_domains": source_analysis.get("top_domains", [])[:15],
        "warnings": warnings,
    }
