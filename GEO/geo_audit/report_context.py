"""What the report writer is given, and what it can ask for.

The writer used to be handed a fixed slice of everything: ten of a hundred lost
questions, the first seven hundred characters of three pages, a two-hundred
character extract per citation. We chose those slices without knowing what the
writer would need, and it wrote as though the slice were the whole.

Now it gets all twenty questions and the names of the companies whose sources
are available. It asks for one company's source inventory only when that
company matters to a lost question, then opens only the pages it needs.

Two things never reach it. Which AI assistant said what, because a report that
names them turns an audit of a market into an audit of one vendor's model. And
web addresses as text it could copy, because an address it retypes can be
wrong; it asks for a page by id instead.
"""

from __future__ import annotations

import collections
import re
from typing import Any

from .aggregation import build_user_keys, grouped_company_name, is_user_company
from .company_merge import clean_source_url


AVERAGE_POSITION_NOTE = (
    "Where the audited company appeared in the list of names, counted only "
    "across the answers that named it. 1 means first. It says nothing about "
    "the answers that left the company out."
)


def build_headline_numbers(
    raw_results: list[dict[str, Any]],
    question_rows: list[dict[str, Any]],
    company_name: str,
    user_keys: set[str],
    company_aliases: dict[str, str] | None,
) -> dict[str, Any]:
    """The run in plain figures.

    "5 of 105 answers" read as though a hundred and five questions were asked.
    There were twenty, put to six assistants each. Saying so stops the writer
    describing the audit wrongly in its first sentence.
    """
    assistants = {
        str(result.get("assistant", "")) for result in raw_results
    } - {""}
    named = [row for row in question_rows if row["answers_naming_the_company"]]
    positions = [
        row["best_position"]
        for row in question_rows
        if row.get("best_position")
    ]
    return {
        "audited_company": company_name,
        "questions_asked": len(question_rows),
        "assistants_asked": len(assistants),
        "answers_we_got_back": len(raw_results),
        "answers_naming_the_audited_company": sum(
            row["answers_naming_the_company"] for row in question_rows
        ),
        "questions_where_the_audited_company_appeared_at_all": len(named),
        "average_position_when_named": (
            round(sum(positions) / len(positions), 2) if positions else None
        ),
        "what_average_position_means": AVERAGE_POSITION_NOTE,
    }


def build_question_rows(
    raw_results: list[dict[str, Any]],
    company_name: str,
    user_keys: set[str],
    company_aliases: dict[str, str] | None = None,
) -> list[dict[str, Any]]:
    """One row per question, not per answer.

    A hundred "lost questions" were twenty questions each lost by five
    assistants. Sending ten of those hundred sent two or three real questions,
    repeated. Grouped by question, all twenty fit, and the writer sees how many
    assistants agreed rather than the same question five times.

    The reason shown is the one from the assistant that ranked the company
    highest - the strongest endorsement it got - because "the first one stored"
    is not a rule anybody can explain. The rest are a tool call away.
    """
    by_question: dict[str, dict[str, Any]] = {}
    order: list[str] = []
    for result in raw_results:
        question = str(result.get("prompt", "")).strip()
        if not question:
            continue
        if question not in by_question:
            order.append(question)
            by_question[question] = {
                "question": question,
                "category": result.get("prompt_category", ""),
                "answers": 0,
                "answers_naming_the_company": 0,
                "positions": [],
                "companies": {},
            }
        row = by_question[question]
        row["answers"] += 1
        for item in result.get("recommended_companies", []) or []:
            written = str(item.get("company_name", "") or "").strip()
            if not written:
                continue
            try:
                position = int(item.get("rank", 0) or 0)
            except (TypeError, ValueError):
                position = 0
            if is_user_company(written, user_keys, company_aliases):
                row["answers_naming_the_company"] += 1
                if position:
                    row["positions"].append(position)
                continue
            name = grouped_company_name(written, company_aliases)
            entry = row["companies"].setdefault(
                name.lower(), {"company": name, "named_by": 0, "best_position": None}
            )
            entry["named_by"] += 1
            if position and (
                entry["best_position"] is None or position < entry["best_position"]
            ):
                entry["best_position"] = position

    rows = []
    for index, question in enumerate(order, start=1):
        row = by_question[question]
        companies = sorted(
            row["companies"].values(),
            key=lambda item: (-item["named_by"], item["best_position"] or 99),
        )
        rows.append(
            {
                "question_id": f"q-{index:02d}",
                "question": row["question"],
                "category": row["category"],
                "answers_naming_the_company": row["answers_naming_the_company"],
                "best_position": min(row["positions"]) if row["positions"] else None,
                # Names and places only. Carrying every assistant's reason here
                # spent ten thousand characters restating the same few
                # sentences, and the writer cannot use a reason it has not
                # chosen to look at. This list is for deciding which questions
                # are worth opening; open_question has the reasons.
                "who_was_named": [
                    {
                        "company": item["company"],
                        "position": item["best_position"],
                        "named_by": item["named_by"],
                    }
                    for item in companies[:5]
                ],

            }
        )
    return rows


