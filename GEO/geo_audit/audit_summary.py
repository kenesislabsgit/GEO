"""The executive verdict - the one paragraph the owner reads first.

Written by its own small call rather than as a spare field on the
recommendation call. Two things went wrong while it was a passenger there.

The recommendation call is handed the whole report: every page excerpt, the
evidence catalog, the citation rules, four losses each carrying the assistant's
full reasoning, and one win reduced to four bare fields. Asked for a verdict at
the end of all that, the model wrote what the bulk of the text said instead of
what the counts said - "recommended in none of the five" for a company that was
recommended once and ranked first when it was. Nothing in that call forced the
prose to agree with the arithmetic.

So the arithmetic is no longer the model's to state. Code writes the standing
sentence from the stored counts, where it cannot be wrong, and the model writes
only the part that needs judgement: who is taking the questions, what they have,
and the single most useful change. The prompt says so plainly.

The input is roughly a tenth of what the recommendation call receives - the
counts, the questions won and lost, the leading competitor and why, and the top
action. Every one of those is produced by an earlier stage; this call computes
nothing of its own.
"""

from __future__ import annotations

import json
from typing import Any

from .llm import LLMNotConfigured, build_chat_payload, call_chat_completion


# Room for the model's two sentences with slack, not a target to write up to -
# the prompt controls the length, this only catches a runaway. Set too tight it
# silently eats the closing sentence, which is the one telling the owner what to
# do. Trimming happens at a sentence end, never mid-word: the old
# 700-character cut on the combined blob ended one report at "and natural lan."
AUDIT_SUMMARY_MODEL_LENGTH = 620

AUDIT_SUMMARY_SYSTEM_PROMPT = """\
You write the opening verdict of an AI visibility audit, for somebody who owns
the company and has thirty seconds.

The first sentence is already written for you and is not your job: it states how
many buyer questions recommended this company, out of how many, and where it
ranked. Those numbers are measured. Never restate them, never contradict them,
never round them, and do not open by naming the company again.

Write exactly two sentences that carry on from it. Not one, not three.

Sentence one: which competitor is taking the questions, and the one thing it
has that this company does not. Use the reason the assistants themselves gave,
and say what the buyer was asking for in their own words.

Sentence two: the single most useful thing to change, written as an
instruction to the owner and starting with a verb - "Add...", "Publish...",
"Show...". Take it from top_suggested_change and cut it to its point. A verdict
that ends without this leaves the reader with nothing to do, so it is never the
sentence you drop.

Plain words a customer would use out loud. No preamble, no restating the
question, no "consider", no "in order to", no hedging. Do not describe the audit
or the assistants as a process - the reader wants to know where they stand, not
how it was measured.

If the company won a question, that win is real and must not be written away.

Return the sentences as plain text. No JSON, no headings, no bullet points, no
quotation marks around the whole thing.
"""


def ordinal_rank(value: Any) -> str:
    """Average rank reads as a word when it is exactly a place, and as a number
    when it is a genuine average of different places."""
    try:
        rank = float(value)
    except (TypeError, ValueError):
        return ""
    if rank <= 0:
        return ""
    if abs(rank - round(rank)) < 0.05:
        whole = int(round(rank))
        words = {1: "first", 2: "second", 3: "third"}
        return words.get(whole, f"{whole}th")
    return f"{rank:.1f} on average"


def build_standing_sentence(
    company_name: str,
    recommendation_patterns: dict[str, Any],
) -> str:
    """The measured fact, written by code. The model never gets to state this.

    The number counted here is answers, not questions. Ten questions put to six
    assistants produce sixty answers, and calling those sixty "buyer questions
    tested" told a customer we had asked sixty questions when we asked ten. The
    sentence now says what was actually counted.
    """
    summary = recommendation_patterns.get("user_recommendation_summary", {})
    answers = int(summary.get("responses_analyzed", 0) or 0)
    mentions = int(summary.get("user_mentions", 0) or 0)
    questions = int(summary.get("questions_asked", 0) or 0)
    name = str(company_name or "This company").strip() or "This company"
    asked = (
        f"{questions} buyer questions put to AI assistants"
        if questions
        else "the buyer questions put to AI assistants"
    )

    if not answers:
        return f"{name} could not be measured - no AI answers were collected."
    if not mentions:
        return (
            f"{name} was not recommended in any of the {answers} answers we "
            f"collected from {asked}."
        )

    sentence = (
        f"{name} was recommended in {mentions} of the {answers} answers we "
        f"collected from {asked}"
    )
    rank = ordinal_rank(summary.get("user_average_rank"))
    if rank:
        placing = "ranked " + rank
        sentence += f", {placing} where it appeared"
    return sentence + "."


