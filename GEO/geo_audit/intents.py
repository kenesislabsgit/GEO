from __future__ import annotations

import json
from typing import Any

from .json_tools import extract_json_array, extract_json_object
from .llm import LLMNotConfigured, build_chat_payload, call_chat_completion


BUYER_BAND_SYSTEM_PROMPT = """You work out who actually buys from a company, using facts collected from its website.

named_customers are real customers, copied off the site. They are a sample of
the market, never the whole of it. Read the band from them: how large these
organisations are, what sectors they sit in, where they are, and who inside
them would approve the spend. Read the whole list. A list holding a startup,
two colleges and a large manufacturer describes a wide band, and answering with
only its largest member throws away most of the buyers.

When the site names nobody, work from what the company sells, the words it uses
for the people it sells to, whether prices are published, and whether a buyer
can sign up alone or has to talk to someone. Report that in band_confidence
instead of inventing customers.

company_self_description holds the company's claims about itself. A company
calling itself global, premium or enterprise-grade is describing how it wants
to be seen, which is not evidence of who buys. Weigh it far below what the
customers show. Where the two disagree, the customers decide.

Then write buyer_situations: people who would go looking for this kind of
provider tomorrow. Each one is somebody in the band with their own problem, and
never a named customer. Give the role, the kind of organisation, what happened
that made them start looking, and the constraint that will shape their choice.
Spread them across the band. If the band runs from small firms to large ones,
some situations must be small and some large; filling them all with the largest
kind of buyer is the mistake this step exists to prevent.

sector_focus: whether this company sells into one sector or works across many.
Two things show it, and either is enough. What it sells: a product that only
functions in one setting is specialist however few customers it names. And who
it has sold to: customers spread across unrelated sectors are evidence of a
generalist, because a firm winning work in mental health, car parts and
education is being hired for a craft rather than for knowing an industry.
Write specialist or generalist, and say in sector_focus_reason what decided it.

This changes who the buyers are, so decide it before writing any of them.
For a specialist the sector is the business, so every buyer sits inside it and
they differ by role, size and problem.
For a generalist the sectors its past customers came from are its history, not
its market. Nobody goes looking for the firm that once served a college because
they are a college. Those customers show the size of organisation, the budget
and the way of buying that this company fits, and the next buyer is anybody at
that level with that kind of job. Spread buyer_situations across sectors it has
never worked in as well as ones it has, and let what they have in common be the
level and the problem rather than the industry.

words_they_use holds how that buyer talks about their own problem, not how the
company advertises. A college administrator says "student portal", not
"end-to-end digital transformation".

buyer_words_for_provider is what a buyer would call this kind of company when
asking someone to recommend one: "web development agency", "payroll software",
"stock broker". Two or three plain words. Companies describe themselves as
partners, platforms and end-to-end providers of solutions; buyers do not use
any of those, so none of them belong here.

geography is one country or region, or Unknown. Not a sentence.

Return only valid JSON:
{
  "band_summary": "",
  "buyer_words_for_provider": "",
  "sector_focus": "specialist|generalist",
  "sector_focus_reason": "",
  "organization_sizes": [],
  "sectors": [],
  "geography": "",
  "decision_makers": [],
  "band_confidence": "High|Medium|Low",
  "band_evidence": [],
  "buyer_situations": [
    {
      "situation_id": "",
      "role": "",
      "organization": "",
      "trigger": "",
      "constraint": "",
      "words_they_use": []
    }
  ]
}"""