def build_page_index(
    company_profile: dict[str, Any],
    competitor_evidence: dict[str, Any],
    user_snapshot: dict[str, Any] | None = None,
    evidence_catalog: list[dict[str, Any]] | None = None,
) -> tuple[dict[str, dict[str, Any]], dict[str, list[dict[str, str]]]]:
    """Every page read in this audit, under one set of ids.

    One id per page, used both to read it and to cite it. Two numbering
    schemes - one for reading, one for citing - is one more thing to keep in
    step, and the writer would have had to hold both.

    Returns (pages_by_id, inventory_by_company) where the inventory carries
    only what a page is for and its address, never its text. The text arrives
    when the writer asks for it.
    """
    pages: dict[str, dict[str, Any]] = {}
    inventory: dict[str, list[dict[str, str]]] = {}
    counter = 0

    seen: dict[tuple[str, str], str] = {}

    def add(
        company: str,
        url: Any,
        title: Any,
        text: Any,
        what_for: str,
        where: str = "",
        passages: list[str] | None = None,
    ) -> None:
        nonlocal counter
        address = str(url or "").strip()
        if not address:
            return
        # The same page reaches us twice - once from crawling a site, once from
        # searching the web - and the two spellings differ only by "www." or a
        # trailing slash. Left alone it became two ids for one page, which the
        # writer could cite twice as though two sources agreed.
        key = (company, canonical_page_url(address))
        if key in seen:
            return
        counter += 1
        seen[key] = f"p-{counter:03d}"
        page_id = f"p-{counter:03d}"
        pages[page_id] = {
            "page_id": page_id,
            "company_name": company,
            "url": address,
            "title": str(title or ""),
            "text": str(text or ""),
            "passages": list(passages or []),
        }
        row = {"page_id": page_id, "url": address}
        if where:
            row["where"] = where
        # A description is what the writer chooses from, so it always carries
        # one. Where the step that reads a site has not described a page, its
        # own title says more than "not described" and costs nothing - we
        # already hold it.
        row["what_it_is_for"] = (
            what_for or str(title or "").strip() or "no description available"
        )
        inventory.setdefault(company, []).append(row)

    company_name = str(company_profile.get("company_name", "This company"))
    described = {
        str(row.get("url", "")): str(row.get("what_it_is_for", ""))
        for row in company_profile.get("site_pages") or []
    }
    # Only the audited company's site is a fact rather than a finding: the
    # audit was commissioned for that address. Whose site any other page
    # belongs to rests on a discovery step that, measured on a real run, found
    # no site at all for one rival and the wrong company's site for another.
    # Claiming it anyway would let a rival's own marketing stand in as
    # independent opinion, so no claim is made and the writer judges from the
    # address and the description.
    for page in (user_snapshot or {}).get("pages", []) or []:
        add(
            company_name,
            page.get("url"),
            page.get("title"),
            page.get("main_text"),
            described.get(str(page.get("url", "")), ""),
            "the audited company's own site",
        )

    for competitor in competitor_evidence.get("competitors", []) or []:
        name = str(competitor.get("company_name", "Unknown"))
        described = {
            str(row.get("url", "")): str(row.get("what_it_is_for", ""))
            for row in competitor.get("site_pages") or []
        }
        for page in (competitor.get("website_snapshot") or {}).get("pages", []) or []:
            add(
                name,
                page.get("url"),
                page.get("title"),
                page.get("main_text"),
                described.get(str(page.get("url", "")), ""),
            )
        for mention in competitor.get("verified_web_mentions", []) or []:
            if not mention.get("verified"):
                continue
            add(
                name,
                mention.get("url"),
                mention.get("title") or mention.get("domain"),
                mention.get("page_text") or mention.get("snippet"),
                mention.get("usefulness_reason") or "discusses this company",
                passages=mention.get("passages"),
            )

    # One page, one id, used to read it and to cite it. Two lists of the same
    # pages under different ids meant the writer had to match p-014 to ev-003
    # by their addresses - the very thing removing addresses was meant to
    # prevent - and we paid to send all 46 pages twice.
    by_url = {canonical_page_url(page["url"]): page_id for page_id, page in pages.items()}
    for row in evidence_catalog or []:
        address = canonical_page_url(row.get("url"))
        page_id = by_url.get(address)
        if page_id is None:
            add(
                str(row.get("company_name", "Unknown")),
                row.get("url"),
                row.get("title"),
                row.get("excerpt"),
                str(row.get("label") or "a page about this company"),
            )
            by_url[address] = f"p-{counter:03d}"
            page_id = by_url[address]
        row["evidence_id"] = page_id
    return pages, inventory


