from __future__ import annotations

import json
from typing import Any

from .llm import LLMNotConfigured, build_chat_payload, call_chat_completion


REPORT_SYSTEM_PROMPT = """You are writing a professional AI recommendation audit report.

Use only the provided evidence.
Do not invent facts.
Do not promise ranking or guaranteed AI recommendation inclusion.
Do not say a change will increase the likelihood or chances of being recommended.
Do not frame this as an SEO report.
Avoid search engine ranking, search snippet, and SEO visibility language unless explicitly present in the evidence.
Frame suggested impact as improved clarity, machine readability, evidence quality, and alignment with observed competitor recommendation patterns.
Do not say "correlates with" unless statistical correlation was calculated.
Prefer "was observed alongside", "appeared in the same audit data as", or "the audit observed".
Explicitly distinguish Missing from Unknown. If a competitor site crawl failed, say evidence was not collected; do not imply the competitor lacks that content.
When citing source analysis, separate real domains from provider redirect domains such as vertexaisearch.cloud.google.com.
Do not overstate source quality when source URLs are redirects or unresolved.
Do not mention AI training data, model memory, or internal model knowledge. This audit only observes current assistant responses and provided citations/source URLs.

The report must include:
- Executive Summary
- How AI Understands The Company
- Was The Company Recommended?
- Prompt Statistics
- AI Recommendation Summary
- Why Competitors Win
- Competitor Analysis
- Cited Source Analysis
- Website Audit
- External Authority Audit
- Prioritized Recommendations
- Suggested Copy

Write in clear business English.
Lead with AI recommendation evidence before website audit details.
Return Markdown only.
"""


def generate_final_report(
    company_profile: dict[str, Any],
    user_evidence: dict[str, Any],
    recommendation_patterns: dict[str, Any],
    competitor_evidence: dict[str, Any],
    comparison: dict[str, Any],
    recommendations: list[dict[str, Any]],
) -> tuple[str | None, dict[str, Any], str | None]:
    payload = build_report_payload(
        company_profile,
        user_evidence,
        recommendation_patterns,
        competitor_evidence,
        comparison,
        recommendations,
    )
    try:
        report = call_chat_completion(payload)
    except LLMNotConfigured as exc:
        return None, payload, str(exc)
    return sanitize_report_language(strip_markdown_fence(report)), payload, None


def build_report_payload(
    company_profile: dict[str, Any],
    user_evidence: dict[str, Any],
    recommendation_patterns: dict[str, Any],
    competitor_evidence: dict[str, Any],
    comparison: dict[str, Any],
    recommendations: list[dict[str, Any]],
) -> dict[str, Any]:
    data = {
        "company_profile": company_profile,
        "user_website_evidence": user_evidence,
        "recommendation_patterns": recommendation_patterns,
        "competitor_evidence_summary": compact_competitor_evidence(competitor_evidence),
        "comparison": comparison,
        "recommendations": recommendations,
    }
    return build_chat_payload(
        REPORT_SYSTEM_PROMPT,
        json.dumps(data, indent=2, ensure_ascii=False),
        temperature=0.2,
    )


def compact_competitor_evidence(competitor_evidence: dict[str, Any]) -> dict[str, Any]:
    return {
        "summary": competitor_evidence.get("summary", {}),
        "competitors": [
            {
                "company_name": item.get("company_name", "Unknown"),
                "recommendation_pattern": item.get("recommendation_pattern", {}),
                "website_url": item.get("website_url", "Unknown"),
                "site_discovery": item.get("site_discovery", {}),
                "website_evidence": item.get("website_evidence"),
                "source_analysis": item.get("source_analysis", {}),
                "external_authority_evidence": item.get("external_authority_evidence", {}),
                "collection_status": item.get("collection_status", "Unknown"),
            }
            for item in competitor_evidence.get("competitors", [])
        ],
    }


def strip_markdown_fence(value: str) -> str:
    text = value.strip()
    if text.startswith("```markdown"):
        text = text[len("```markdown") :].strip()
    elif text.startswith("```"):
        text = text[len("```") :].strip()

    if text.endswith("```"):
        text = text[:-3].strip()

    return text + "\n"


def sanitize_report_language(value: str) -> str:
    replacements = {
        "likely contributed to its omission": "was observed alongside its omission",
        "likely contributed to this outcome": "was observed alongside this outcome",
        "likely contributed to omission": "was observed alongside omission in this audit",
        "AI training data": "the observed AI response source data",
        "AI training or recommendation data": "the observed AI response/source data",
        "AI’s ability to gather detailed evidence": "the amount of detailed evidence available in the observed website/source data",
        "AI's ability to gather detailed evidence": "the amount of detailed evidence available in the observed website/source data",
        "can improve AI systems’ understanding": "can improve machine readability",
        "can improve AI systems' understanding": "can improve machine readability",
        "were favored": "appeared more often in the observed responses",
        "influence AI assistant recommendations": "appear in the observed AI assistant recommendations",
        "enhancing AI systems’ ability to recommend them": "improving the explicit evidence available about them",
        "enhancing AI systems' ability to recommend them": "improving the explicit evidence available about them",
        "ability to recommend them": "ability to describe them",
        "stronger online evidence": "more explicit online evidence in the observed source set",
        "guarantees uninterrupted": "supports continuous",
        "is expected to improve AI systems’ understanding": "can improve machine readability",
        "is expected to improve AI systems' understanding": "can improve machine readability",
        "AI assistants prioritize companies with": "The observed AI assistant responses more often included companies with",
        "AI assistants favor companies with": "The observed AI assistant responses more often included companies with",
        "improving AI understanding": "improving machine readability",
        "impacting recommendation likelihood": "limiting the explicit evidence available in this audit",
        "influence recommendation likelihood": "were observed among repeatedly recommended competitors",
        "influential factors in AI recommendation patterns": "patterns observed among repeatedly recommended competitors",
        "were consistently recommended": "appeared repeatedly in the observed recommendations",
    }
    sanitized = value
    for old, new in replacements.items():
        sanitized = sanitized.replace(old, new)
    return sanitized