INTENT_SYSTEM_PROMPT = """You write the questions real buyers type into an AI assistant when they are looking for a provider.

Understand the company first. Read what it sells, the problems it solves, the
customers it has actually worked for and how a purchase happens there, and work
out what this business really is and who ends up paying it. buyer_band is that
same thinking already done once, with buyer_situations as the people inside it
who would go looking tomorrow; use it, and trust the underlying facts over it
wherever the two disagree.

Then write the way those people write. Somebody searching types the problem in
their head and enough about themselves to make the answer useful, in the words
they already use for their own work. words_they_use and buyer_facing_terms hold
those words.

Name the kind of company with buyer_words_for_provider, in every question,
exactly as it is written there. This is the one wording decision already made
for you, and it is made because every other description of this company in
front of you was written by the company itself. Somebody searching says "web
development agency" or "payroll software"; they never say they are looking for
a partner or a solutions provider.

Spread the set across the buyers you found instead of writing one person five
times, and keep the range: where the customers run from small firms to large
ones, the questions must too. required_search_frame marks the boundary of what
counts as a direct peer, so use it to judge what belongs in scope.

sector_focus decides whether industry belongs in a question at all.
When it is specialist, the sector is the business and most questions sit inside
it.
When it is generalist, the industries of past customers are history rather than
market, and turning a list of past projects into a list of questions measures
the wrong thing. One college and one clinic among five customers do not mean
the next buyer runs a college or a clinic; they mean this company suits
organisations of that size, with that budget, buying that way. Build those
questions around the job and the buyer's situation, and let the industries
differ from the ones already served.

Never:
- name the company, its website, or any of its customers. Somebody searching
  today has their own problem and has never heard of them
- borrow the company's own words about itself. Partner, solutions, platform,
  end-to-end and enterprise-grade are what sellers call themselves, and nobody
  types them into a search box. company_self_description holds them, and
  required_search_frame is worded from the same pages, so take scope from it
  but never wording
- make the buyer bigger or more important than the evidence supports. One large
  customer among five does not make every buyer a large enterprise, and asking
  on behalf of one summons vendors this company never competes with
- stack three or four demands into one question. A person asks for one thing
  and mentions one or two things about their situation
- write out capabilities like a requirements document. If it reads as a
  specification it will be answered with software rather than with a supplier
- ask how to build or implement something. This buyer wants somebody to do it
- invent a region, budget, size, industry or requirement the facts do not
  support, or restate a broader generic category in place of what this company
  actually is
- write a question that would be answered the same way for every company in
  the category. Something in it has to belong to this buyer

Vary the stage of buying across the set: some people are just discovering that
options exist, others are comparing a shortlist or deciding. Only ask about
price or region where the facts support it.

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

Apply one test above all others. Read the question as if you knew nothing about
this company: would it return the same answer for every provider in the
category? Then it measures nothing and has to be rewritten so that it carries
the asker's situation, constraint, sector, size or market. "Best CRM software"
fails. "CRM that a 30-person insurance brokerage can set up without a
consultant" passes.

Check the set against buyer_band as a whole. The situations in it must be
covered, and the spread of organisation sizes must survive: a band running from
small firms to large ones whose questions all sound large has lost half its
buyers, which is the most common failure here. Rewrite the surplus rather than
dropping coverage.

Rewrite or replace any candidate that is generic, unnatural, unsupported,
brand-led, implementation-focused, or likely to compare a specialist provider
with a structurally different class of company. Do not introduce facts absent
from the profile. Do not mention the audited company or any of its customers.
Preserve variety across real discovery, problem, use-case, comparison, and
decision-stage searches.
Reject marketing-style or overstuffed wording. Each question should normally be
one short sentence with one buyer need and no more than two scope details.
Anything past twenty-five words is overstuffed and must be cut back, and a
question longer than thirty words is discarded before you see the results.
Strip vendor framing while you cut. required_search_frame is worded from the
company's own pages, so it sets scope but never wording; name the kind of
company with buyer_words_for_provider instead. Partner, solutions, platform and
end-to-end are seller words, and a buyer says what they want built or fixed.
Distribute industries, delivery preferences, decision factors, and use cases
across different questions rather than repeating them in every question.

Return only a valid JSON array with exactly requested_question_count objects.
Each object must contain category, buying_stage, persona_id, intent,
profile_evidence, and prompt. Every prompt must be a natural question that asks
for suitable providers or products."""