def canonical_page_url(value: Any) -> str:
    address = str(value or "").strip().rstrip("/").lower()
    for prefix in ("https://", "http://"):
        if address.startswith(prefix):
            address = address[len(prefix) :]
            break
    return address.removeprefix("www.")


ASSISTANT_LABELS = "ABCDEF"


def anonymous_assistant_labels(raw_results: list[dict[str, Any]]) -> dict[str, str]:
    """Stable made-up names for the assistants.

    Which model said what has no place in advice about a website. Named, it
    invites "improve your standing with Claude", which is an audit of one
    vendor rather than of a market. The labels stay stable across the run so a
    pattern is still visible without any model being identifiable.
    """
    names = sorted({str(row.get("assistant", "")) for row in raw_results} - {""})
    return {
        name: f"assistant {ASSISTANT_LABELS[index % len(ASSISTANT_LABELS)]}"
        for index, name in enumerate(names)
    }


OPEN_PAGE_TOOL = {
    "type": "function",
    "function": {
        "name": "open_pages",
        "strict": True,
        "description": (
            "Read one to eight selected pages together. Every page listed under "
            "a requested company can be opened by its page_id. For a page under "
            "what the wider internet holds, ask for 'passages' to get only the "
            "parts naming that company."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "pages": {
                    "type": "array",
                    "minItems": 1,
                    "maxItems": 8,
                    "items": {
                        "type": "object",
                        "properties": {
                            "page_id": {"type": "string"},
                            "part": {"type": "integer"},
                            "how": {"enum": ["text", "passages"]},
                        },
                        "required": ["page_id", "part", "how"],
                        "additionalProperties": False,
                    },
                }
            },
            "required": ["pages"],
            "additionalProperties": False,
        },
    },
}

OPEN_QUESTION_TOOL = {
    "type": "function",
    "function": {
        "name": "open_questions",
        "strict": True,
        "description": (
            "Read every assistant's full answers to one to six buyer questions "
            "together. The "
            "question list shows who was named and the strongest reason given; "
            "this shows what each answer actually said and the page_ids of "
            "sources it cited for each company when those pages are available."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "question_ids": {
                    "type": "array",
                    "minItems": 1,
                    "maxItems": 6,
                    "items": {"type": "string"},
                    "description": "Distinct question_id values from the question list.",
                }
            },
            "required": ["question_ids"],
            "additionalProperties": False,
        },
    },
}


