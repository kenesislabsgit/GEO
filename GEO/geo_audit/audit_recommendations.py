from __future__ import annotations

import json
import re
from typing import Any
from urllib.parse import urlparse

from .evidence import readable_excerpt
from .json_tools import extract_json_array, extract_json_object
from .firecrawl import (
    FirecrawlClient,
    FirecrawlError,
    environment_int,
    firecrawl_document_to_page,
)
from .aggregation import build_user_keys
from .llm import (
    LLMNotConfigured,
    build_chat_payload,
    call_chat_completion,
    call_chat_message,
)
from .report_context import (
    OPEN_PAGE_TOOL,
    OPEN_QUESTION_TOOL,
    anonymous_assistant_labels,
    assistant_and_model_names,
    build_headline_numbers,
    build_company_blocks,
    build_question_rows,
    open_page,
    trim_profile,
    open_question,
    strip_assistant_names,
)


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


AUDIT_RECOMMENDATION_SYSTEM_PROMPT = """You are writing the improvements section of an AI visibility audit.

WHAT THIS IS FOR

A company pays to learn why AI assistants recommend rivals instead of them, and
what to change on their website about it. We asked several assistants the same
buyer questions and recorded every company each one named. Your job is to turn
that into a short list of changes worth making.

WHAT KIND OF DATA YOU HAVE

about_this_audit - how many questions were asked, how many assistants answered,
how often the audited company was named.

the_company - what they sell, who buys it, what they claim.

every_question_we_asked - each buyer question, how many times the audited
company was recommended in the answers to it, and which other companies were
recommended and how often.

each_company - one block per company. The audited company, and the five rivals
named most often across the answers. Other companies appear in the question
lists but have no block here, so there is nothing to cite for them.
  official_website - their front door.
  pages_on_their_own_website - pages we read from that site. What they publish
    about themselves. Marketing, so it shows what they say, never whether it is
    true.
  pages_the_assistants_cited_while_answering - pages an assistant pointed a
    buyer at while answering. This is what AI reaches for today. An empty list
    means AI pointed at this company not once.
  pages_the_wider_internet_holds_about_them - reviews, comparisons, forum
    threads written by other people. This matters twice over. It is what an
    assistant finds when it searches the web today, and it is the same kind of
    public material an assistant is built from, so it shapes what a model knows
    about a company before anyone asks it anything. A company the internet does
    not discuss is one an assistant has little to say about, whether it searches
    or answers from what it already knows. Empty means nobody is writing about
    them.

Read those last two lists as a pair. Cited tells you what AI reaches for.
Written about tells you what there is to reach for. Together they say which
problem a company has, and there are three:

  Cited plenty, written about plenty.
  People write about them, AI finds it and uses it. Nothing to fix here.

  Cited none, written about plenty.
  The material is out there and AI is not picking it up. The work is being
  easier to find and easier to quote, not writing more.

  Cited none, written about none.
  Nobody is writing about them. Tidying their own website will not change this;
  they need other people talking about them.

Three different problems with three different answers, so decide which one the
audited company has before you write anything.

YOUR TOOLS

open_question(question_id) - every assistant's full answer to that question,
including the reason each gave for every company it named.

open_page(page_id) - the first 6,000 characters of that page, which is usually
the whole of what matters. If you need more, ask for the next part; the answer
tells you how many parts there are.

  open_page("p-014")             the first 6,000 characters
  open_page("p-014", part=2)     the next 6,000, only if the first left you short

For a page under what the wider internet holds, you may ask for the parts that
name that company instead of the page:

  open_page("p-072", how="passages")

Twelve opens in total. That is a budget, not a target. Most questions need no
opening - the list already says who was named and how often. Open a question when
the audited company is missing and the same rival keeps taking it, or when you
are about to write about that question. Open a page before saying what is on it.

HOW TO DECIDE WHAT TO WRITE

Start with the questions the audited company was never recommended in. Those are
what it is losing. For each, look at who took it, then at what that company
publishes and what is written about them elsewhere.

A gap is a job a rival's pages do for a buyer that none of the audited company's
pages does. Open both pages before claiming one. If a page already does the job
under a different name, it is not missing, and saying it is is the mistake
readers notice fastest.

WHAT EACH RECOMMENDATION MUST BE

One lost question, the company that took it, and the change that answers it. The
question, the reason that company won, and the pages you cite must all be about
the same thing.

Cite two pages where you can: the rival's page showing what they do, and the
audited company's page that should change. Put page_id values in evidence_refs.
The citation carries the address to the reader, and it is the only address they
get.

Write at least three. More when the evidence supports it, never padding.

WHERE OUR DATA IS WEAK

Say nothing about any of this in what you write. Handle it and move on.

Company names were gathered from many spellings into one. It is usually right.
Occasionally two entries are really one company, or one entry has taken in two
products. Where you end up more suspicious than sure, build on something else
and say nothing about that name. Keep the bar high - most entries are sound, and
discarding a good one costs a real finding.

A company with no pages at all was not read, which is not the same as publishing
nothing. Never write a gap from an empty list.

An official_website may be missing or point at a parent company. Where a
company's pages do not hang together as one business, treat that company as
unverified and do not cite it.

Four of the assistants cannot browse the web, so they cite nothing. An empty
cited list is a finding about the company, not about them.

NEVER

Never name an AI assistant or a model. Write "three of the six assistants",
"most assistants", "one assistant". A report naming them reads as an audit of
one vendor rather than of a market.

Never type a web address into a sentence. Describe the page - eg : "their pricing
page", "your setup guide" - and let the citation carry the address. One typed
from memory sends the reader nowhere.

Never write a page_id or question_id into your sentences. They are labels for
this system; the reader sees your prose. Name the question or the company.

Never tell the reader to change a page they do not own.

Never claim a change will make an AI recommend them, or talk about search
rankings, snippets or SEO.

HOW TO WRITE IT

For somebody reading once. Short sentences, ordinary words, one idea per
sentence. "Buyers looking for X are sent to Y", not "the audited company
exhibits suboptimal alignment with observed competitor patterns".

Never use: leverage, utilize, robust, holistic, synergy, optimize, seamless.
Say shows, uses, about.

Avoid anything that would read the same for any company in this category.

EVERY RECOMMENDATION RETURNS

observation, evidence, suggested_change, expected_impact, confidence,
evidence_types, evidence_refs, affected_loss_refs.

Use question_id values from every_question_we_asked in affected_loss_refs, up to
three. Use page_id values in evidence_refs, up to three. Return an empty list
rather than a reference you cannot stand behind.
"""

