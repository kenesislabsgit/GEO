from __future__ import annotations

import re
from collections import defaultdict
from typing import Any

from .source_analysis import analyze_sources, build_global_source_analysis


# Words that describe what a company is, not which company it is. An answer
# saying "Kenesis" and another saying "Kenesis Labs" are one company placed
# twice, not two companies placed once each - counting them apart split the
# mention frequency that decides the competitor ranking.
COMPANY_SUFFIX_WORDS = {
    # Legal forms.
    "inc",
    "incorporated",
    "llc",
    "ltd",
    "limited",
    "corp",
    "corporation",
    "co",
    "company",
    "gmbh",
    "ag",
    "bv",
    "nv",
    "plc",
    "sa",
    "srl",
    "pty",
    "pvt",
    "private",
    "oy",
    "ab",
    "as",
    "sas",
    "sarl",
    # Generic descriptors and the domain endings a model writes instead of a
    # name ("kenesis.ai").
    "lab",
    "labs",
    "tech",
    "technology",
    "technologies",
    "software",
    "solutions",
    "systems",
    "platform",
    "platforms",
    "group",
    "holdings",
    "ventures",
    "partners",
    "digital",
    "global",
    "international",
    "ai",
    "io",
    "com",
    "net",
    "org",
}


def grouped_company_name(
    written_name: Any,
    company_aliases: dict[str, str] | None,
) -> str:
    """The name this spelling was grouped under, for matching against the rest
    of the audit. Falls back to the spelling itself when it heads its own
    group or when no merge ran."""
    written = str(written_name or "").strip()
    return (company_aliases or {}).get(normalize_company_name(written)) or written