MAX_BUYER_SITUATIONS = 6
BAND_CONFIDENCE_LEVELS = ("High", "Medium", "Low")
SECTOR_FOCUS_KINDS = ("specialist", "generalist")
# Deliberately two words. Told twice not to, the model still answered "custom
# software development partner", and that phrase opened five questions in a
# row. Longer lists were tried and each one deleted a phrase buyers really use:
# "payment platform", "cloud provider", "SEO specialist" are how people search.
# Nobody asks for a partner, so that word alone is worth correcting.
SELLER_NOUNS = frozenset({"partner", "partners"})
BUYER_NOUN = "company"
# Nobody types thirty words into a search box. Asked for short questions and
# given a rich band, the writer still produced "Which technology partners offer
# end-to-end custom software development and SaaS tool integrations for
# early-stage SaaS startups needing to automate onboarding workflows with
# transparent pricing?" — four constraints in one breath. The ceiling is well
# above a natural question so it only catches the ones that ran away.
MAX_QUESTION_WORDS = 30
MAX_GEOGRAPHY_WORDS = 4


def build_buyer_band_payload(
    company_profile: dict[str, Any],
    *,
    situation_count: int,
) -> dict[str, Any]:
    return build_chat_payload(
        BUYER_BAND_SYSTEM_PROMPT,
        json.dumps(
            {
                "requested_situation_count": situation_count,
                "company_facts": build_question_profile_context(company_profile),
            },
            indent=2,
            ensure_ascii=False,
        ),
        temperature=0.2,
        json_response=True,
    )


def derive_buyer_band(
    company_profile: dict[str, Any],
    *,
    situation_count: int = MAX_BUYER_SITUATIONS,
) -> tuple[dict[str, Any], dict[str, Any], str | None]:
    """Turn the collected facts into the population that buys from this company.

    Its own step because the question writer was doing this silently, in the
    same breath as writing prose, and it showed. Given five customers spanning
    a startup, two colleges and a large manufacturer, it wrote every question
    for the manufacturer. Deciding who the buyers are, and only then how they
    speak, keeps the small half of a band from disappearing.
    """
    payload = build_buyer_band_payload(
        company_profile, situation_count=situation_count
    )
    try:
        raw = call_chat_completion(payload)
    except (LLMNotConfigured, RuntimeError, TimeoutError) as exc:
        return {}, payload, str(exc)
    band = normalize_buyer_band(extract_json_object(raw), situation_count)
    # Geography is already settled by code from currencies, regulators and the
    # country domain. Asked for again here, the model wrote a paragraph of
    # hedging, so the deterministic answer wins whenever there is one.
    market = concise_profile_value(company_profile.get("primary_market"), "Unknown")
    if market != "Unknown":
        band["geography"] = market
    return band, payload, None


def buyer_words_for_provider(value: Any) -> str:
    """What a buyer calls this kind of company, with the seller's word removed.

    Every question is built on this phrase, so one seller word here reaches all
    of them. "Custom software development partner" became the opening of five
    questions in a row; swapping the last word gives "custom software
    development company", which is what somebody searching actually types.
    """
    words = concise_profile_value(value, "").split()
    if not words:
        return ""
    if words[-1].strip(" .,").lower() in SELLER_NOUNS:
        words[-1] = BUYER_NOUN
    return " ".join(words)