OPEN_COMPANY_SOURCES_TOOL = {
    "type": "function",
    "function": {
        "name": "open_company_sources",
        "strict": True,
        "description": (
            "Get source inventories for one to six relevant companies together. Only the audited company "
            "and the five top competitors named in companies_with_sources are "
            "available. Returns its official website and the page_id, address, "
            "title and source group of every stored page. Call this before "
            "open_page; companies outside that list have no stored sources."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "company_names": {
                    "type": "array",
                    "minItems": 1,
                    "maxItems": 6,
                    "items": {"type": "string"},
                    "description": (
                        "Exact company names from companies_with_sources."
                    ),
                }
            },
            "required": ["company_names"],
            "additionalProperties": False,
        },
    },
}


SAVE_FINDING_TOOL = {
    "type": "function",
    "function": {
        "name": "save_evidence_analysis",
        "strict": True,
        "description": (
            "After each page-reading batch, save one to five detailed analysis "
            "entries in the persistent evidence map. Explain what each page says, "
            "how the two pages relate to the grouped questions, why the listed "
            "competitor won, and what appears weaker or unclear for the audited "
            "company. Include both page IDs. This is analysis for a later writer, "
            "not the final recommendation. The tool only checks IDs, ownership, "
            "opened pages, and the question-to-competitor connection."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "findings": {
                    "type": "array",
                    "minItems": 1,
                    "maxItems": 5,
                    "items": {
                        "type": "object",
                        "properties": {
                "primary_question_id": {"type": "string"},
                "affected_question_ids": {
                    "type": "array",
                    "items": {"type": "string"},
                    "maxItems": 3,
                },
                "competitor_company": {"type": "string"},
                "competitor_page_id": {"type": "string"},
                "competitor_passage": {"type": "string", "description": "Detailed summary of the relevant competitor page content."},
                "audited_page_id": {"type": "string"},
                "audited_passage": {"type": "string", "description": "Detailed summary of the relevant audited-company page content."},
                "observation": {"type": "string", "description": "Reasoning that connects the questions and both pages."},
                "suggested_change": {"type": "string", "description": "Possible direction for the later writer, not a final recommendation."},
                "expected_impact": {"type": "string"},
                "competitor_evidence_reason": {"type": "string"},
                "audited_company_evidence_reason": {"type": "string"},
                "confidence": {
                    "type": "string",
                    "enum": ["High", "Medium", "Low"],
                },
            },
                        "required": [
                "primary_question_id",
                "affected_question_ids",
                "competitor_company",
                "competitor_page_id",
                "competitor_passage",
                "audited_page_id",
                "audited_passage",
                "observation",
                "suggested_change",
                "expected_impact",
                "competitor_evidence_reason",
                "audited_company_evidence_reason",
                "confidence",
                        ],
                        "additionalProperties": False,
                    },
                }
            },
            "required": ["findings"],
            "additionalProperties": False,
        },
    },
}


