from __future__ import annotations

import json
import os
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse

from .crawler import fetch_html, parse_page
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
    call_bedrock_tool_message,
    call_chat_completion,
    call_chat_message,
)
from .report_context import (
    OPEN_COMPANY_SOURCES_TOOL,
    OPEN_PAGE_TOOL,
    OPEN_QUESTION_TOOL,
    SAVE_FINDING_TOOL,
    anonymous_assistant_labels,
    assistant_and_model_names,
    build_headline_numbers,
    build_company_blocks,
    build_question_rows,
    open_company_sources,
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
            "competitor_evidence_reason": (
                "The free preview does not verify a competitor page."
            ),
            "audited_company_evidence_reason": (
                "The free preview does not select an audited-company evidence page."
            ),
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
what to improve in their website content and wider public web presence. We
asked several assistants the same buyer questions and recorded every company
each one named. Your job is to turn that into a short list of changes that make
the company easier for buyers and AI systems to understand and trust. The main
priority is broad investigation, proof from both sides and a clear action: read
different failed questions across the audit, understand the relevant pages of
the audited company and the competitors that won, and only then give actions in
plain words with links that let the user verify every comparison.

NON-NEGOTIABLE METHOD

Work in two phases. During the tool phase you are the research reader, not the
final recommendation writer. Read questions and pages in small batches. After
each page batch, immediately call save_evidence_analysis and add detailed notes
to the evidence map. Each note must preserve the grouped question IDs, both page
IDs, what each page says, why the competitor won, what appears weaker or unclear
for the audited company, and a possible action direction. Do not rely on memory
across page batches; put the useful reasoning in the map. When five strong and
different analysis entries are stored, stop researching. A separate AI call
will receive only this evidence map and turn it into the final recommendations.

The goal is not general advice or product development. Every recommendation
must improve either the audited company's own website or its legitimate public
presence on other websites. It may improve, create, reorganise or better connect
pages and proof on the audited website, or help the company earn accurate,
useful independent coverage and mentions elsewhere. Never recommend building a
new product capability or changing how the product works. Communicate and make
discoverable what the company can genuinely support today.

Each recommendation must explain a real loss: what a winning competitor proves
on an opened page, what the audited company's relevant opened evidence shows is
missing, weaker or hard to discover, and the precise website or public-presence
change that closes that difference for the buyer question. Cite the pages used
and briefly explain why you selected each one. When several questions reveal
the same gap, combine them into one recommendation and use another proven gap
for another recommendation. Do not understand the audit from only a few similar
questions. Spread the investigation across different buyer needs and read enough
relevant pages from both sides to understand each area before saving the five
analysis entries.

WHAT KIND OF DATA YOU HAVE

about_this_audit - how many questions were asked, how many assistants answered,
how often the audited company was named.

the_company - what they sell, who buys it, what they claim.

every_question_we_asked - each buyer question, how many times the audited
company was recommended in the answers to it, and which other companies were
recommended and how often.

companies_with_sources - the audited company and the five top competitors for
which this audit holds source inventories. Questions may name other companies,
but no pages are available for them. A question is eligible for investigation
only when at least one company marked top_competitor in companies_with_sources
was named in that question. Ignore a lost question when all of its winners are
outside that top-five list. Never build a finding around an unlisted company.
Call open_company_sources with the exact names of the relevant companies when
they matter to an eligible lost question. It returns the official website and three groups:
pages on its own website, pages assistants cited while answering, and pages the
wider internet holds about it. Links are deliberately not pasted here because
you should request and inspect only the companies relevant to the questions you
choose.

The address and title beside each page are an index for choosing what to open,
not proof of what the page says. An address, including its domain and path, is
usually a stronger identity signal than a title. A title is only an additional
clue and may be incomplete or wrong. The opened page content decides what you
may claim and how you describe that page to the reader.

Assistant-cited pages show what sources influenced an answer, while wider-
internet pages provide additional public context. Use both only when they help
explain a specific lost question. Do not infer a website gap from the number of
pages in either list; open the relevant content and compare it first.

YOUR TOOLS

open_company_sources(company_names) - the complete link inventories for the
available companies you select. Request the audited company and the relevant
top-five competitor before opening their pages. A company named in a question
but absent from companies_with_sources has no citable source inventory; choose
another winning company or question.

open_questions(question_ids) - every assistant's full answers to up to six questions,
including the reason each gave for every company it named. When an answer cited
a source that exists in the page inventory, assistant_cited_page_ids gives its
page_id beside that company. An empty list means that answer supplied no mapped
source. Treat these ids as the best pages to try first, but open each page and
verify its content before using it as proof.

open_pages(pages) - open up to eight selected pages together. Each request has
page_id, part (use 1 first), and how (normally "text"). A result gives the first
6,000 characters, which is usually the whole of what matters. If you need more,
ask for the next part; the answer
tells you how many parts there are.

  {"page_id":"p-014","part":1,"how":"text"}
  {"page_id":"p-014","part":2,"how":"text"} only if part 1 left you short

For a page under what the wider internet holds, you may ask for the parts that
name that company instead of the page:

  {"page_id":"p-072","part":1,"how":"passages"}

save_evidence_analysis(findings) - after every page-reading batch, write detailed
analysis into the persistent evidence map. For each entry, summarise what the
competitor page says, what the audited-company page says, which question or
grouped questions they explain, why the competitor won, and what appears weaker
or unclear for the audited company. Always include both page IDs. Do not rush to
final wording here. These are detailed reasoning notes for the later writer.
The tool returns the full evidence map so earlier page analysis stays visible.
Once five strong, different entries exist, a separate final AI call reads this
map and creates the findings and recommendations.

Question, source-inventory and page budgets are tracked separately. When the audit contains enough losses, investigate at
least six distinct lost questions covering different buyer needs before
finalising the five actions. Open questions together for speed, then use the
remaining opens on the strongest competitor and audited-company pages needed to
prove each distinct gap. Do not write all five from one or two subject areas.
Once several questions clearly share the same gap, combine them and move to a
different area. Do not request the same company inventory, question or page
part twice: the conversation and notebook retain it. Do not spend extra parts
on one long page unless truly needed. Open every page before saying what is on
it. Save the detailed analysis immediately after each page-reading batch instead
of trying to remember several comparisons until the end.

HOW TO DECIDE WHAT TO WRITE

Start with the questions the audited company was never recommended in. Those are
what it is losing. Keep only questions won by at least one listed top-five
competitor. For each eligible question, look at which listed competitor took it,
then at what that company publishes and what is written about them elsewhere.

Open the strongest lost questions and read why the winning companies were
recommended. Sample the audit broadly instead of stopping after the first few
losses. When available, inspect at least six failed questions from different
buyer needs. You may open several questions or pages together for speed, but do
not decide the actions yet. First read the returned page content, group questions
that reveal the same underlying website gap, and compare the most relevant
competitor page with the most relevant audited-company page for each distinct
gap. Only then turn a proven difference into one recommendation. Do not decide
an action first and then search for pages that appear to support it.

STRICT UNIQUENESS RULE: all five recommendations must address meaningfully
different reasons for losing. No two may cover the same underlying gap, buyer
need, subject area, website area, content, proof or action.
Changing the wording does not make a repeated idea
unique. If several failed questions have the same
underlying reason, group them into one recommendation. Then investigate
different failed questions for the remaining recommendations.

Do not open every listed page. First shortlist pages using the company, page
address, address path and title. Then open the small set most likely to answer
the lost question. Read the actual content of the relevant rival's official
pages before deciding why it won. Read the audited company's relevant official
pages before deciding what it lacks or should change. Also open an
assistant-cited or wider-internet page when its address and title indicate that
it may provide stronger or independent evidence. Prefer the source whose opened
content most directly supports the recommendation, regardless of which list it
came from.

Never make a claim from an address or title alone. If opened content is empty,
conflicts with the company identity, or does not support the topic, do not use
that page. If an opened page is not useful for the buyer question, discard it
and open the next likely page. If no available competitor and audited-company
pages prove a meaningful difference, skip that question and investigate another
one. If the title conflicts with the address and content, ignore the title.
Describe cited pages in clear words based on their content instead of repeating
an unreliable title.

A gap is a communication or public-evidence job a rival's pages do for a buyer
that the audited company's web presence does not. Before choosing the action,
review the audited company's page inventory for every page whose address, title
or description may cover that topic, and open the most relevant candidates. If
an existing page already does the job, skip that gap. If the page exists but its
content is weaker, update or expand that page. If the content exists but its
name, location or connections make it difficult to find, rename, reposition or
link to it more clearly. Create a
new page only after checking that no existing page serves the same purpose.
Where the proven gap is weak independent
visibility, recommend an honest way to publish useful proof or earn relevant
third-party coverage; do not invent endorsements or tell the company to edit a
website it does not own. Never recommend creating a page merely because you
opened a broad page instead of the topic-specific page.

WHAT EACH RECOMMENDATION MUST BE

One proven website-content or public-presence gap, the lost question or
questions caused by it, the company that took them, and the change that answers
them. The questions, the reason that company won, and the pages you cite must
all be about the same thing. The suggested change must be an action involving
web content, website structure, published proof, or legitimate external
visibility. It must not ask the company to create or alter a product feature.
State the action so an ordinary user immediately understands what to do: name
the existing page or public material to update, create, rename, reposition or
connect; say what specific information or proof should change; and explain why
the opened comparison justifies it. Avoid vague actions such as merely saying
to improve, enhance or strengthen something.

HIGHEST-PRIORITY EVIDENCE RULE: this rule is more important than polished
writing, variety or filling five slots. A recommendation without both links is not a recommendation.
Do not return it. Write a recommendation only after reading the actual content
of both sides of its comparison. For every recommendation,
compare the actual opened content from the relevant competitor website with the
actual opened content from the audited company's website.
Do not ask the user to take an action without two verifiable page links.
Every recommendation must include at least one opened competitor page and at
least one opened audited-company page in evidence_refs. Both pages must directly
support the same buyer question, gap and recommended action. The competitor
page must belong to a company that actually won the affected question and its
opened text must clearly show the evidence that helped it win. A parent-company
page is valid only when its opened text is specifically about the winning
product. Navigation labels, page titles, URLs and an assistant's answer are not
substitutes for supporting page content. Read another part or another page when
needed. The audited-company page must be the relevant own-site page whose
opened text shows what is weaker, unclear or hard to discover and where the
improvement belongs.

These citations are part of the result, not decoration. They let the user open
both pages, verify the comparison and understand the problem. Put the page_id of
every page used for a claim in evidence_refs, using no more than the three
strongest pages. The action should be the conclusion of what those two opened
pages prove, not an idea followed by unrelated links. Confidence means being
confident in the complete chain: why the competitor won, what is weaker on the
audited website, and why the proposed action closes that exact difference.
Prefer a smaller, precise action with strong evidence over a more impressive
action based on assumptions. Never describe evidence from a page without citing
it. Never add a broad or weakly related link merely to complete the pair. A
recommendation that
describes what competitors do but cites only the audited company's pages is
unfinished. If you cannot find and open a valid page from
both sides for a proposed finding, do not write that recommendation. Investigate
a different failed question instead. When you cannot confidently provide both links, discard that action.

Write exactly five distinct, evidence-backed recommendations. As a final check,
compare all five with each other: no two may recommend substantially the same
page, content, proof, or action, even when they came from different questions.
Do not split one change into several recommendations or add unsupported advice
to reach five.
Use a different primary lost question for each recommendation whenever five or
more lost questions exist. When several questions were lost because of the same
proven gap, combine them into one recommendation and include their question_id
values in affected_loss_refs. Then investigate other questions for the remaining
recommendations instead of repeating that gap.

Every page_id in evidence_refs must be a page you opened with open_pages during
this run. A page merely listed in the input is not a citation you have read.
Never cite an unopened page. Before claiming that the audited company's website
lacks or should change something, open its most relevant page. If a valid
competitor and audited-company evidence pair is unavailable, investigate a
different question rather than returning an unsupported recommendation.

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

Some assistants cannot browse the web or provide citations. Do not treat an
empty assistant-cited page list alone as evidence that the company lacks online
visibility.

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
evidence_types, evidence_refs, competitor_evidence_reason,
audited_company_evidence_reason, affected_loss_refs.

competitor_evidence_reason is one short sentence explaining why the selected
competitor page proves what helped that competitor win. The
audited_company_evidence_reason is one short sentence explaining why the
selected audited-company page proves the corresponding weakness or gap. These
reasons must describe the actual opened content, not the address or title.

Before returning, compare all five recommendations with each other again. No
two may cover the same underlying gap, buyer need, subject area, website area,
content, proof or action.
Changing the wording does not make a repeated idea
unique. If several failed questions have the same
underlying reason, group them into one recommendation. Then investigate
different failed questions for the remaining recommendations.

Every competitor
capability you describe must be supported by an opened competitor page included
in that recommendation's evidence_refs. Every gap you claim must be checked
against the audited company's most relevant opened page, not one broad page
reused without checking the topic-specific pages. Attach the relevant
question_id values to each grouped finding. Confirm that each action
changes website content, website structure, published proof or legitimate
external visibility; reject any action that builds or changes the product.
Confirm that website actions correctly say create, update, rename, reposition
or improve linking based on what already exists. If any check fails, use the
remaining tool calls to read a better page or question before answering.

Repeat the highest-priority evidence check for each final recommendation.
A recommendation without both links is not a recommendation.
Do not return it. Inspect every proposed action one by one before answering.
Do not ask the user to take an action without two verifiable page links.
Every recommendation must include at least one opened competitor page and at
least one opened audited-company page in evidence_refs. Confirm that both pages
support the same buyer question, gap and action, and that every page used for a
claim is cited. Confirm that the recommended action follows directly from the
content of those pages rather than from an assumption. The user must be able to
open both sides, verify why the competitor won, see what is weaker on the
audited website and understand why the action is justified. Do not accept an
irrelevant, generic or weak link merely because two citations are required.
When you cannot confidently provide both links, discard that action. Use the
remaining tool calls to find a different failed question and action with a
strong, relevant evidence pair. The requirement to return five recommendations
never permits lowering this evidence standard or padding the result with an
unsupported action.

Finally confirm that the main job was completed: the investigation covered
different buyer needs across the audit rather than a narrow group of similar
questions; each action came after reading relevant pages from both sides; every
action includes both verifiable links; and the action is written in plain,
specific words that tell the user exactly what website content or public
presence to change and why.

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
            "minItems": 5,
            "maxItems": 5,
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
                    "competitor_evidence_reason": {"type": "string"},
                    "audited_company_evidence_reason": {"type": "string"},
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
                    "competitor_evidence_reason",
                    "audited_company_evidence_reason",
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
    web_presence: dict[str, Any] | None = None,
) -> tuple[list[dict[str, Any]] | None, dict[str, Any], str | None]:
    """limit keeps only the top N written actions. The model returns five
    schema-enforced actions; a caller may keep fewer. The deterministic
    top-competitor finding is kept only as a fallback when the model returns
    nothing at all."""
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
        answers, user_snapshot=user_snapshot, web_presence=web_presence,
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
        payload["tools"] = [
            OPEN_QUESTION_TOOL,
            OPEN_COMPANY_SOURCES_TOOL,
            OPEN_PAGE_TOOL,
            SAVE_FINDING_TOOL,
        ]
    try:
        raw_response, opened = answer_with_open_tools(
            payload,
            pages,
            blocks,
            question_rows,
            answers,
            labels,
            audited_company=company_name,
            firecrawl_client=firecrawl_client,
        )
    except LLMNotConfigured as exc:
        return None, payload, str(exc)
    payload["opened"] = opened
    payload["writer_raw_response"] = raw_response
    # Debug/export metadata is attached only after every API call has finished,
    # so it is never sent as an unsupported API request field.
    payload["_writer_company_blocks"] = blocks

    if raw_response.lstrip().startswith("["):
        parsed = extract_json_array(raw_response)
        summary = ""
    else:
        response = extract_json_object(raw_response)
        parsed = response.get("recommendations", [])
        summary = strip_internal_references(
            concise_text(response.get("summary"), AUDIT_SUMMARY_LENGTH)
        )
    notebook_enforced = "finding_notebook" in payload
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
    opened_page_ids = {
        match.group(1)
        for item in opened
        if (match := re.match(r"^page\s+(\S+)", item))
    }
    for recommendation in normalized:
        recommendation["evidence_refs"] = [
            evidence_id
            for evidence_id in recommendation.get("evidence_refs", [])
            if evidence_id in opened_page_ids
        ]
    if limit:
        normalized = normalized[:limit]
    if normalized:
        with_top_finding = normalized[: limit or 5]
    elif notebook_enforced:
        # Never manufacture a deterministic fallback after the notebook agent
        # explicitly failed to prove five evidence pairs.
        with_top_finding = []
    else:
        with_top_finding = ensure_top_competitor_finding(
            normalized,
            recommendation_patterns,
            competitor_evidence,
            evidence_catalog=evidence_catalog,
            company_name=str(company_profile.get("company_name", "")),
            prompt_losses=prompt_losses,
        )[: limit or 5]
    resolved = resolve_recommendation_evidence(
        with_top_finding, evidence_catalog
    )
    resolved = resolve_affected_prompts(resolved, prompt_losses, question_rows)
    resolved = keep_evidence_from_the_companies_that_won(resolved, company_name)
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
        # Only names travel up front. The writer requests one company's links
        # through open_company_sources when a chosen question needs them.
        "companies_with_sources": [
            {
                "company_name": name,
                "relationship": (
                    "audited_company" if name == company_name else "top_competitor"
                ),
            }
            for name in (company_blocks or {})
        ],
        "source_scope_note": (
            "Only these companies have stored source inventories. Companies "
            "named in questions but absent here cannot be cited."
        ),
    }
    payload = build_chat_payload(
        AUDIT_RECOMMENDATION_SYSTEM_PROMPT,
        json.dumps(data, separators=(",", ":"), ensure_ascii=False),
        temperature=0.2,
        json_response=True,
    )
    # The writer has to plan, use several tools, compare evidence and maintain
    # five distinct findings. Keep cheaper models for the high-volume audit
    # calls, but use a stronger dedicated default for this one final call.
    writer_provider = os.environ.get("AUDIT_WRITER_PROVIDER", "openai")
    if writer_provider == "bedrock_claude":
        payload["model"] = (
            os.environ.get("AUDIT_WRITER_BEDROCK_MODEL")
            or "us.anthropic.claude-haiku-4-5-20251001-v1:0"
        )
    else:
        payload["model"] = (
            os.environ.get("AUDIT_WRITER_MODEL")
            or os.environ.get("LLM_MODEL")
            or "gpt-5-mini"
        )
    if str(payload["model"]).startswith("gpt-5"):
        payload.pop("temperature", None)
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
    client: FirecrawlClient | None,
) -> list[dict[str, Any]]:
    """Improve selected evidence with a normal fetch, then Firecrawl fallback."""
    max_pages = max(0, environment_int("FIRECRAWL_MAX_FINAL_EVIDENCE_PAGES", 6))
    cache: dict[str, tuple[dict[str, Any] | None, str | None]] = {}
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
            if key not in cache and attempts < max_pages:
                attempts += 1
                try:
                    html, status_code, final_url = fetch_html(url)
                    standard_page = parse_page(final_url, html, status_code)
                    if meaningful_text(standard_page.get("main_text")):
                        standard_page["fetch_provider"] = "deterministic_crawler"
                        standard_page["fetched_at"] = datetime.now(
                            timezone.utc
                        ).isoformat()
                        cache[key] = (standard_page, "deterministic_crawler")
                    else:
                        cache[key] = (None, None)
                except Exception:  # noqa: BLE001 - Firecrawl is the recovery path.
                    cache[key] = (None, None)

                if cache[key][0] is None and client is not None and client.can_request():
                    try:
                        document = client.scrape(url)
                        cache[key] = (
                            firecrawl_document_to_page(document, url),
                            "firecrawl",
                        )
                    except FirecrawlError:
                        pass

            page, provider = cache.get(key, (None, None))
            if not page:
                verified_rows.append(row)
                continue
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
                    "provenance": (
                        "firecrawl_verified"
                        if provider == "firecrawl"
                        else "standard_crawler_verified"
                    ),
                    "verification": {
                        "provider": provider,
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
INTERNAL_ID = r"(?:ev|loss|p|q)-\d+"
# A bracketed note containing an internal id goes whole, brackets included.
# Writers sometimes add text such as "(q-09 answers)" around the id; leaving
# that note behind exposes implementation labels to the customer.
BRACKETED_IDS = re.compile(
    rf"\s*[(\[][^(\[)\]]*\b{INTERNAL_ID}\b[^(\[)\]]*[)\]]",
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
            "competitor_evidence_reason": "Unknown",
            "audited_company_evidence_reason": "Unknown",
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
        "competitor_evidence_reason": strip_internal_references(
            item.get("competitor_evidence_reason", "Unknown")
        ),
        "audited_company_evidence_reason": strip_internal_references(
            item.get("audited_company_evidence_reason", "Unknown")
        ),
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
                        "competitor_evidence_reason",
                        "audited_company_evidence_reason",
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
        "competitor_evidence_reason": (
            "These selected competitor pages provide the available evidence "
            "for the most frequently recommended alternative."
        ),
        "audited_company_evidence_reason": (
            "No audited-company page was selected because this is a fallback finding."
        ),
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


# One agent, with separate bounded budgets. A source-list request is cheap and
# should not compete with reading the evidence itself. Repeated requests are
# served from the conversation cache and consume no additional budget.
MAX_QUESTION_OPENS = 10
MAX_SOURCE_LOOKUPS = 8
MAX_PAGE_OPENS = 24
MAX_OPEN_TURNS = 16
REQUIRED_FINDINGS = 5
MAX_REJECTED_FINDINGS = 6
WRITER_PAGE_FETCH_TIMEOUT_SECONDS = 30
WRITER_PAGE_FETCH_STEP_TIMEOUT_SECONDS = WRITER_PAGE_FETCH_TIMEOUT_SECONDS // 2


def normalized_passage(value: Any) -> str:
    return " ".join(str(value or "").casefold().split())


def passage_is_on_page(passage: Any, page: dict[str, Any]) -> bool:
    """Accept exact extracts and careful combinations of nearby page lines.

    Models commonly remove list markers or join two adjacent list items. That
    should not invalidate good evidence. We still require most meaningful words
    and a continuous phrase to be present on the selected page.
    """
    written = normalized_passage(passage)
    words = written.split()
    if len(words) < 6 or len(words) > 120:
        return False
    held = "\n".join(
        [str(page.get("text") or ""), *[str(row) for row in page.get("passages", [])]]
    )
    page_text = normalized_passage(held)
    if written in page_text:
        return True

    token_pattern = re.compile(r"[a-z0-9]+")
    candidate_tokens = token_pattern.findall(written)
    page_tokens = token_pattern.findall(page_text)
    if len(candidate_tokens) < 6 or len(page_tokens) < 6:
        return False
    page_token_set = set(page_tokens)
    stop_words = {
        "a", "an", "and", "are", "as", "at", "be", "by", "for", "from",
        "in", "is", "it", "of", "on", "or", "that", "the", "their", "this",
        "to", "with", "you", "your",
    }
    meaningful = [token for token in candidate_tokens if token not in stop_words]
    if not meaningful:
        return False
    coverage = sum(token in page_token_set for token in meaningful) / len(meaningful)
    continuous = any(
        candidate_tokens[index : index + 5]
        == page_tokens[offset : offset + 5]
        for index in range(max(1, len(candidate_tokens) - 4))
        for offset in range(max(1, len(page_tokens) - 4))
    )
    return coverage >= 0.8 and continuous


def finding_text_similarity(left: Any, right: Any) -> float:
    ignored = {
        "a", "an", "and", "are", "as", "at", "be", "by", "for", "from",
        "in", "is", "it", "of", "on", "or", "that", "the", "their", "this",
        "to", "with", "you", "your", "website", "page", "linear",
    }
    tokens = lambda value: {
        token
        for token in re.findall(r"[a-z0-9]+", normalized_passage(value))
        if token not in ignored
    }
    a, b = tokens(left), tokens(right)
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def names_match(left: Any, right: Any) -> bool:
    a, b = normalize_name(left), normalize_name(right)
    return bool(a and b and (a == b or a in b or b in a))


def validate_and_save_finding(
    arguments: dict[str, Any],
    *,
    pages: dict[str, dict[str, Any]],
    question_rows: list[dict[str, Any]],
    company_blocks: dict[str, dict[str, Any]],
    audited_company: str,
    opened_page_ids: set[str],
    opened_question_ids: set[str],
    findings: list[dict[str, Any]],
) -> dict[str, Any]:
    """Validate one evidence pair and add it to the agent's compact notebook."""
    if len(findings) >= REQUIRED_FINDINGS:
        return {
            "accepted": False,
            "errors": ["The notebook already has five findings. Write the final answer."],
            "notebook": compact_finding_notebook(findings),
        }

    errors: list[str] = []
    primary = str(arguments.get("primary_question_id", "")).strip()
    row = next(
        (item for item in question_rows if item.get("question_id") == primary),
        None,
    )
    if row is None:
        errors.append("primary_question_id is not in this audit")
    elif primary not in opened_question_ids:
        errors.append("open the primary question before saving its finding")

    affected = list(
        dict.fromkeys(
            str(value).strip()
            for value in arguments.get("affected_question_ids", []) or []
            if str(value).strip()
        )
    )[:3]
    if primary and primary not in affected:
        affected.insert(0, primary)
        affected = affected[:3]
    known_question_ids = {str(item.get("question_id")) for item in question_rows}
    if any(question_id not in known_question_ids for question_id in affected):
        errors.append("an affected_question_id is not in this audit")

    competitor_name = str(arguments.get("competitor_company", "")).strip()
    block_name = next(
        (name for name in company_blocks if names_match(name, competitor_name)),
        None,
    )
    if block_name is None or names_match(block_name, audited_company):
        errors.append("competitor_company must be an available top competitor")
    if row is not None and block_name is not None:
        named = [str(item.get("company", "")) for item in row.get("who_was_named", [])]
        if not any(names_match(block_name, name) for name in named):
            errors.append("that competitor was not named in the primary question")

    competitor_id = str(arguments.get("competitor_page_id", "")).strip()
    audited_id = str(arguments.get("audited_page_id", "")).strip()
    competitor_page = pages.get(competitor_id)
    audited_page = pages.get(audited_id)
    if competitor_id not in opened_page_ids:
        errors.append("open the competitor page before saving the finding")
    if audited_id not in opened_page_ids:
        errors.append("open the audited-company page before saving the finding")
    if competitor_page is None:
        errors.append("competitor_page_id is unknown")
    elif block_name is not None and not names_match(
        competitor_page.get("company_name"), block_name
    ):
        errors.append("competitor_page_id belongs to a different company")
    if audited_page is None:
        errors.append("audited_page_id is unknown")
    elif not names_match(audited_page.get("company_name"), audited_company):
        errors.append("audited_page_id does not belong to the audited company")

    action = " ".join(str(arguments.get("suggested_change", "")).split())
    if any(item.get("primary_question_id") == primary for item in findings):
        errors.append("another analysis entry already uses this primary question")
    if errors:
        return {
            "accepted": False,
            "errors": list(dict.fromkeys(errors)),
            "notebook": compact_finding_notebook(findings),
        }

    finding = {
        "finding_id": f"finding-{len(findings) + 1:02d}",
        "primary_question_id": primary,
        "affected_question_ids": affected,
        "competitor_company": block_name or competitor_name,
        "competitor_page_id": competitor_id,
        "competitor_passage": str(arguments.get("competitor_passage", "")).strip(),
        "audited_page_id": audited_id,
        "audited_passage": str(arguments.get("audited_passage", "")).strip(),
        "observation": str(arguments.get("observation", "")).strip(),
        "suggested_change": action,
        "expected_impact": str(arguments.get("expected_impact", "")).strip(),
        "competitor_evidence_reason": str(
            arguments.get("competitor_evidence_reason", "")
        ).strip(),
        "audited_company_evidence_reason": str(
            arguments.get("audited_company_evidence_reason", "")
        ).strip(),
        "confidence": normalize_confidence(arguments.get("confidence")),
    }
    findings.append(finding)
    return {
        "accepted": True,
        "finding_id": finding["finding_id"],
        "findings_saved": len(findings),
        "findings_still_needed": REQUIRED_FINDINGS - len(findings),
        "notebook": compact_finding_notebook(findings),
    }


def compact_finding_notebook(findings: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "finding_id": item.get("finding_id"),
            "primary_question_id": item.get("primary_question_id"),
            "affected_question_ids": item.get("affected_question_ids", []),
            "competitor_company": item.get("competitor_company"),
            "competitor_page_id": item.get("competitor_page_id"),
            "competitor_page_summary": item.get("competitor_passage"),
            "audited_page_id": item.get("audited_page_id"),
            "audited_company_page_summary": item.get("audited_passage"),
            "comparison_reasoning": item.get("observation"),
            "possible_action_direction": item.get("suggested_change"),
            "expected_impact": item.get("expected_impact"),
            "competitor_evidence_reason": item.get("competitor_evidence_reason"),
            "audited_company_evidence_reason": item.get(
                "audited_company_evidence_reason"
            ),
            "confidence": item.get("confidence"),
        }
        for item in findings
    ]


def recommendations_from_findings(
    findings: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """The notebook is the source of truth; final prose cannot add new evidence."""
    return [
        {
            "observation": item.get("observation", ""),
            "evidence": (
                f"{item.get('competitor_evidence_reason', '')} "
                f"{item.get('audited_company_evidence_reason', '')}"
            ).strip(),
            "suggested_change": item.get("suggested_change", ""),
            "expected_impact": item.get("expected_impact", ""),
            "confidence": item.get("confidence", "Low"),
            "evidence_types": [],
            "evidence_refs": [
                item.get("competitor_page_id"),
                item.get("audited_page_id"),
            ],
            "competitor_evidence_reason": item.get(
                "competitor_evidence_reason", ""
            ),
            "audited_company_evidence_reason": item.get(
                "audited_company_evidence_reason", ""
            ),
            "affected_loss_refs": item.get("affected_question_ids", []),
        }
        for item in findings[:REQUIRED_FINDINGS]
    ]


def write_from_evidence_map(
    parent_payload: dict[str, Any], findings: list[dict[str, Any]]
) -> str:
    evidence_map = compact_finding_notebook(findings)
    final_prompt = """You are the final recommendation writer. You receive a detailed
evidence analysis map created by a separate research agent after it read the
questions and pages. Read the whole map before writing. Create exactly five
meaningfully different website or public-presence recommendations. Group related
questions when one gap explains several losses. Every recommendation must use
one competitor page_id and one audited-company page_id from the same analysis
entry. Explain why both pages were chosen. Do not invent facts, page IDs, product
features, or evidence outside the map. Return the required JSON only."""
    final_payload = build_chat_payload(
        final_prompt,
        json.dumps(
            {"evidence_analysis_map": evidence_map},
            separators=(",", ":"),
            ensure_ascii=False,
        ),
        model=str(parent_payload.get("model") or ""),
        temperature=0.2,
        json_response=True,
    )
    final_payload["response_format"] = {
        "type": "json_schema",
        "json_schema": {
            "name": "audit_recommendations",
            "strict": True,
            "schema": AUDIT_RECOMMENDATION_SCHEMA,
        },
    }
    if str(final_payload.get("model", "")).startswith("gpt-5"):
        final_payload.pop("temperature", None)
    parent_payload["final_writer_input"] = {"evidence_analysis_map": evidence_map}
    return str(call_writer_message(final_payload).get("content") or "")


def hydrate_writer_page(
    page: dict[str, Any],
    firecrawl_client: FirecrawlClient | None = None,
) -> dict[str, Any]:
    """Fetch a selected page only when its stored content is missing.

    Assistant-cited pages often arrive as addresses without page text. Fetching
    every cited address before the writer knows which ones matter wastes time.
    This keeps that index light and fills only the pages the writer chooses.
    """
    if meaningful_text(page.get("text")):
        return page

    url = valid_http_url(page.get("url"))
    if not url:
        return page

    fetched: dict[str, Any] | None = None
    try:
        html, status_code, final_url = fetch_html(
            url, timeout=WRITER_PAGE_FETCH_STEP_TIMEOUT_SECONDS
        )
        candidate = parse_page(final_url, html, status_code)
        if meaningful_text(candidate.get("main_text")):
            fetched = candidate
    except Exception:  # noqa: BLE001 - Firecrawl is the recovery path.
        fetched = None

    if fetched is None and firecrawl_client is not None and firecrawl_client.can_request():
        try:
            candidate = firecrawl_document_to_page(
                firecrawl_client.scrape(
                    url, timeout=WRITER_PAGE_FETCH_STEP_TIMEOUT_SECONDS
                ),
                url,
            )
            if meaningful_text(candidate.get("main_text")):
                fetched = candidate
        except FirecrawlError:
            fetched = None

    if fetched is None:
        return page

    page["url"] = fetched.get("url") or page.get("url")
    page["text"] = fetched.get("main_text") or ""
    # Keep the inventory title as a clue, but use the fetched title when the
    # inventory had none. The prompt tells the writer that content outranks it.
    if not str(page.get("title") or "").strip():
        page["title"] = fetched.get("title") or ""
    page["fetch_provider"] = fetched.get("fetch_provider") or "deterministic_crawler"
    return page


def answer_with_open_tools(
    payload: dict[str, Any],
    pages: dict[str, dict[str, Any]],
    company_blocks: dict[str, dict[str, Any]],
    question_rows: list[dict[str, Any]],
    raw_results: list[dict[str, Any]],
    labels: dict[str, str],
    *,
    audited_company: str,
    firecrawl_client: FirecrawlClient | None = None,
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
    opened_page_ids: set[str] = set()
    opened_question_ids: set[str] = set()
    requested_companies: set[str] = set()
    question_cache: dict[str, dict[str, Any]] = {}
    source_cache: dict[str, dict[str, Any]] = {}
    page_cache: dict[tuple[str, str, int], dict[str, Any]] = {}
    findings: list[dict[str, Any]] = []
    rejected_evidence_pairs: set[tuple[str, str, str]] = set()
    rejected_findings = 0

    def finish(content: str) -> tuple[str, list[str]]:
        payload["finding_notebook"] = findings
        payload["writer_tool_state"] = {
            "opened_question_ids": sorted(opened_question_ids),
            "requested_companies": sorted(requested_companies),
            "opened_page_ids": sorted(opened_page_ids),
            "rejected_findings": rejected_findings,
        }
        return content, opened

    for _turn in range(MAX_OPEN_TURNS):
        message = call_writer_message(payload)
        calls = message.get("tool_calls") or []
        if not calls:
            content = str(message.get("content") or "")
            if len(findings) >= REQUIRED_FINDINGS:
                return finish(content)
            messages.append({"role": "assistant", "content": content})
            messages.append(
                {
                    "role": "system",
                    "content": (
                        f"The final answer is premature: only {len(findings)} of "
                        f"{REQUIRED_FINDINGS} validated findings are saved. Continue "
                        "the investigation with the available tools. Do not repeat "
                        "requests already present in the conversation."
                    ),
                }
            )
            continue
        messages.append(
            {
                "role": "assistant",
                "content": message.get("content"),
                "tool_calls": calls,
            }
        )

        # Fill selected missing pages concurrently. One tool call may contain
        # several pages so the agent does not spend one model turn per page.
        selected_page_ids: list[str] = []
        for call in calls:
            function = call.get("function") or {}
            if str(function.get("name", "")) != "open_pages":
                continue
            try:
                selected_arguments = json.loads(function.get("arguments") or "{}")
            except (TypeError, ValueError):
                selected_arguments = {}
            for request in selected_arguments.get("pages", []) or []:
                selected_id = str(request.get("page_id", ""))
                selected_page = pages.get(selected_id)
                selected_company = str((selected_page or {}).get("company_name", ""))
                company_was_requested = any(
                    names_match(selected_company, name) for name in requested_companies
                )
                if (
                    selected_page
                    and company_was_requested
                    and selected_id not in opened_page_ids
                    and selected_id not in selected_page_ids
                    and len(opened_page_ids) + len(selected_page_ids) < MAX_PAGE_OPENS
                ):
                    selected_page_ids.append(selected_id)
        if selected_page_ids:
            with ThreadPoolExecutor(max_workers=min(4, len(selected_page_ids))) as executor:
                list(
                    executor.map(
                        lambda selected_id: hydrate_writer_page(
                            pages[selected_id], firecrawl_client
                        ),
                        selected_page_ids,
                    )
                )

        for call in calls:
            function = call.get("function") or {}
            name = str(function.get("name", ""))
            try:
                arguments = json.loads(function.get("arguments") or "{}")
            except (TypeError, ValueError):
                arguments = {}
            if name == "open_company_sources":
                source_results = []
                for wanted_value in arguments.get("company_names", []) or []:
                    wanted = str(wanted_value).strip()
                    key = normalize_name(wanted)
                    if key in source_cache:
                        item = {**source_cache[key], "note": "Already returned earlier."}
                    elif len(source_cache) >= MAX_SOURCE_LOOKUPS:
                        item = {"company_name": wanted, "error": "Source lookup budget exhausted."}
                    else:
                        item = open_company_sources(wanted, company_blocks)
                        if not item.get("error"):
                            actual_name = str(item.get("company_name", wanted))
                            requested_companies.add(actual_name)
                            source_cache[key] = item
                            opened.append(f"sources {actual_name}")
                    source_results.append(item)
                result = {"companies": source_results}
            elif name == "open_pages":
                page_results = []
                for request in arguments.get("pages", []) or []:
                    wanted = str(request.get("page_id", ""))
                    how = str(request.get("how", "text"))
                    try:
                        part = max(1, int(request.get("part", 1)))
                    except (TypeError, ValueError):
                        part = 1
                    cache_key = (wanted, how, part)
                    page = pages.get(wanted)
                    page_company = str((page or {}).get("company_name", ""))
                    company_was_requested = any(
                        names_match(page_company, company) for company in requested_companies
                    )
                    if cache_key in page_cache:
                        item = {**page_cache[cache_key], "note": "Already returned earlier."}
                    elif page is None:
                        item = {"error": f"No page called {wanted}."}
                    elif not company_was_requested:
                        item = {"error": "Request this company's sources first.", "company_name": page_company}
                    elif len(opened_page_ids) >= MAX_PAGE_OPENS:
                        item = {"error": "The page-open budget is exhausted."}
                    else:
                        hydrate_writer_page(page, firecrawl_client)
                        item = open_page(wanted, pages, how, part)
                        page_cache[cache_key] = item
                        opened_page_ids.add(wanted)
                        opened.append(f"page {wanted} ({how} part {item.get('part', 1)})")
                    page_results.append(item)
                result = {"pages": page_results}
            elif name == "open_questions":
                question_results = []
                for wanted_value in arguments.get("question_ids", []) or []:
                    wanted = str(wanted_value)
                    if wanted in question_cache:
                        item = {**question_cache[wanted], "note": "Already returned earlier."}
                    elif len(opened_question_ids) >= MAX_QUESTION_OPENS:
                        item = {"error": "The question-open budget is exhausted."}
                    else:
                        item = open_question(
                            wanted, question_rows, raw_results, labels, hidden_names, pages=pages
                        )
                        if not item.get("error"):
                            question_cache[wanted] = item
                            opened_question_ids.add(wanted)
                            opened.append(f"question {wanted}")
                    question_results.append(item)
                result = {"questions": question_results}
            elif name == "save_evidence_analysis":
                finding_results = []
                for candidate in arguments.get("findings", []) or []:
                    pair_key = (
                        str(candidate.get("primary_question_id", "")).strip(),
                        str(candidate.get("competitor_page_id", "")).strip(),
                        str(candidate.get("audited_page_id", "")).strip(),
                    )
                    if pair_key in rejected_evidence_pairs:
                        item = {"accepted": False, "errors": ["This evidence pair was already rejected; use another."]}
                    else:
                        item = validate_and_save_finding(
                            candidate, pages=pages, question_rows=question_rows,
                            company_blocks=company_blocks, audited_company=audited_company,
                            opened_page_ids=opened_page_ids,
                            opened_question_ids=opened_question_ids, findings=findings,
                        )
                    if item.get("accepted"):
                        opened.append(f"finding {item.get('finding_id')}")
                    else:
                        rejected_findings += 1
                        errors = " ".join(item.get("errors") or []).casefold()
                        if any(marker in errors for marker in ("passage", "belongs to a different company", "does not belong to the audited company")):
                            rejected_evidence_pairs.add(pair_key)
                            item["next_step"] = "Discard this pair and use another page or question."
                    finding_results.append(item)
                result = {"results": finding_results, "notebook": compact_finding_notebook(findings)}
            else:
                result = {"error": f"There is no tool called {name}."}
            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": call.get("id"),
                    "content": json.dumps(result, ensure_ascii=False),
                }
            )
        if len(findings) >= REQUIRED_FINDINGS:
            payload["_writer_tools"] = payload.get("tools") or []
            payload.pop("tools", None)
            content = write_from_evidence_map(payload, findings)
            return finish(content)

        question_target = min(6, len(question_rows))
        if len(opened_question_ids) < question_target:
            next_step = (
                f"Open {question_target - len(opened_question_ids)} more distinct "
                "questions from different buyer needs, preferably together."
            )
        elif not any(
            names_match(audited_company, company) for company in requested_companies
        ):
            next_step = "Request the audited company's source inventory."
        elif len(opened_page_ids) < 2:
            next_step = (
                "Open the most relevant audited-company and winning-competitor pages."
            )
        else:
            next_step = (
                "Save every complete, distinct evidence pair you already proved, "
                "in one batched save_evidence_analysis call. For missing "
                "pairs, open another relevant source or page instead of repeating one."
            )
        messages.append(
            {
                "role": "system",
                "content": (
                    "Investigation progress: "
                    f"{len(opened_question_ids)}/{question_target} target questions opened; "
                    f"{len(requested_companies)} company inventories requested; "
                    f"{len(opened_page_ids)} pages opened; "
                    f"{len(findings)}/{REQUIRED_FINDINGS} evidence-analysis entries saved. "
                    f"Next priority: {next_step} The earlier tool results and accepted "
                    "notebook findings remain valid; do not request them again."
                ),
            }
        )

    # A bounded run that cannot prove five actions must fail safely rather than
    # forcing the writer to invent the missing recommendations.
    payload["_writer_tools"] = payload.get("tools") or []
    payload.pop("tools", None)
    if len(findings) < REQUIRED_FINDINGS:
        return finish(
            json.dumps(
                {
                    "recommendations": [],
                    "summary": (
                        f"Only {len(findings)} of {REQUIRED_FINDINGS} required "
                        "evidence-backed findings could be validated."
                    ),
                }
            )
        )
    return finish(write_from_evidence_map(payload, findings))


def call_writer_message(payload: dict[str, Any]) -> dict[str, Any]:
    if os.environ.get("AUDIT_WRITER_PROVIDER", "openai") == "bedrock_claude":
        return call_bedrock_tool_message(payload, model=str(payload.get("model") or ""))
    return call_chat_message(
        {key: value for key, value in payload.items() if not key.startswith("_")}
    )


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
                "competitor_evidence_reason",
                "audited_company_evidence_reason",
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
