from __future__ import annotations

from typing import Any


POSITION_VALUES = {
    1: 100,
    2: 80,
    3: 65,
    4: 50,
    5: 35,
}

SCORE_WEIGHTS = {
    "mention": 0.65,
    "position": 0.3,
    "citation": 0.0,
    "source_quality": 0.0,
    "data_confidence": 0.05,
}


def build_scorecard(
    raw_results: list[dict[str, Any]],
    recommendation_patterns: dict[str, Any],
    competitor_evidence: dict[str, Any],
    quality_summary: dict[str, Any] | None = None,
) -> dict[str, Any]:
    user_summary = recommendation_patterns.get("user_recommendation_summary", {})
    responses = len(raw_results)
    user_mentions = int(user_summary.get("user_mentions", 0) or 0)
    mention_rate = user_mentions / responses if responses else 0
    mention_score = mention_rate * 100

    positions = [
        outcome.get("user_rank")
        for outcome in recommendation_patterns.get("prompt_statistics", {}).get(
            "prompt_outcomes", []
        )
        if outcome.get("user_rank")
    ]
    position_score = (
        sum(position_value(int(position)) for position in positions) / responses
        if responses
        else 0
    )

    citation_score = 100 if user_mentions and has_user_citations(raw_results) else 0
    source_quality_score = calculate_source_quality_score(
        recommendation_patterns.get("source_analysis", {})
    )
    data_confidence_score = calculate_data_confidence_score(
        raw_results,
        competitor_evidence,
        quality_summary or {},
    )
    overall = (
        mention_score * SCORE_WEIGHTS["mention"]
        + position_score * SCORE_WEIGHTS["position"]
        + citation_score * SCORE_WEIGHTS["citation"]
        + source_quality_score * SCORE_WEIGHTS["source_quality"]
        + data_confidence_score * SCORE_WEIGHTS["data_confidence"]
    )

    competitor_scores = [
        {
            "name": item.get("company_name", "Unknown"),
            "mentions": item.get("mention_frequency", 0),
            "share_of_voice": round(
                item.get("mention_frequency", 0)
                / max(1, sum(c.get("mention_frequency", 0) for c in recommendation_patterns.get("competitors", []))),
                4,
            ),
            "average_rank": item.get("average_rank"),
            "mentions_by_assistant": item.get("mentions_by_assistant", {}),
            "category_fit": item.get("category_fit", {}),
        }
        for item in recommendation_patterns.get("competitors", [])[:15]
    ]

    return {
        "overall_score": round(overall, 1),
        "mention_score": round(mention_score, 1),
        "position_score": round(position_score, 1),
        "citation_score": round(citation_score, 1),
        "source_quality_score": round(source_quality_score, 1),
        "data_confidence_score": round(data_confidence_score, 1),
        "mention_rate": round(mention_rate, 4),
        "average_position": (
            round(sum(int(position) for position in positions) / len(positions), 2)
            if positions
            else None
        ),
        "share_of_voice": round(
            user_mentions
            / max(
                1,
                user_mentions
                + sum(c.get("mention_frequency", 0) for c in recommendation_patterns.get("competitors", [])),
            ),
            4,
        ),
        "competitor_scores": competitor_scores,
        "weights": SCORE_WEIGHTS,
        "score_explanation": build_score_explanation(
            responses=responses,
            user_mentions=user_mentions,
            positions=positions,
            citation_score=citation_score,
            source_quality_score=source_quality_score,
            data_confidence_score=data_confidence_score,
            quality_summary=quality_summary or {},
        ),
    }


def position_value(position: int) -> int:
    if position in POSITION_VALUES:
        return POSITION_VALUES[position]
    if position >= 6:
        return 10
    return 0


def has_user_citations(raw_results: list[dict[str, Any]]) -> bool:
    return any(result.get("provider_source_urls") for result in raw_results)


def calculate_source_quality_score(source_analysis: dict[str, Any]) -> float:
    counts = {
        item.get("type"): item.get("count", 0)
        for item in source_analysis.get("source_type_counts", [])
    }
    useful = (
        counts.get("official_site", 0)
        + counts.get("developer_source", 0)
        + counts.get("review_platform", 0)
        + counts.get("analyst_or_report", 0)
        + counts.get("news_or_blog", 0)
        + counts.get("other_source", 0) * 0.7
    )
    total = sum(counts.values())
    if not total:
        return 0
    return min(100, (useful / total) * 100)


def calculate_data_confidence_score(
    raw_results: list[dict[str, Any]],
    competitor_evidence: dict[str, Any],
    quality_summary: dict[str, Any],
) -> float:
    expected = len(raw_results) or 1
    zero_recommendation_count = len(quality_summary.get("zero_recommendation_responses", []))
    response_quality = max(0, 1 - (zero_recommendation_count / expected))

    checked = competitor_evidence.get("summary", {}).get("competitors_checked", 0) or 1
    with_evidence = competitor_evidence.get("summary", {}).get("with_website_evidence", 0)
    crawl_quality = with_evidence / checked

    return ((response_quality * 0.6) + (crawl_quality * 0.4)) * 100


def build_score_explanation(
    *,
    responses: int,
    user_mentions: int,
    positions: list[Any],
    citation_score: float,
    source_quality_score: float,
    data_confidence_score: float,
    quality_summary: dict[str, Any],
) -> dict[str, Any]:
    return {
        "scope": (
            "This score measures visibility in the sampled AI buyer answers, "
            "not the company's overall market reputation or revenue."
        ),
        "components": [
            {
                "name": "mention",
                "weight": SCORE_WEIGHTS["mention"],
                "reason": f"The company appeared in {user_mentions} of {responses} collected answers.",
            },
            {
                "name": "position",
                "weight": SCORE_WEIGHTS["position"],
                "reason": (
                    "Average rank only counts answers where the company appeared."
                    if positions
                    else "The company did not appear, so no ranking position was available."
                ),
            },
            {
                "name": "citation",
                "weight": SCORE_WEIGHTS["citation"],
                "reason": (
                    "Grounded source URLs were present in the sampled answers."
                    if citation_score
                    else "No usable grounded source URLs were found for the sampled answers."
                ),
            },
            {
                "name": "source_quality",
                "weight": SCORE_WEIGHTS["source_quality"],
                "reason": (
                    "Source quality is reported but currently has zero scoring weight."
                    if SCORE_WEIGHTS["source_quality"] == 0
                    else "Source quality contributes to the score."
                ),
            },
            {
                "name": "data_confidence",
                "weight": SCORE_WEIGHTS["data_confidence"],
                "reason": (
                    f"Data confidence is {round(data_confidence_score, 1)} based on parse success and competitor evidence coverage."
                ),
            },
        ],
        "warnings": quality_summary.get("warnings", []),
    }