def open_company_sources(
    company_name: str,
    company_blocks: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    """Return one available company's links instead of sending every link up front."""
    wanted = re.sub(r"[^a-z0-9]+", "", str(company_name or "").casefold())
    matched_name = next(
        (
            name
            for name in company_blocks
            if re.sub(r"[^a-z0-9]+", "", str(name).casefold()) == wanted
        ),
        None,
    )
    if matched_name is None:
        return {
            "error": "No stored source inventory exists for that company.",
            "companies_with_sources": list(company_blocks),
        }
    block = company_blocks[matched_name]
    return {
        "company_name": matched_name,
        "official_website": block.get("official_website", "not known"),
        "pages_on_their_own_website": block.get(
            "pages_on_their_own_website", []
        ),
        "pages_the_assistants_cited_while_answering": block.get(
            "pages_the_assistants_cited_while_answering", []
        ),
        "pages_the_wider_internet_holds_about_them": block.get(
            "pages_the_wider_internet_holds_about_them", []
        ),
    }


PAGE_TEXT_LIMIT = 6000


def open_page(
    page_id: str,
    pages: dict[str, dict[str, Any]],
    how: str = "text",
    part: Any = 1,
) -> dict[str, Any]:
    """A page's text, or for a web mention the parts that name the company.

    Text is the default for every page, so one call behaves the same way
    whatever the page is. Passages exist only for pages found by web search:
    they were pulled from the page while checking it really was about that
    company, and they are the page's own words. Pages read from a company's own
    website have no passages, because the whole page is already held.
    """
    page = pages.get(str(page_id).strip())
    if page is None:
        return {"error": f"No page called {page_id}. Use a page_id from an inventory."}
    answer = {
        "page_id": page["page_id"],
        "company_name": page["company_name"],
        "title": page["title"],
    }
    passages = page.get("passages") or []
    if str(how).strip().lower() == "passages":
        if passages:
            return {**answer, "what_it_says_about_this_company": passages}
        return {
            **answer,
            **read_part(page["text"], 1),
            "note": "No passages for this page - it is not a web mention. Text returned instead.",
        }
    return {**answer, **read_part(page["text"], part)}


def read_part(text: str, part: Any) -> dict[str, Any]:
    """One slice of a page, and whether there is more of it.

    A fixed cut left the writer with the top of a long page and no way to know
    what it had missed, let alone reach it. Saying how many parts there are
    turns a silent truncation into a choice.
    """
    try:
        number = max(1, int(part))
    except (TypeError, ValueError):
        number = 1
    body = str(text or "")
    parts = max(1, -(-len(body) // PAGE_TEXT_LIMIT))
    number = min(number, parts)
    start = (number - 1) * PAGE_TEXT_LIMIT
    answer = {"text": body[start : start + PAGE_TEXT_LIMIT], "part": number, "parts": parts}
    if number < parts:
        answer["more"] = f"Ask for part {number + 1} to read on."
    return answer


def open_question(
    question_id: str,
    question_rows: list[dict[str, Any]],
    raw_results: list[dict[str, Any]],
    labels: dict[str, str],
    hidden_names: set[str] | None = None,
    pages: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Every answer to one question, with no assistant identifiable.

    Relabelling the speaker is not enough: an answer can name its own maker in
    passing, and the reasons are the providers' own prose. Anything the writer
    reads here is scrubbed, or the name reaches the report by the back door.
    """
    row = next(
        (item for item in question_rows if item["question_id"] == str(question_id).strip()),
        None,
    )
    if row is None:
        return {
            "error": f"No question called {question_id}. Use a question_id from the list."
        }
    hide = hidden_names if hidden_names is not None else assistant_and_model_names(
        raw_results
    )
    page_ids_by_url = {
        canonical_page_url(page.get("url")): page_id
        for page_id, page in (pages or {}).items()
        if page.get("url")
    }

    def source_page_ids(values: Any) -> list[str]:
        found: list[str] = []
        for value in values or []:
            candidate = (
                value.get("url") or value.get("source_url") or ""
                if isinstance(value, dict)
                else value
            )
            address = clean_source_url(candidate)
            page_id = page_ids_by_url.get(canonical_page_url(address))
            if page_id and page_id not in found:
                found.append(page_id)
        return found

    answers = []
    for result in raw_results:
        if str(result.get("prompt", "")).strip() != row["question"]:
            continue
        answer_page_ids = source_page_ids(result.get("provider_source_urls", []))
        answers.append(
            {
                "assistant": labels.get(str(result.get("assistant", "")), "an assistant"),
                "answer": strip_assistant_names(
                    str(
                        result.get("provider_structured_answer")
                        or result.get("raw_response")
                        or ""
                    )[:2500],
                    hide,
                ),
                "assistant_cited_page_ids": answer_page_ids,
                "companies_it_named": [
                    {
                        "company": item.get("company_name"),
                        "position": item.get("rank"),
                        "reason": strip_assistant_names(item.get("reasoning"), hide),
                        "assistant_cited_page_ids": source_page_ids(
                            [
                                *(item.get("source_urls", []) or []),
                                *(item.get("citations", []) or []),
                            ]
                        ),
                    }
                    for item in result.get("recommended_companies", []) or []
                ],
            }
        )
    return {"question": row["question"], "answers": answers}


def strip_assistant_names(text: Any, names: set[str]) -> str:
    """Remove any AI assistant or model name from the written advice.

    The prompt asks for this, and a prompt is a request. A customer reading
    "improve your standing with Claude" learns that their audit was of one
    vendor's model, which is not what they bought and not what was measured.
    """
    written = str(text or "")
    if not written or not names:
        return written
    # A model name arrives with its version glued on - "gpt-5-mini",
    # "claude-haiku-4-5". Replacing only the vendor word leaves "-5-mini"
    # stranded mid-sentence, so the version tail goes with it.
    alternation = "|".join(
        re.escape(name) for name in sorted(names, key=len, reverse=True) if name
    )
    written = re.sub(
        rf"(?<![A-Za-z0-9])(?:{alternation})[A-Za-z0-9_-]*",
        "an AI assistant",
        written,
        flags=re.IGNORECASE,
    )
    written = re.sub(
        r"an AI assistant(?:[\s,]+(?:and\s+)?an AI assistant)+",
        "AI assistants",
        written,
        flags=re.IGNORECASE,
    )
    return re.sub(r"\s{2,}", " ", written).strip()


def assistant_and_model_names(raw_results: list[dict[str, Any]]) -> set[str]:
    """Every string that could identify a provider, from the run itself.

    Read off the results rather than kept as a list here, so a provider added
    later is covered without anybody remembering to add it.
    """
    names: set[str] = set()
    for result in raw_results:
        for field in ("assistant", "model"):
            value = str(result.get(field, "") or "").strip()
            if not value:
                continue
            names.add(value)
    # Splitting a model id into its alphabetic parts looked like a way to
    # cover new providers for free. It also harvested "large", "flash" and
    # "instruct" out of ids like mistral-large and gemini-2.5-flash, and the
    # report then told a customer they needed SLAs "for an AI assistant
    # organizations". Only the exact identifiers and a named list of vendors
    # are stripped now; a genuinely new vendor is one word added here, which
    # is cheaper than mangling the prose.
    names.update(VENDOR_WORDS)
    return names


# Words that only ever name an AI vendor or model family. Every one has to be
# safe to delete from an English sentence about a website.
VENDOR_WORDS = frozenset(
    {
        "anthropic",
        "bedrock",
        "chatgpt",
        "claude",
        "deepseek",
        "gemini",
        "gpt",
        "grok",
        "groq",
        "kimi",
        "llama",
        "minimax",
        "mistral",
        "openai",
        "perplexity",
        "sarvam",
    }
)


# The profile holds twenty-five fields, built for the step that writes buyer
# questions. The report writer needs the handful that say who this company is
# and who buys from it; buyer personas with their supporting quotes, market
# signals and purchase context are four thousand characters it reads past.
PROFILE_FIELDS_THE_WRITER_USES = (
    "company_name",
    "category",
    "target_audience",
    "business_type",
    "unique_value_proposition",
    "primary_offerings",
    "use_cases",
    "problems_solved",
    "industries",
    "buying_signals",
    "competitor_scope",
)


def trim_profile(company_profile: dict[str, Any]) -> dict[str, Any]:
    """Only the parts of the profile the report is written from."""
    return {
        field: company_profile[field]
        for field in PROFILE_FIELDS_THE_WRITER_USES
        if company_profile.get(field)
    }


def official_websites(
    raw_results: list[dict[str, Any]],
    competitor_evidence: dict[str, Any],
    company_aliases: dict[str, str] | None,
    user_keys: set[str],
    user_company: str,
) -> dict[str, str]:
    """Each company's front door, taken from what the assistants reported.

    Only the search-backed assistant can answer this, and it answers per
    company per question, so the same company arrives several times. The
    address most of them give wins - which is also what stops one stray answer
    naming a parent company from sending the crawl to the wrong website.
    """
    votes: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
    for result in raw_results:
        for item in result.get("recommended_companies", []) or []:
            site = str(item.get("official_website", "") or "").strip()
            if not site.startswith(("http://", "https://")):
                continue
            written = str(item.get("company_name", "") or "").strip()
            name = (
                user_company
                if is_user_company(written, user_keys, company_aliases)
                else grouped_company_name(written, company_aliases)
            )
            votes[name][site.rstrip("/")] += 1
    settled = {name: counted.most_common(1)[0][0] for name, counted in votes.items()}
    # A crawl that already found a site is better evidence than any single
    # answer: we opened it and it was there.
    for competitor in competitor_evidence.get("competitors", []) or []:
        site = str(competitor.get("website_url", "") or "").strip()
        if site.startswith(("http://", "https://")) and (
            competitor.get("website_snapshot") or {}
        ).get("pages"):
            settled.setdefault(str(competitor.get("company_name", "")), site.rstrip("/"))
    return settled


def cited_urls_by_company(
    raw_results: list[dict[str, Any]],
    company_aliases: dict[str, str] | None,
    user_keys: set[str],
    user_company: str,
) -> dict[str, list[str]]:
    """Pages an assistant pointed a buyer at, gathered per company.

    Counted from the answers rather than from the aggregate, so the audited
    company is counted the same way as everybody else. Its empty list is the
    finding the report is for.
    """
    cited: dict[str, list[str]] = collections.defaultdict(list)
    for result in raw_results:
        for item in result.get("recommended_companies", []) or []:
            written = str(item.get("company_name", "") or "").strip()
            if not written:
                continue
            name = (
                user_company
                if is_user_company(written, user_keys, company_aliases)
                else grouped_company_name(written, company_aliases)
            )
            for url in item.get("source_urls", []) or []:
                clean = clean_source_url(url)
                if clean and clean not in cited[name]:
                    cited[name].append(clean)
    return cited


def build_company_blocks(
    company_profile: dict[str, Any],
    competitor_evidence: dict[str, Any],
    recommendation_patterns: dict[str, Any],
    raw_results: list[dict[str, Any]],
    user_snapshot: dict[str, Any] | None = None,
    web_presence: dict[str, Any] | None = None,
) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
    """One block per company: where they live, and every page we hold for them.

    Grouped by company rather than by where a page came from, because the
    writer reasons about a company at a time. Within a block the three lists
    answer three different questions - what the company publishes, what AI
    reaches for, and what the wider internet holds - and the last two read
    together are the diagnosis the report exists to make.

    Returns (pages_by_id, blocks). Every page appears under exactly one id, so
    a page found by two routes is never counted twice.
    """
    user_company = str(company_profile.get("company_name", "")).strip()
    user_keys = build_user_keys(user_company, company_profile.get("company_name_variants"))
    aliases = recommendation_patterns.get("company_name_groups") or {}

    sites = official_websites(
        raw_results, competitor_evidence, aliases, user_keys, user_company
    )
    # The audited company's address is the one fact in this step that was never
    # worked out: the audit was commissioned for it. Leaving it to the same
    # voting as the rivals had it come back "not known" for the customer.
    audited_site = str(
        (user_snapshot or {}).get("normalized_url")
        or (user_snapshot or {}).get("input_url")
        or company_profile.get("domain")
        or ""
    ).strip()
    if audited_site:
        if not audited_site.startswith(("http://", "https://")):
            audited_site = f"https://{audited_site}"
        sites[user_company] = audited_site.rstrip("/")
    cited = cited_urls_by_company(raw_results, aliases, user_keys, user_company)

    crawled: dict[str, list[tuple[Any, Any, Any]]] = collections.defaultdict(list)
    for page in (user_snapshot or {}).get("pages", []) or []:
        crawled[user_company].append((page.get("url"), page.get("title"), page.get("main_text")))
    for competitor in competitor_evidence.get("competitors", []) or []:
        name = str(competitor.get("company_name", "Unknown"))
        for page in (competitor.get("website_snapshot") or {}).get("pages", []) or []:
            crawled[name].append((page.get("url"), page.get("title"), page.get("main_text")))

    found: dict[str, list[dict[str, Any]]] = collections.defaultdict(list)
    # Competitor evidence already carries the rivals' independent-search
    # pages. The audited company's pages live only in web_presence, so bring
    # that one missing entity into the same company block.
    for entity in (web_presence or {}).get("entities", []) or []:
        entity_name = str(entity.get("company_name", "")).strip()
        if entity.get("entity_type") != "user_company" and not is_user_company(
            entity_name, user_keys, aliases
        ):
            continue
        for mention in entity.get("verified_mentions", []) or []:
            if mention.get("verified"):
                found[user_company].append(mention)
        break
    for competitor in competitor_evidence.get("competitors", []) or []:
        name = str(competitor.get("company_name", "Unknown"))
        for mention in competitor.get("verified_web_mentions", []) or []:
            if mention.get("verified"):
                found[name].append(mention)

    order = [user_company] + [
        str(row.get("company_name", ""))
        for row in recommendation_patterns.get("top_competitors", []) or []
        if str(row.get("company_name", "")) != user_company
    ]

    pages: dict[str, dict[str, Any]] = {}
    blocks: dict[str, dict[str, Any]] = {}
    counter = 0
    for name in order:
        if not name:
            continue
        site = sites.get(name)
        by_url: dict[str, dict[str, Any]] = {}

        def keep(url: Any, title: Any, text: Any, passages: Any = None) -> dict[str, Any] | None:
            nonlocal counter
            address = str(url or "").strip()
            if not address:
                return None
            key = canonical_page_url(address)
            if key in by_url:
                return by_url[key]
            counter += 1
            page_id = f"p-{counter:03d}"
            pages[page_id] = {
                "page_id": page_id,
                "company_name": name,
                "url": address,
                "title": " ".join(str(title or "").split())[:90],
                "text": str(text or ""),
                "passages": list(passages or []),
            }
            row = {"page_id": page_id, "url": address, "title": pages[page_id]["title"]}
            by_url[key] = row
            return row

        own = [row for row in (keep(*page) for page in crawled.get(name, [])) if row]
        # A discovered official address must remain readable even when the
        # earlier site crawl returned no pages. Giving it a page_id lets the
        # writer fetch it only if needed through open_page's bounded fallback.
        official_home = keep(site, "", "") if site else None
        if official_home and official_home not in own:
            own.insert(0, official_home)
        elsewhere = []
        for mention in found.get(name, []):
            row = keep(
                mention.get("url"),
                mention.get("title") or mention.get("domain"),
                mention.get("page_text") or mention.get("snippet"),
                mention.get("passages"),
            )
            if not row:
                continue
            if site and canonical_page_url(row["url"]).startswith(canonical_page_url(site)):
                if row not in own:
                    own.append(row)
            elif row not in own:
                elsewhere.append(row)
        cited_rows = []
        for url in cited.get(name, []):
            row = keep(url, "", "")
            if row and row not in cited_rows:
                cited_rows.append({"page_id": row["page_id"], "url": row["url"]})

        blocks[name] = {
            "official_website": site or "not known",
            "pages_on_their_own_website": own,
            "pages_the_assistants_cited_while_answering": cited_rows,
            "pages_the_wider_internet_holds_about_them": elsewhere,
        }
    return pages, blocks