# Four sentences read in thirty seconds, not a page.
AUDIT_SUMMARY_LENGTH = 700
AUDIT_RECOMMENDATION_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "recommendations": {
            "type": "array",
            "minItems": 3,
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
    raw_results: list[dict[str, Any]] | None = None,
) -> tuple[list[dict[str, Any]] | None, dict[str, Any], str | None]:
    """limit keeps only the top N written actions. The model is asked for at
    least three (schema-enforced via minItems); the free audit keeps the top
    three. The deterministic top-competitor finding is kept only as a fallback
    when the model returns nothing at all."""
    evidence_catalog = build_verified_evidence_catalog(competitor_evidence)
    answers = raw_results or []
    company_name = str(company_profile.get("company_name", ""))
    user_keys = build_user_keys(
        company_name, company_profile.get("company_name_variants")
    )
    question_rows = build_question_rows(
        answers,
        company_name,
        user_keys,
        recommendation_patterns.get("company_name_groups") or {},
    )
    pages, blocks = build_company_blocks(
        company_profile, competitor_evidence, recommendation_patterns,
        answers, user_snapshot,
    )
    evidence_catalog = add_missing_pages_to_the_catalog(evidence_catalog, pages)
    labels = anonymous_assistant_labels(answers)
    payload = build_audit_recommendations_payload(
        company_profile,
        user_evidence,
        recommendation_patterns,
        competitor_evidence,
        comparison,
        evidence_catalog=evidence_catalog,
        user_snapshot=user_snapshot,
        raw_results=answers,
        question_rows=question_rows,
        company_blocks=blocks,
    )
    if pages or question_rows:
        payload["tools"] = [OPEN_PAGE_TOOL, OPEN_QUESTION_TOOL]
    try:
        raw_response, opened = answer_with_open_tools(
            payload, pages, question_rows, answers, labels
        )
    except LLMNotConfigured as exc:
        return None, payload, str(exc)
    payload["opened"] = opened

    if raw_response.lstrip().startswith("["):
        parsed = extract_json_array(raw_response)
        summary = ""
    else:
        response = extract_json_object(raw_response)
        parsed = response.get("recommendations", [])
        summary = strip_internal_references(
            concise_text(response.get("summary"), AUDIT_SUMMARY_LENGTH)
        )
    if not isinstance(parsed, list):
        parsed = []
    # Where the report stands is written once, in the call that already knows
    # everything, and read straight off the payload afterwards. A dashboard
    # that picked one of three sentences off the mention rate was the only
    # thing standing in for it.
    payload["summary"] = strip_assistant_names(
        summary, assistant_and_model_names(answers)
    )

    prompt_losses = compact_recommendation_patterns(recommendation_patterns)[
        "user_company_recommendation_summary"
    ]["prompt_losses"]

    hidden = assistant_and_model_names(answers)
    normalized = [
        hide_assistant_names(normalize_recommendation(item), hidden)
        for item in parsed
    ]
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
    resolved = resolve_affected_prompts(resolved, prompt_losses, question_rows)
    resolved = keep_evidence_from_the_companies_that_won(resolved, company_name)
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
    raw_results: list[dict[str, Any]] | None = None,
    question_rows: list[dict[str, Any]] | None = None,
    company_blocks: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    catalog = (
        evidence_catalog
        if evidence_catalog is not None
        else build_verified_evidence_catalog(competitor_evidence)
    )
    company_name = str(company_profile.get("company_name", ""))
    user_keys = build_user_keys(
        company_name, company_profile.get("company_name_variants")
    )
    aliases = recommendation_patterns.get("company_name_groups") or {}
    rows = (
        question_rows
        if question_rows is not None
        else build_question_rows(raw_results or [], company_name, user_keys, aliases)
    )
    data = {
        "about_this_audit": build_headline_numbers(
            raw_results or [], rows, company_name, user_keys, aliases
        ),
        "the_company": trim_profile(company_profile),
        # One row per question, with who was named across every assistant.
        # Sending answers instead sent the same question five times over.
        "every_question_we_asked": rows,
        # One block per company rather than one list per source. Within a block
        # the three lists answer three different questions: what the company
        # publishes, what AI reaches for, and what the wider internet holds.
        # The last two read together are the diagnosis - a company nobody cites
        # but everybody writes about has a different problem from one nobody
        # writes about at all, and the old shape could not express either.
        "each_company": company_blocks or {},
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
                    # The assistant already said what it liked about each
                    # winner. Handing that over means the report can explain
                    # why a question was lost instead of only that it was.
                    "winners": [
                        {
                            "company_name": winner.get("company_name"),
                            "rank": winner.get("rank"),
                            "reason": concise_text(winner.get("reason"), 300),
                        }
                        for winner in item.get("winners", [])[:3]
                    ],
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
    catalog: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    # Every page crawled from a competitor is already in the citation catalog
    # with its real address. Joining on that address gives each inventory row
    # the evidence_id it can be cited by, so the reader's link keeps coming
    # from the catalog exactly as it did before and the model never has to
    # write an address itself.
    id_by_url = {
        canonical_url(row.get("url")): row.get("evidence_id")
        for row in (catalog or [])
        if row.get("url") and row.get("evidence_id")
    }
    return {
        "summary": competitor_evidence.get("summary", {}),
        "competitors": [
            {
                "company_name": item.get("company_name", "Unknown"),
                # No addresses here. Every page is cited by id, and an address
                # sitting in the context is an address the writer can copy into
                # a sentence, where nothing vouches for it.
                "recommendation_pattern": {
                    key: value
                    for key, value in (item.get("recommendation_pattern") or {}).items()
                    if key not in {"source_urls", "models"}
                },
                "website_verified": bool(item.get("website_evidence")),
                "collection_status": item.get("collection_status", "Unknown"),
                # What each of their pages is for, in the words of the model
                # that read it, so the advice can be written from what both
                # sites actually publish rather than from which keywords
                # happened to appear in a link.
                "their_pages": [
                    {
                        "what_it_is_for": page.get("what_it_is_for"),
                        "cite_as": id_by_url.get(canonical_url(page.get("url"))),
                    }
                    for page in (item.get("site_pages") or [])[:20]
                ],
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
            # The page is re-read to give the reader a better extract, not to
            # second-guess the choice. Deciding whether a page proved a point
            # by hunting for the word "pricing" threw away real citations - a
            # page headed "how much it costs" failed - and waved through any
            # page carrying the word. The writer chose this page from a list it
            # could read; that judgement stands.
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


# "ev-004" and "loss-001" are how the model is asked to point at a piece of
# evidence or a lost question. They are addressing labels for the machine, and
# a live report printed them inside the sentence the customer reads: "suitable
# for industrial sites (ev-004, ev-005, ev-006)". Asking the prompt not to do
# it is the kind of rule that does not stick; removing them afterwards does.
INTERNAL_ID = r"(?:ev|loss)-\d+"
# A bracketed run of nothing but ids goes whole, brackets included. Taking the
# ids out first left the closing bracket stranded: "...low inference latency )."
BRACKETED_IDS = re.compile(
    rf"\s*[(\[]\s*{INTERNAL_ID}(?:\s*(?:,|and|&)\s*{INTERNAL_ID})*\s*[)\]]",
    re.IGNORECASE,
)
LOOSE_IDS = re.compile(
    rf"\b{INTERNAL_ID}(?:\s*(?:,|and|&)\s*{INTERNAL_ID})*", re.IGNORECASE
)


def strip_internal_references(value: Any) -> str:
    text = str(value or "")
    if not text:
        return text
    cleaned = BRACKETED_IDS.sub("", text)
    cleaned = LOOSE_IDS.sub("", cleaned)
    cleaned = re.sub(r"[(\[]\s*[)\]]", "", cleaned)
    # A conjunction that was joining two ids has nothing left to join.
    cleaned = re.sub(r"\s*\b(?:and|&)\s*([.;:,])", r"\1", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s+([.,;:!?])", r"\1", cleaned)
    cleaned = re.sub(r"([.,;:])\s*\1+", r"\1", cleaned)
    cleaned = re.sub(r"\s{2,}", " ", cleaned)
    return cleaned.strip(" ,;:")


def normalize_recommendation(item: Any) -> dict[str, Any]:
    if not isinstance(item, dict):
        return {
            "observation": strip_internal_references(item),
            "evidence": "Unknown",
            "suggested_change": "Unknown",
            "expected_impact": "Unknown",
            "confidence": "Low",
            "evidence_types": [],
            "evidence_refs": [],
            "affected_loss_refs": [],
        }
    return {
        "observation": strip_internal_references(item.get("observation", "Unknown")),
        "evidence": strip_internal_references(item.get("evidence", "Unknown")),
        "suggested_change": strip_internal_references(
            item.get("suggested_change", "Unknown")
        ),
        "expected_impact": strip_internal_references(
            item.get("expected_impact", "Unknown")
        ),
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
    question_rows: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Turn the question ids the model chose into the real lost questions.

    Mirrors resolve_recommendation_evidence: the model may only reference
    questions that were actually supplied, and anything else is dropped.

    The writer sees one set of question ids - q-07 - and cites those. It used
    to be handed a second set, loss-002, for the same questions, which is one
    more thing to keep straight and one more way to be wrong. Both are accepted
    here so an id from either scheme still resolves.
    """
    by_id = {
        str(loss.get("loss_id")): loss
        for loss in prompt_losses
        if loss.get("loss_id")
    }
    by_question = {
        str(loss.get("prompt", "")).strip(): loss
        for loss in prompt_losses
        if loss.get("prompt")
    }
    for row in question_rows or []:
        loss = by_question.get(str(row.get("question", "")).strip())
        if loss is not None:
            by_id[str(row.get("question_id"))] = loss
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
                    # Carried through so the report can say why the question
                    # was lost, in the assistant's own words, without a second
                    # call to ask.
                    "winners": loss.get("winners", [])[:3],
                }
            )
        resolved.append({**recommendation, "affected_prompts": accepted})
    return resolved


WRITTEN_URL = re.compile(r"https?://[^\s)\]<>\"']+", re.IGNORECASE)


def drop_addresses_we_never_read(text: Any, known: set[str]) -> str:
    """Remove any web address in the written advice that we did not fetch.

    Links reach the reader through the citation list, where every address comes
    from a page this audit actually read. An address typed into a sentence has
    no such backing - the model can write one from memory - and a link that
    goes nowhere costs the reader their trust in everything around it.
    """
    written = str(text or "")
    if "http" not in written:
        return written
    kept = WRITTEN_URL.sub(
        lambda match: match.group(0)
        if canonical_url(match.group(0).rstrip(".,;:")) in known
        else "",
        written,
    )
    kept = re.sub(r"[(\[]\s*[)\]]", "", kept)
    kept = re.sub(r"\s+([.,;:!?])", r"", kept)
    return re.sub(r"\s{2,}", " ", kept).strip(" ,;:")


def resolve_recommendation_evidence(
    recommendations: list[dict[str, Any]],
    evidence_catalog: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    by_id = {
        str(row.get("evidence_id")): row
        for row in evidence_catalog
        if row.get("evidence_id")
    }
    known_urls = {
        canonical_url(row.get("url"))
        for row in evidence_catalog
        if row.get("url")
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
                **{
                    field: drop_addresses_we_never_read(
                        recommendation.get(field), known_urls
                    )
                    for field in (
                        "observation",
                        "evidence",
                        "suggested_change",
                        "expected_impact",
                    )
                },
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


def winning_company_names(affected_prompts: list[dict[str, Any]]) -> set[str]:
    """Who actually took a question, not merely who was listed in it.

    When the audited company is absent from an answer, every name in that
    answer is technically ahead of it — including the one placed fifth. Reading
    it that way let AtomVision keep its citation under a question it came fifth
    in. `winners` carries the top placements, so use those and fall back to the
    full list only for older runs that predate the field.
    """
    names: set[str] = set()
    for loss in affected_prompts:
        winners = loss.get("winners") or []
        if winners:
            # Evidence cards are labelled with the group name, so compare group
            # names. Matching the assistant's own spelling against a merged
            # card label threw away proof from companies that genuinely won:
            # a card reading "Otter.ai" never equals an answer's "Otter Voice
            # Notes", and the finding lost its citation to a bystander check.
            names.update(
                normalize_name(winner.get("grouped_name") or winner.get("company_name"))
                for winner in winners
                if winner.get("grouped_name") or winner.get("company_name")
            )
        else:
            names.update(
                normalize_name(name)
                for name in loss.get("recommended_instead", [])
                if name
            )
    names.discard("")
    return names


def keep_evidence_from_the_companies_that_won(
    recommendations: list[dict[str, Any]],
    audited_company: str | None = None,
) -> list[dict[str, Any]]:
    """A finding may only cite the companies that took the question it names.

    The three blocks on the improvements page were arriving unrelated to each
    other. A live free audit told kenesis.ai it had lost a question to Triya,
    Visionify and Witvix, and then offered a page from AtomVision as the
    supporting evidence — a company that placed fifth in that same question. It
    was the only competitor whose website had been read, so it was the only
    thing available to cite, and the model cited it.

    Reading the right website is the first half of the fix and happens earlier.
    This is the second half: if a page does not belong to a company that beat
    the audited company in the cited question, it is not evidence for this
    finding, and citing nothing is more honest than citing a bystander.

    The audited company is exempt. Its own pages are never offered as proof
    that somebody won - they are the page the advice asks them to change, and
    the reader needs to be able to open it. Left in the filter, every finding
    about their own site came out with nothing to click, which is how it
    behaved on a live run.
    """
    own = normalize_name(audited_company) if audited_company else ""
    cleaned = []
    for recommendation in recommendations:
        winners = winning_company_names(recommendation.get("affected_prompts", []))
        if own:
            winners = winners | {own}
        supporting = recommendation.get("supporting_evidence", [])
        # With no question attached there is nothing to check against, so the
        # citation stands on the model's own judgement as before.
        if not winners or not supporting:
            cleaned.append(recommendation)
            continue

        kept = [
            row
            for row in supporting
            if normalize_name(row.get("company_name")) in winners
        ]
        dropped = [
            {
                "evidence_id": row.get("evidence_id"),
                "company_name": row.get("company_name"),
                "reason": "company_did_not_win_the_cited_question",
            }
            for row in supporting
            if normalize_name(row.get("company_name")) not in winners
        ]
        if not dropped:
            cleaned.append(recommendation)
            continue

        validation = dict(recommendation.get("evidence_validation", {}))
        validation["accepted_refs"] = [row.get("evidence_id") for row in kept]
        validation["rejected_refs"] = [
            *validation.get("rejected_refs", []),
            *dropped,
        ]
        cleaned.append(
            {
                **recommendation,
                "supporting_evidence": kept,
                "evidence_types": normalize_evidence_types(
                    [row.get("evidence_type") for row in kept]
                ),
                "evidence_validation": validation,
            }
        )
    return cleaned


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
    """The same cleaning the competitor panels get.

    This path skipped it, which is why the report quoted three competitor
    pages that each began "Skip to main content" and one that began "##".
    """
    if not page:
        return ""
    text = readable_excerpt(page.get("main_text"), max_length=100_000)
    title = " ".join(str(page.get("title", "")).split())
    if title and text.lower().startswith(title.lower()):
        text = text[len(title) :].lstrip(" :-|")
    return concise_text(text, max_length)


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


# Reading pages is cheap and the writer only opens what it needs, but a loop
# with no end is a loop that can bill forever. Past this the tools are taken
# away and it answers with what it has read.
MAX_OPENS = 12
MAX_OPEN_TURNS = 8


def answer_with_open_tools(
    payload: dict[str, Any],
    pages: dict[str, dict[str, Any]],
    question_rows: list[dict[str, Any]],
    raw_results: list[dict[str, Any]],
    labels: dict[str, str],
) -> tuple[str, list[str]]:
    """Let the writer read what it needs, then return its text.

    Sending a fixed slice of every page meant choosing, in advance and without
    knowing the argument being made, which seven hundred characters mattered.
    The writer knows; it asks.
    """
    if "tools" not in payload:
        return call_chat_completion(payload), []
    hidden_names = assistant_and_model_names(raw_results)
    messages = payload["messages"]
    opened: list[str] = []
    for _turn in range(MAX_OPEN_TURNS):
        message = call_chat_message(payload)
        calls = message.get("tool_calls") or []
        if not calls:
            return str(message.get("content") or ""), opened
        messages.append(
            {
                "role": "assistant",
                "content": message.get("content"),
                "tool_calls": calls,
            }
        )
        for call in calls:
            function = call.get("function") or {}
            name = str(function.get("name", ""))
            try:
                arguments = json.loads(function.get("arguments") or "{}")
            except (TypeError, ValueError):
                arguments = {}
            if name == "open_page":
                wanted = str(arguments.get("page_id", ""))
                how = str(arguments.get("how", "text"))
                part = arguments.get("part", 1)
                result = open_page(wanted, pages, how, part)
                opened.append(f"page {wanted} ({how} part {result.get('part', 1)})")
            elif name == "open_question":
                wanted = str(arguments.get("question_id", ""))
                result = open_question(
                    wanted, question_rows, raw_results, labels, hidden_names
                )
                opened.append(f"question {wanted}")
            else:
                result = {"error": f"There is no tool called {name}."}
            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": call.get("id"),
                    "content": json.dumps(result, ensure_ascii=False),
                }
            )
        if len(opened) >= MAX_OPENS:
            payload.pop("tools", None)
            break
    return str(call_chat_message(payload).get("content") or ""), opened


def hide_assistant_names(
    recommendation: dict[str, Any],
    names: set[str],
) -> dict[str, Any]:
    """No AI assistant or model is named in anything a customer reads.

    Naming one turns an audit of what buyers are told into an audit of one
    vendor's model, and invites advice about pleasing that vendor. The prompt
    asks for this; this makes it so.
    """
    return {
        **recommendation,
        **{
            field: strip_assistant_names(recommendation.get(field), names)
            for field in (
                "observation",
                "evidence",
                "suggested_change",
                "expected_impact",
            )
        },
    }


def add_missing_pages_to_the_catalog(
    catalog: list[dict[str, Any]],
    pages: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    """Anything the writer can see, it can cite.

    The catalog held competitors' pages only, so when the advice was about the
    audited company's own features page - which is what most advice is about -
    the citation was rejected and the reader got a recommendation with nothing
    to click. Three of three recommendations came back linkless on a live run
    for exactly this reason.
    """
    known = {str(row.get("evidence_id")) for row in catalog}
    topped_up = list(catalog)
    for page_id, page in pages.items():
        if page_id in known:
            continue
        topped_up.append(
            {
                "evidence_id": page_id,
                "company_name": page.get("company_name", ""),
                "evidence_type": "site_page",
                "label": "Page on the website",
                "title": concise_text(
                    page.get("title") or page_name_from_url(page.get("url", "")), 100
                ),
                "url": page.get("url", ""),
                "excerpt": concise_text(page.get("text", ""), 220),
                "provenance": "audit_page_index",
            }
        )
    return topped_up