def normalize_buyer_band(value: Any, situation_count: int) -> dict[str, Any]:
    raw = value if isinstance(value, dict) else {}
    confidence = str(raw.get("band_confidence", "")).strip().title()
    situations = []
    for index, item in enumerate(raw.get("buyer_situations") or [], start=1):
        if not isinstance(item, dict):
            continue
        role = concise_profile_value(item.get("role"), "")
        organization = concise_profile_value(item.get("organization"), "")
        if not role and not organization:
            continue
        situations.append(
            {
                "situation_id": concise_profile_value(
                    item.get("situation_id"), f"situation-{index}"
                ),
                "role": role,
                "organization": organization,
                "trigger": concise_profile_value(item.get("trigger"), ""),
                "constraint": concise_profile_value(item.get("constraint"), ""),
                "words_they_use": clean_profile_list(item.get("words_they_use"))[:6],
            }
        )
    # A place name, not a paragraph. Asked where the buyers are, the model
    # answered "Not explicitly stated; likely global or multi-region given the
    # 'premium global technology partner' claim", which anchors nothing.
    geography = concise_profile_value(raw.get("geography"), "Unknown")
    if len(geography.split()) > MAX_GEOGRAPHY_WORDS:
        geography = "Unknown"
    focus = str(raw.get("sector_focus", "")).strip().lower()
    return {
        "band_summary": concise_profile_value(raw.get("band_summary"), ""),
        "buyer_words_for_provider": buyer_words_for_provider(
            raw.get("buyer_words_for_provider")
        ),
        # Unknown falls to specialist, which keeps questions inside the sectors
        # the site can actually show. Guessing generalist would invent a market.
        "sector_focus": focus if focus in SECTOR_FOCUS_KINDS else "specialist",
        "sector_focus_reason": concise_profile_value(
            raw.get("sector_focus_reason"), ""
        ),
        "organization_sizes": clean_profile_list(raw.get("organization_sizes"))[:5],
        "sectors": clean_profile_list(raw.get("sectors"))[:6],
        "geography": geography,
        "decision_makers": clean_profile_list(raw.get("decision_makers"))[:5],
        "band_confidence": (
            confidence if confidence in BAND_CONFIDENCE_LEVELS else "Low"
        ),
        "band_evidence": clean_profile_list(raw.get("band_evidence"))[:6],
        "buyer_situations": situations[:situation_count],
    }