def build_audit_summary_payload(
    company_profile: dict[str, Any],
    recommendation_patterns: dict[str, Any],
    audit_recommendations: list[dict[str, Any]] | None,
) -> dict[str, Any]:
    summary = recommendation_patterns.get("user_recommendation_summary", {})
    top_competitors = recommendation_patterns.get("top_competitors", []) or []
    leader = top_competitors[0] if top_competitors else {}
    top_action = (audit_recommendations or [{}])[0] or {}

    data = {
        "already_written_first_sentence": build_standing_sentence(
            str(company_profile.get("company_name", "")),
            recommendation_patterns,
        ),
        "company": company_profile.get("company_name"),
        "what_it_sells": company_profile.get("category")
        or company_profile.get("description"),
        "questions_it_won": [
            item.get("prompt")
            for item in summary.get("prompts_where_user_was_recommended", [])[:5]
        ],
        "questions_it_lost": [
            item.get("prompt")
            for item in summary.get("prompts_where_user_was_not_recommended", [])[:5]
        ],
        "leading_competitor": {
            "name": leader.get("company_name"),
            "recommended_in": leader.get("mention_frequency"),
            "why_assistants_pick_it": (leader.get("sample_reasoning") or [None])[0],
        },
        "top_suggested_change": top_action.get("suggested_change")
        or top_action.get("observation"),
    }
    return build_chat_payload(
        AUDIT_SUMMARY_SYSTEM_PROMPT,
        json.dumps(data, separators=(",", ":"), ensure_ascii=False),
        temperature=0.2,
    )


def trim_to_sentence(value: Any, max_length: int) -> str:
    """Cut at the last sentence that fits. A verdict that stops mid-word reads
    as a broken page, so losing a whole sentence is the cheaper failure."""
    text = " ".join(str(value or "").split())
    if len(text) <= max_length:
        return text
    window = text[:max_length]
    cut = max(window.rfind(". "), window.rfind("! "), window.rfind("? "))
    if cut > 0:
        return window[: cut + 1]
    # No sentence end to cut at: keep whole words rather than splitting one.
    return window[: window.rfind(" ") if " " in window else max_length].rstrip(" ,;:-")


def generate_audit_summary(
    company_profile: dict[str, Any],
    recommendation_patterns: dict[str, Any],
    audit_recommendations: list[dict[str, Any]] | None = None,
) -> tuple[str, dict[str, Any], str | None]:
    """Returns (summary, payload, error). The standing sentence is code's, so a
    failed call still leaves a true verdict rather than an empty one."""
    standing = build_standing_sentence(
        str(company_profile.get("company_name", "")),
        recommendation_patterns,
    )
    payload = build_audit_summary_payload(
        company_profile, recommendation_patterns, audit_recommendations
    )
    try:
        raw = call_chat_completion(payload)
    except LLMNotConfigured as exc:
        payload["summary"] = standing
        return standing, payload, str(exc)

    judgement = trim_to_sentence(strip_wrapping_quotes(raw), AUDIT_SUMMARY_MODEL_LENGTH)
    summary = f"{standing} {judgement}".strip() if judgement else standing
    payload["summary"] = summary
    return summary, payload, None


def strip_wrapping_quotes(value: Any) -> str:
    text = " ".join(str(value or "").split())
    if len(text) >= 2 and text[0] in "\"'" and text[-1] == text[0]:
        return text[1:-1].strip()
    return text