def aggregate_recommendations(
    raw_results: list[dict[str, Any]],
    *,
    top_n: int = 5,
    user_company: str | None = None,
    user_aliases: list[str] | None = None,
    company_aliases: dict[str, str] | None = None,
) -> dict[str, Any]:
    """company_aliases maps a normalized spelling to its canonical display name
    (from company_merge). It changes only how mentions are grouped when counted;
    prompt outcomes and "recommended_instead" keep each answer's own words."""
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
        user_match = find_user_match(
            prompt_recommendations, user_keys, company_aliases
        )
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
                    # Who took this question and, in the assistant's own words,
                    # what it liked about them. The reason is already in the
                    # answer, so nothing has to be asked again to explain a
                    # loss — and the report can stop saying only that a
                    # question was lost without saying why.
                    "winners": [
                        {
                            "company_name": item.get("company_name", "Unknown"),
                            # Two names on purpose. Anything shown to a reader
                            # uses the assistant's own words; anything compared
                            # with the rest of the audit uses the group name,
                            # so both sides of a comparison speak one language.
                            # Carrying it here means no later step has to
                            # remember to translate - the record arrives ready.
                            "grouped_name": grouped_company_name(
                                item.get("company_name"), company_aliases
                            ),
                            "rank": item.get("rank"),
                            "reason": str(item.get("reasoning", "")).strip(),
                        }
                        for item in prompt_recommendations[:3]
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
            written_name = str(recommendation.get("company_name", "")).strip()
            canonical = (company_aliases or {}).get(
                normalize_company_name(written_name)
            )
            name = (
                normalize_company_name(canonical)
                if canonical
                else canonical_company_key(written_name)
            )
            if not name or is_user_company(
                written_name, user_keys, company_aliases
            ):
                continue

            if name not in companies:
                companies[name] = {
                    "company_name": canonical or written_name or name,
                    "name_variants": defaultdict(int),
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
            if written_name:
                item["name_variants"][written_name] += 1
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
    for key, item in companies.items():
        mentions = item["mention_frequency"]
        rank_total = item.pop("rank_total")
        variants = item.pop("name_variants")
        if variants:
            item["company_name"] = choose_display_name(variants)
        # Kept so a report can say the two names it merged were one company.
        item["canonical_key"] = key
        item["name_variants"] = sorted(variants)
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
            # v1.2.0: sentiment removed from stored results (it was never
            # measured), score breakdown stored verbatim with each snapshot,
            # cost-ceiling partials introduced. Bump this whenever scoring
            # rules change — history is compared within a version only.
            "methodology_version": "v1.2.0",
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
            # Answers and questions are different numbers, and reports that
            # carried only the first said "recommended in 5 of 105 buyer
            # questions" when ten questions were asked to six assistants.
            "questions_asked": len({
                str(result.get("prompt", "")).strip()
                for result in raw_results
                if str(result.get("prompt", "")).strip()
            }),
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
        # The map travels with the numbers it produced. Every later step
        # already receives this aggregate, so none of them needs new wiring to
        # translate a spelling - and a step that forgets to is a step whose
        # comparison quietly stops matching.
        "company_name_groups": dict(company_aliases or {}),
        "investigation_priority": rank_for_investigation(
            user_prompt_losses,
            user_prompt_wins,
            raw_results,
            user_keys,
            company_aliases,
        ),
        "source_analysis": build_global_source_analysis(competitor_stats),
        "top_sources": sorted(
            [{"url": url, "count": count} for url, count in source_counts.items()],
            key=lambda item: -item["count"],
        )[:25],
    }


# A first place is worth far more than a fifth. Being named last in an answer
# says the assistant reached for a name, not that the company won the question.
PLACEMENT_POINTS = {1: 100, 2: 80, 3: 60, 4: 40, 5: 20}
PLACEMENT_POINTS_BEYOND_FIFTH = 10


def placement_points(rank: Any) -> int:
    try:
        position = int(rank)
    except (TypeError, ValueError):
        return PLACEMENT_POINTS_BEYOND_FIFTH
    return PLACEMENT_POINTS.get(position, PLACEMENT_POINTS_BEYOND_FIFTH)


def rank_for_investigation(
    user_prompt_losses: list[dict[str, Any]],
    user_prompt_wins: list[dict[str, Any]],
    raw_results: list[dict[str, Any]],
    user_keys: set[str],
    company_aliases: dict[str, str] | None = None,
) -> list[dict[str, Any]]:
    """Whose website is worth reading to explain why this company lost.

    `top_competitors` answers a different question — who does the assistant
    recommend at all — and is ordered by how often a name appears. Ordering the
    investigation the same way picks the wrong company. On a live audit of
    kenesis.ai, AtomVision led that list with three mentions, but two of them
    were in questions Kenesis had already won and the third put it fifth. Triya
    was named twice and came **first** both times, in questions Kenesis was
    absent from. The audit read AtomVision's website and cited it under a
    finding about a question AtomVision also lost.

    So score placement, and only inside the questions the audited company was
    missing from. Where it was never missing, fall back to the questions where
    somebody was placed above it, which is the nearest thing to a loss.
    """
    lost_prompts = {str(loss.get("prompt", "")) for loss in user_prompt_losses}
    # Lost questions are the whole point, so when there are any, nothing else
    # counts. A company can place above the audited company in a question the
    # audited company still appeared in — that is a weaker signal, and letting
    # it in was enough to pull AtomVision back above Triya on the run above.
    # It is only used when the audited company was never missing.
    outranked = {} if lost_prompts else user_rank_by_prompt(user_prompt_wins)
    scores: dict[str, dict[str, Any]] = {}

    for result in raw_results:
        prompt = str(result.get("prompt", ""))
        was_lost = prompt in lost_prompts
        # Only a company placed above the audited company tells us anything
        # here; the ones it already beat do not explain a loss.
        beat_position = outranked.get(prompt)
        if not was_lost and beat_position is None:
            continue

        for recommendation in result.get("recommended_companies", []):
            name = recommendation.get("company_name", "")
            grouped = grouped_company_name(name, company_aliases)
            key = (
                normalize_company_name(grouped)
                if company_aliases
                else canonical_company_key(grouped)
            )
            if not key or is_user_company(name, user_keys, company_aliases):
                continue
            rank = recommendation.get("rank")
            if not was_lost:
                try:
                    if int(rank) >= int(beat_position):
                        continue
                except (TypeError, ValueError):
                    continue

            entry = scores.setdefault(
                key,
                {
                    "company_name": name,
                    "priority_score": 0,
                    "best_rank": None,
                    "questions": [],
                    "basis": "lost_questions" if was_lost else "outranked_questions",
                },
            )
            entry["priority_score"] += placement_points(rank)
            entry["questions"].append(
                {
                    "prompt": prompt,
                    "rank": rank,
                    "user_was_recommended": not was_lost,
                    "reason": str(recommendation.get("reasoning", "")).strip(),
                }
            )
            if was_lost:
                entry["basis"] = "lost_questions"
            try:
                position = int(rank)
            except (TypeError, ValueError):
                position = None
            if position is not None and (
                entry["best_rank"] is None or position < entry["best_rank"]
            ):
                entry["best_rank"] = position

    ranked = list(scores.values())
    for entry in ranked:
        entry["question_count"] = len(entry["questions"])
        entry["questions"] = entry["questions"][:5]
    ranked.sort(
        key=lambda entry: (
            -entry["priority_score"],
            entry["best_rank"] if entry["best_rank"] is not None else 999,
            -entry["question_count"],
            entry["company_name"].lower(),
        )
    )
    return ranked


def user_rank_by_prompt(
    user_prompt_wins: list[dict[str, Any]],
) -> dict[str, int]:
    """Where the audited company placed, for questions it did appear in."""
    positions: dict[str, int] = {}
    for win in user_prompt_wins:
        try:
            rank = int(win.get("rank"))
        except (TypeError, ValueError):
            continue
        prompt = str(win.get("prompt", ""))
        if prompt and (prompt not in positions or rank < positions[prompt]):
            positions[prompt] = rank
    return positions


def normalize_company_name(value: str) -> str:
    return " ".join(str(value).lower().split())


def canonical_company_key(value: str) -> str:
    """One key per company, whatever form the model wrote its name in.

    "Kenesis", "Kenesis Labs", "Kenesis AI", "Kenesis Inc." and "kenesis.ai"
    are the same company. Only whole trailing words are dropped, so "OpenAI"
    stays "openai" and "Amazon Web Services" stays its own company. The last
    word is never dropped - a company actually called "Labs" keeps its name.
    """
    words = re.findall(r"[a-z0-9+]+", normalize_company_name(value))
    while len(words) > 1 and words[-1] in COMPANY_SUFFIX_WORDS:
        words.pop()
    return " ".join(words)


def choose_display_name(variants: dict[str, int]) -> str:
    """The form the assistants used most often, shortest form breaking ties."""
    return sorted(
        variants.items(),
        key=lambda item: (-item[1], len(item[0]), item[0].lower()),
    )[0][0]


def is_user_company(
    name: str,
    user_keys: set[str],
    company_aliases: dict[str, str] | None = None,
) -> bool:
    """The one question every step must answer the same way: is this name the
    audited company?

    It used to be answered twice. The counting accepted a name that merely
    started with the company name, while the export accepted only an exact
    match, so one spelling could be the customer in the numbers and a stranger
    in the answers shown beside them. Both now call this.

    The merge decides first: it has every name, the reasons and a web search,
    and it puts the customer's own spellings under the customer's name. The
    fallback below only matters when the merge could not run.
    """
    normalized = normalize_company_name(name)
    if not normalized:
        return False
    grouped = (company_aliases or {}).get(normalized)
    if grouped:
        normalized = normalize_company_name(grouped)
    fallback = canonical_company_key(normalized)
    for key in user_keys:
        if normalized == key or normalized.startswith(f"{key} "):
            return True
        if fallback and fallback == canonical_company_key(key):
            return True
    return False


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
    company_aliases: dict[str, str] | None = None,
) -> dict[str, Any] | None:
    if not user_keys:
        return None
    for item in recommendations:
        # A recommendation of one of the company's own products counts as the
        # company being recommended.
        if is_user_company(item.get("company_name", ""), user_keys, company_aliases):
            return item
    return None
