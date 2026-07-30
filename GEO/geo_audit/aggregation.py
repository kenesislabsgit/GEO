from __future__ import annotations

from collections import defaultdict
from typing import Any

from .source_analysis import analyze_sources, build_global_source_analysis


def aggregate_recommendations(
    raw_results: list[dict[str, Any]],
    *,
    top_n: int = 5,
    user_company: str | None = None,
    user_aliases: list[str] | None = None,
) -> dict[str, Any]:
    companies: dict[str, dict[str, Any]] = {}
    source_counts: dict[str, int] = defaultdict(int)
    category_counts: dict[str, int] = defaultdict(int)
    assistant_counts: dict[str, int] = defaultdict(int)
    model_counts: dict[str, int] = defaultdict(int)
    prompt_outcomes = []
    user_keys = build_user_keys(user_company, user_aliases)
    user_mentions = 0
    user_rank_total = 0
    user_prompt_wins = []
    user_prompt_losses = []

    for result in raw_results:
        model = result.get("model", "Unknown")
        assistant = result.get("assistant", "unknown")
        prompt = result.get("prompt", "")
        category = result.get("prompt_category", "Unknown")
        category_counts[category] += 1
        assistant_counts[assistant] += 1
        model_counts[model] += 1
        prompt_recommendations = result.get("recommended_companies", [])
        user_match = find_user_match(prompt_recommendations, user_keys)
        if user_match:
            user_mentions += 1
            user_rank_total += int(user_match.get("rank", 0) or 0)
            user_prompt_wins.append(
                {
                    "prompt": prompt,
                    "category": category,
                    "model": model,
                    "assistant": assistant,
                    "rank": user_match.get("rank"),
                }
            )
        else:
            user_prompt_losses.append(
                {
                    "prompt": prompt,
                    "category": category,
                    "model": model,
                    "assistant": assistant,
                    "recommended_instead": [
                        item.get("company_name", "Unknown")
                        for item in prompt_recommendations[:5]
                    ],
                }
            )

        prompt_outcomes.append(
            {
                "prompt": prompt,
                "category": category,
                "model": model,
                "assistant": assistant,
                "user_recommended": bool(user_match),
                "user_rank": user_match.get("rank") if user_match else None,
                "top_recommendations": [
                    item.get("company_name", "Unknown")
                    for item in prompt_recommendations[:5]
                ],
            }
        )
        for recommendation in prompt_recommendations:
            name = normalize_company_name(recommendation.get("company_name", ""))
            if not name or is_user_company(name, user_keys):
                continue

            if name not in companies:
                companies[name] = {
                    "company_name": recommendation.get("company_name", name),
                    "mention_frequency": 0,
                    "rank_total": 0,
                    "models": set(),
                    "assistants": set(),
                    "mentions_by_assistant": defaultdict(int),
                    "mentions_by_model": defaultdict(int),
                    "prompts": [],
                    "citation_frequency": 0,
                    "source_frequency": 0,
                    "source_urls": set(),
                    "sample_reasoning": [],
                }

            item = companies[name]
            item["mention_frequency"] += 1
            item["rank_total"] += int(recommendation.get("rank", 0) or 0)
            item["models"].add(model)
            item["assistants"].add(assistant)
            item["mentions_by_assistant"][assistant] += 1
            item["mentions_by_model"][model] += 1
            item["prompts"].append(prompt)

            # Keep the URLs the model attached to this specific company. They are
            # what lets the audit find the competitor's real website later, and
            # they are counted here so source analysis has something to work on.
            company_urls = [
                str(url).strip()
                for url in recommendation.get("source_urls", [])
                if str(url).strip().startswith(("http://", "https://"))
            ]
            if company_urls:
                item["citation_frequency"] += 1
                item["source_frequency"] += len(company_urls)
                item["source_urls"].update(company_urls)
                for url in company_urls:
                    source_counts[url] += 1
            reasoning = recommendation.get("reasoning", "")
            if reasoning and len(item["sample_reasoning"]) < 3:
                item["sample_reasoning"].append(reasoning)

    competitor_stats = []
    for item in companies.values():
        mentions = item["mention_frequency"]
        rank_total = item.pop("rank_total")
        item["average_rank"] = round(rank_total / mentions, 2) if mentions else None
        item["models"] = sorted(item["models"])
        item["assistants"] = sorted(item["assistants"])
        item["mentions_by_assistant"] = dict(sorted(item["mentions_by_assistant"].items()))
        item["mentions_by_model"] = dict(sorted(item["mentions_by_model"].items()))
        item["model_count"] = len(item["models"])
        item["assistant_count"] = len(item["assistants"])
        item["prompt_count"] = len(set(item["prompts"]))
        item["prompts"] = item["prompts"][:10]
        item["source_urls"] = sorted(item["source_urls"])
        item["source_analysis"] = analyze_sources(item["source_urls"])
        competitor_stats.append(item)

    competitor_stats.sort(
        key=lambda item: (
            -item["mention_frequency"],
            item["average_rank"] if item["average_rank"] is not None else 999,
            -item["model_count"],
        )
    )

    return {
        "summary": {
            "methodology_version": "v1.1.0",
            "responses_analyzed": len(raw_results),
            "unique_companies": len(competitor_stats),
            "top_competitor_count": min(top_n, len(competitor_stats)),
            "responses_by_assistant": dict(sorted(assistant_counts.items())),
            "responses_by_model": dict(sorted(model_counts.items())),
        },
        "user_recommendation_summary": {
            "user_company": user_company or "Unknown",
            "aliases_checked": sorted(user_keys),
            "responses_analyzed": len(raw_results),
            "user_mentions": user_mentions,
            "user_mention_rate": round(user_mentions / len(raw_results), 4)
            if raw_results
            else 0,
            "user_average_rank": round(user_rank_total / user_mentions, 2)
            if user_mentions
            else None,
            "prompts_where_user_was_recommended": user_prompt_wins,
            "prompts_where_user_was_not_recommended": user_prompt_losses,
        },
        "prompt_statistics": {
            "categories": [
                {"category": category, "count": count}
                for category, count in sorted(category_counts.items())
            ],
            "prompt_outcomes": prompt_outcomes,
        },
        "competitors": competitor_stats,
        "top_competitors": competitor_stats[:top_n],
        "source_analysis": build_global_source_analysis(competitor_stats),
        "top_sources": sorted(
            [{"url": url, "count": count} for url, count in source_counts.items()],
            key=lambda item: -item["count"],
        )[:25],
    }


def normalize_company_name(value: str) -> str:
    return " ".join(str(value).lower().split())


def is_user_company(name: str, user_keys: set[str]) -> bool:
    """The audited company, including its own sub-products. "Stripe Connect" is
    Stripe, not a competitor, and must never be listed as one."""
    normalized = normalize_company_name(name)
    if not normalized:
        return False
    return any(
        normalized == key or normalized.startswith(f"{key} ")
        for key in user_keys
    )


def build_user_keys(
    user_company: str | None,
    user_aliases: list[str] | None,
) -> set[str]:
    values = []
    if user_company:
        values.append(user_company)
    values.extend(user_aliases or [])
    keys = {normalize_company_name(value) for value in values if value}
    return {key for key in keys if key}


def find_user_match(
    recommendations: list[dict[str, Any]],
    user_keys: set[str],
) -> dict[str, Any] | None:
    if not user_keys:
        return None
    for item in recommendations:
        # A recommendation of one of the company's own products counts as the
        # company being recommended.
        if is_user_company(item.get("company_name", ""), user_keys):
            return item
    return None