def build_customer_intent_payload(
    company_profile: dict[str, Any],
    *,
    count: int = 30,
    buyer_band: dict[str, Any] | None = None,
) -> dict[str, Any]:
    user_prompt = json.dumps(
        {
            "requested_question_count": count,
            "buyer_profile": build_question_profile_context(company_profile),
            "buyer_band": buyer_band or {},
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
    buyer_band: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return build_chat_payload(
        INTENT_REVIEW_SYSTEM_PROMPT,
        json.dumps(
            {
                "requested_question_count": count,
                "buyer_band": buyer_band or {},
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
    profile_issue = question_profile_issue(company_profile)
    if profile_issue:
        return None, build_customer_intent_payload(company_profile, count=count), (
            profile_issue
        )

    buyer_band, band_payload, band_error = derive_buyer_band(company_profile)
    if band_error:
        return None, band_payload, f"Buyer band failed: {band_error}"

    payload = build_customer_intent_payload(
        company_profile, count=count, buyer_band=buyer_band
    )
    try:
        raw_response = call_chat_completion(payload)
    except (LLMNotConfigured, RuntimeError, TimeoutError) as exc:
        return None, payload, str(exc)
    # Recorded after the call. Everything on this dict is sent as request
    # arguments, and the provider rejects the ones it does not know.
    payload["band_payload"] = band_payload
    payload["buyer_band"] = buyer_band

    candidates = sanitize_prompt_records(
        extract_json_array(raw_response), company_profile
    )
    review_payload = build_customer_intent_review_payload(
        company_profile,
        candidates,
        count=count,
        buyer_band=buyer_band,
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
        prompts, repair_payload, repair_error = repair_short_question_set(
            company_profile,
            prompts,
            count=count,
            buyer_band=buyer_band,
        )
        payload["repair_payload"] = repair_payload
        if repair_error:
            return None, payload, repair_error
    return prompts[:count], payload, None


def repair_short_question_set(
    company_profile: dict[str, Any],
    kept: list[dict[str, Any]],
    *,
    count: int,
    buyer_band: dict[str, Any],
) -> tuple[list[dict[str, Any]], dict[str, Any], str | None]:
    """Ask once more for the questions the checks threw away.

    The checks that drop a question are the point of this step, so the run
    should not end because they did their job. Overlong drafts wiped out most
    of one live set; asking for replacements against the same band cost one
    call and kept the audit alive.
    """
    missing = count - len(kept)
    payload = build_chat_payload(
        INTENT_REVIEW_SYSTEM_PROMPT,
        json.dumps(
            {
                "requested_question_count": count,
                "buyer_band": buyer_band or {},
                "required_search_frame": build_required_search_frame(
                    company_profile
                ),
                "candidate_questions": kept,
                "repair_instruction": (
                    f"{missing} questions were discarded for being too long, "
                    "repeating another, or naming the company or a customer. "
                    "Keep every question above unchanged and write "
                    f"{missing} more, each under twenty words, each for a "
                    "buyer situation the set does not already cover."
                ),
            },
            indent=2,
            ensure_ascii=False,
        ),
        temperature=0.3,
    )
    try:
        response = call_chat_completion(payload)
    except (LLMNotConfigured, RuntimeError, TimeoutError) as exc:
        return kept, payload, f"Question repair failed: {exc}"

    merged = sanitize_prompt_records(
        [*kept, *extract_json_array(response)], company_profile
    )
    if len(merged) < count:
        return (
            merged,
            payload,
            "Question review did not return enough distinct, profile-matched questions.",
        )
    return merged, payload, None


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
        "named_customers": named_customers(company_profile),
        "buying_signals": buying_signals(company_profile),
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


def named_customers(company_profile: dict[str, Any]) -> list[dict[str, str]]:
    """The customers the site names, with the page reference dropped.

    Passed on as names rather than as a size label. A question writer that can
    see "Rajalakshmi Engineering College" knows to ask what a college asks; one
    handed the word "enterprise" cannot get back to that.
    """
    raw = company_profile.get("named_customers")
    if not isinstance(raw, list):
        return []
    rows = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        name = concise_profile_value(item.get("name"), "")
        if not name:
            continue
        rows.append(
            {
                "name": name,
                "described_as": concise_profile_value(item.get("described_as"), ""),
            }
        )
    return rows


def buying_signals(company_profile: dict[str, Any]) -> dict[str, Any]:
    raw = company_profile.get("buying_signals")
    if not isinstance(raw, dict):
        return {}
    return {
        "pricing_visible": bool(raw.get("pricing_visible")),
        "purchase_path": concise_profile_value(raw.get("purchase_path"), "unknown"),
        "buyer_facing_terms": clean_profile_list(raw.get("buyer_facing_terms"))[:8],
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
    customers = named_customers(company_profile)
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
        # Names, not a tier word. They show the band this company works in, and
        # the question writer reads a band off five names far better than off
        # one label that had to pick a winner among them.
        "named_customers": customers,
        "industries": clean_profile_list(company_profile.get("industries"))[:5],
        # regions_served needs a page to name a service area, which most sites
        # never do. primary_market covers the rest and is read off the pages by
        # code: prices in a national currency, a regulator, a country domain.
        "regions": clean_profile_list(company_profile.get("regions_served"))[:4]
        or clean_profile_list([company_profile.get("primary_market")]),
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
            or len(prompt.split()) > MAX_QUESTION_WORDS
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

    # A question naming a client is written for that client, not for the band
    # they stand for. Nobody searching today has heard of them. Only the full
    # name is banned: single words like "India" or "College" belong to buyers
    # as much as to the customer they were taken from.
    for customer in named_customers(company_profile):
        name = customer["name"].strip().lower()
        if len(name) > 3:
            terms.add(name)

    # The company's own marketing wording. No buyer types "premium global
    # technology partner" into a search box, and a question carrying it is
    # written in the seller's voice rather than the buyer's.
    signals = company_profile.get("buying_signals")
    if isinstance(signals, dict):
        for claim in signals.get("company_self_description") or []:
            phrase = " ".join(str(claim).split()).strip(" .").lower()
            if len(phrase.split()) >= 3:
                terms.add(phrase)

    return {term for term in terms if term}


def contains_banned_term(prompt: str, banned_terms: set[str]) -> bool:
    value = prompt.casefold()
    return any(term.casefold() in value for term in banned_terms)
