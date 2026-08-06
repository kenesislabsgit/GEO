from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse

from json import JSONDecodeError

from .agentcore_search import AGENTCORE_REGION, AgentCoreWebSearchClient
from .crawler import fetch_html, parse_page
from .json_tools import extract_json_object
from .llm import (
    LLMNotConfigured,
    build_chat_payload,
    call_chat_completion,
    load_dotenv,
)
from .site_discovery import discover_competitor_site
from .source_analysis import classify_source_url, domain_from_url
from .web_search import DDGSSearchClient, FallbackWebSearchClient


SEARCH_RESULTS_PER_QUERY = 4
VERIFIED_RESULTS_PER_QUERY = 2
CONTEXT_STOP_WORDS = {
    "and",
    "for",
    "from",
    "into",
    "the",
    "their",
    "using",
    "with",
    "without",
    "which",
    "what",
    "best",
    "provide",
    "provides",
    "offering",
    "offers",
    "real",
    "time",
    "solutions",
    "software",
    "platform",
    "companies",
}
KNOWN_ALIASES = {
    "aws": ["AWS", "Amazon Web Services"],
    "amazon web services": ["Amazon Web Services", "AWS"],
    "gcp": ["GCP", "Google Cloud", "Google Cloud Platform"],
    "google cloud platform": ["Google Cloud Platform", "Google Cloud", "GCP"],
    "microsoft azure": ["Microsoft Azure", "Azure"],
}


def collect_web_presence(
    company_profile: dict[str, Any],
    prompts: list[dict[str, Any]],
    raw_results: list[dict[str, Any]],
    recommendation_patterns: dict[str, Any],
    *,
    max_competitors: int = 3,
    gateway_url: str | None = None,
    gateway_tool_name: str | None = None,
    search_concurrency: int = 4,
    fetch_concurrency: int = 8,
    error_log_path: str | Path | None = None,
) -> dict[str, Any]:
    load_dotenv()
    configured_gateway_url = (
        gateway_url
        or os.getenv("AGENTCORE_GATEWAY_URL")
        or os.getenv("GATEWAY_URL")
    )
    generated_at = datetime.now(timezone.utc).isoformat()
    entities = build_presence_entities(
        company_profile,
        raw_results,
        recommendation_patterns,
        max_competitors=max_competitors,
    )
    fallback = (
        AgentCoreWebSearchClient.from_environment(
            gateway_url=configured_gateway_url,
            tool_name=gateway_tool_name,
        )
        if configured_gateway_url
        else None
    )
    try:
        client = FallbackWebSearchClient(DDGSSearchClient(), fallback)
    except Exception as exc:  # noqa: BLE001 - report setup/auth failures explicitly.
        configuration_error = {
            "provider": "duckduckgo",
            "query": None,
            "error_type": "configuration_error",
            "error": str(exc),
            "occurred_at": datetime.now(timezone.utc).isoformat(),
        }
        append_error_log(error_log_path, configuration_error)
        return {
            "status": "configuration_error",
            "provider": "duckduckgo_with_agentcore_fallback",
            "generated_at": generated_at,
            "message": str(exc),
            "search_errors": [configuration_error],
            "entities": [
                {
                    **entity,
                    "search_queries": build_bounded_search_queries(
                        entity, company_profile, prompts, raw_results
                    ),
                    "official_website": entity.get("known_website"),
                    "verified_mentions": [],
                }
                for entity in entities
            ],
            "summary": empty_summary(len(entities)),
        }

    # The templates run whatever happens. The written searches are added on
    # top, so a failed or unusable model response costs the extra reach and
    # nothing else.
    template_queries = {
        str(entity["company_name"]): build_bounded_search_queries(
            entity, company_profile, prompts, raw_results
        )
        for entity in entities
    }
    written_queries, query_diagnostics = generate_presence_queries(
        company_profile, entities, template_queries
    )

    search_tasks = []
    for entity in entities:
        name = str(entity["company_name"])
        queries = [
            *template_queries.get(name, []),
            *written_queries.get(name, []),
        ]
        entity["search_queries"] = queries
        for query in queries:
            search_tasks.append((entity["company_name"], query))

    search_rows: list[dict[str, Any]] = []
    search_errors: list[dict[str, Any]] = []
    provider_counts: dict[str, int] = {}
    fallback_queries = 0
    workers = max(1, min(search_concurrency, len(search_tasks) or 1))
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {
            executor.submit(
                client.search,
                query["query"],
                SEARCH_RESULTS_PER_QUERY,
            ): (company_name, query)
            for company_name, query in search_tasks
        }
        for future in as_completed(futures):
            company_name, query = futures[future]
            try:
                search_result = future.result()
            except (HTTPError, URLError, TimeoutError, ValueError, RuntimeError) as exc:
                error = {
                    "company_name": company_name,
                    "query": query["query"],
                    "provider": "search_orchestrator",
                    "error_type": "unexpected_failure",
                    "error": str(exc),
                    "occurred_at": datetime.now(timezone.utc).isoformat(),
                }
                search_errors.append(error)
                append_error_log(error_log_path, error)
                continue
            for error in search_result.get("errors", []):
                enriched_error = {
                    **error,
                    "company_name": company_name,
                    "fallback_used": search_result.get("fallback_used", False),
                }
                search_errors.append(enriched_error)
                append_error_log(error_log_path, enriched_error)
            results = search_result.get("results", [])
            provider_counts[search_result.get("provider", "unknown")] = (
                provider_counts.get(search_result.get("provider", "unknown"), 0) + 1
            )
            if search_result.get("fallback_used"):
                fallback_queries += 1
            for result in results[:SEARCH_RESULTS_PER_QUERY]:
                search_rows.append(
                    {
                        **result,
                        "company_name": company_name,
                        "query": query["query"],
                        "query_type": query["query_type"],
                    }
                )

    candidates = select_fetch_candidates(search_rows)
    verified_rows: list[dict[str, Any]] = []
    fetch_workers = max(1, min(fetch_concurrency, len(candidates) or 1))
    with ThreadPoolExecutor(max_workers=fetch_workers) as executor:
        futures = {
            executor.submit(
                verify_search_result,
                row,
                company_profile=company_profile,
            ): row
            for row in candidates
        }
        for future in as_completed(futures):
            try:
                verified = future.result()
            except Exception:  # noqa: BLE001 - an inaccessible source is not audit-fatal.
                continue
            if verified:
                verified_rows.append(verified)

    entity_rows = []
    for entity in entities:
        company_name = entity["company_name"]
        mentions = sorted(
            [
                row
                for row in verified_rows
                if row.get("company_name") == company_name
            ],
            key=lambda row: (
                -int(row.get("relevance_score", 0)),
                int(row.get("search_rank", 999)),
            ),
        )
        known_website = entity.get("known_website")
        if known_website:
            discovery = {
                "company_name": company_name,
                "official_website": known_website,
                "confidence": "High",
                "method": "audited_website_profile",
                "evidence": ["Taken from the audited website profile."],
                "candidate_domains": [],
            }
        else:
            contextual_urls = [
                row["url"]
                for row in mentions
                if row.get("matched_context_terms")
            ]
            discovery = discover_competitor_site(
                company_name,
                contextual_urls or [row["url"] for row in mentions],
            )
        official_website = discovery.get("official_website")
        if official_website:
            mentions = [
                {
                    **row,
                    "source_type": classify_source_url(
                        str(row.get("url", "")),
                        official_domain=official_website,
                    ),
                }
                for row in mentions
            ]
        entity_rows.append(
            {
                **entity,
                "official_website": official_website,
                "site_discovery": discovery,
                "verified_mentions": mentions,
            }
        )

    entity_rows, gate_diagnostics = gate_entity_mentions(
        entity_rows, company_profile
    )

    verified_rows = [
        row for entity in entity_rows for row in entity["verified_mentions"]
    ]
    unique_mentions = {
        (row.get("company_name"), row.get("url"))
        for row in verified_rows
    }
    status = (
        "completed"
        if search_rows and not search_errors
        else "partial"
        if search_rows
        else "failed"
    )
    return {
        "status": status,
        "provider": "duckduckgo_with_agentcore_fallback",
        "generated_at": generated_at,
        "fallback_provider": (
            "aws_agentcore_web_search" if configured_gateway_url else "not_configured"
        ),
        "region": AGENTCORE_REGION if configured_gateway_url else None,
        "method": "duckduckgo_search_agentcore_fallback_and_page_verification",
        "entities": entity_rows,
        "search_errors": search_errors,
        "summary": {
            "entities_checked": len(entity_rows),
            "queries_run": len(search_tasks),
            "search_errors": len(search_errors),
            "provider_queries": provider_counts,
            "fallback_queries": fallback_queries,
            "verified_mentions": len(unique_mentions),
            "official_websites_resolved": sum(
                1 for entity in entity_rows if entity.get("official_website")
            ),
            # Kept so a thin result can be read as "the searches were poor"
            # rather than "this company has no presence".
            "written_queries": query_diagnostics,
            "same_company_gate": gate_diagnostics,
        },
    }


def build_presence_entities(
    company_profile: dict[str, Any],
    raw_results: list[dict[str, Any]],
    recommendation_patterns: dict[str, Any],
    *,
    max_competitors: int,
) -> list[dict[str, Any]]:
    user_company = str(company_profile.get("company_name", "")).strip()
    entities = []
    if user_company:
        supporting_pages = company_profile.get("evidence", {}).get(
            "supporting_pages", []
        )
        known_website = (
            str(supporting_pages[0]).strip()
            if isinstance(supporting_pages, list) and supporting_pages
            else None
        )
        entities.append(
            {
                "company_name": user_company,
                "entity_type": "user_company",
                "aliases": company_aliases(user_company),
                "known_website": known_website,
            }
        )

    for competitor in recommendation_patterns.get("top_competitors", []):
        name = str(competitor.get("company_name", "")).strip()
        if not name or same_company(name, user_company):
            continue
        entities.append(
            {
                "company_name": name,
                "entity_type": "competitor",
                "aliases": company_aliases(name),
                "mention_frequency": competitor.get("mention_frequency", 0),
                "sample_prompts": prompts_for_company(name, raw_results)[:3],
            }
        )
        if len(entities) >= max_competitors + (1 if user_company else 0):
            break
    return entities


PRESENCE_QUERY_SYSTEM_PROMPT = """What this task is for.

An AI assistant answers questions about a company from what has been published
about it on the open web. A company written about in reviews, comparisons,
directories and industry press is a company an assistant has something to say
about. A company that appears nowhere but its own website is one an assistant
cannot describe, and so does not recommend.

Your searches are how we measure that. We need to find the pages written about
each company by somebody other than the company itself. The count and the kind
of pages we find is the measurement, so a search that finds nothing real is a
company scored as invisible when it may not be.

What a good search finds:
- reviews and ratings on software or hardware directories
- "X vs Y" and "alternatives to X" comparison articles
- industry press, trade publications, funding and acquisition news
- forum and community threads where buyers discuss it
- conference talks, award listings, analyst mentions, video coverage

What a good search does not do: look for the company's own website. We already
have that, and a company describing itself is not evidence anybody noticed.

Write exactly 3 searches for every company you are given. Not fewer.

- Every search must contain the company name, or a result cannot be checked.
- Every search must carry a word that pins down which company this is. Names
  collide: "Vintra" alone returns an investment firm and a chatbot vendor, and
  both would be counted as this company being mentioned.
- Aim where this particular industry gets covered. A factory safety camera
  vendor is written about in different places than a payroll product.
- Site filters are allowed and often the sharpest tool: site:reddit.com,
  site:g2.com, site:youtube.com, site:news.ycombinator.com.
- Under ten words each. These go to a search engine, not to a person.
- Do not repeat anything in existing_queries.

Return only the required JSON object.
"""

PRESENCE_QUERY_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "queries": {
            "type": "array",
            "items": {"type": "string"},
            "maxItems": 3,
        }
    },
    "required": ["queries"],
}

MAX_MODEL_QUERIES_PER_COMPANY = 3
MAX_QUERY_WORDS = 10
# One call per company, all at once. Six small calls finish in about the time
# one call for six took, and none of them can leave a company out.
PRESENCE_QUERY_CONCURRENCY = 6


def generate_presence_queries(
    company_profile: dict[str, Any],
    entities: list[dict[str, Any]],
    existing_queries: dict[str, list[dict[str, str]]],
) -> tuple[dict[str, list[dict[str, str]]], dict[str, Any]]:
    """Searches written for these companies rather than filled into a template.

    The three templates look for the official website and Reddit. That finds
    where a company talks about itself, which is close to the opposite of what
    this step measures: whether anybody else does. On a live audit the audited
    company scored one verified mention — its own About page — while rivals
    with Wikipedia entries and press coverage scored five.

    One call covers every company. Whatever comes back is checked here, and the
    template queries run regardless, so a bad or missing response can only lose
    the extra searches, never the baseline.
    """
    accepted: dict[str, list[dict[str, str]]] = {}
    rejected: list[dict[str, str]] = []
    errors: list[dict[str, str]] = []

    workers = max(1, min(len(entities) or 1, PRESENCE_QUERY_CONCURRENCY))
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {
            executor.submit(
                presence_queries_for_company,
                company_profile,
                entity,
                existing_queries.get(str(entity.get("company_name")), []),
            ): str(entity.get("company_name"))
            for entity in entities
        }
        for future in as_completed(futures):
            name = futures[future]
            try:
                queries, problems = future.result()
            except Exception as exc:  # noqa: BLE001 - keep the audit running.
                errors.append({"company_name": name, "error": str(exc)})
                continue
            rejected.extend(problems)
            if queries:
                accepted[name] = queries

    diagnostics = {
        "requested": len(entities),
        "companies_answered": len(accepted),
        "accepted": sum(len(rows) for rows in accepted.values()),
        "rejected": rejected,
        "errors": errors,
    }
    return accepted, diagnostics


def presence_queries_for_company(
    company_profile: dict[str, Any],
    entity: dict[str, Any],
    existing: list[dict[str, str]],
) -> tuple[list[dict[str, str]], list[dict[str, str]]]:
    """Searches for one company, in a call that knows about no other.

    Asking for all six at once produced three companies on one run and one on
    another, from identical input. Telling it to cover every company did not
    stick — the same failure this codebase has hit before with instructions
    that describe the shape of an answer. A call that has been given a single
    company cannot skip a company.
    """
    name = str(entity.get("company_name", "")).strip()
    request = {
        "company_name": name,
        "industry": company_profile.get("category"),
        "is_the_audited_company": entity.get("entity_type") == "user_company",
        "what_this_industry_does": company_profile.get(
            "unique_value_proposition"
        ),
        "existing_queries": [query["query"] for query in existing],
    }
    payload = build_chat_payload(
        PRESENCE_QUERY_SYSTEM_PROMPT,
        json.dumps(request, ensure_ascii=False),
        json_response=True,
    )
    payload["response_format"] = {
        "type": "json_schema",
        "json_schema": {
            "name": "presence_queries",
            "strict": True,
            "schema": PRESENCE_QUERY_SCHEMA,
        },
    }
    try:
        response = extract_json_object(call_chat_completion(payload))
    except (LLMNotConfigured, RuntimeError, ValueError, JSONDecodeError) as exc:
        return [], [{"company_name": name, "reason": f"call_failed: {exc}"}]

    seen = {query["query"].lower() for query in existing}
    queries: list[dict[str, str]] = []
    problems: list[dict[str, str]] = []
    for text in response.get("queries", []):
        query = " ".join(str(text or "").split())
        reason = presence_query_problem(query, name, seen)
        if reason:
            problems.append(
                {"company_name": name, "query": query, "reason": reason}
            )
            continue
        seen.add(query.lower())
        queries.append({"query_type": "presence", "query": query})
    return queries[:MAX_MODEL_QUERIES_PER_COMPANY], problems


def presence_query_problem(
    query: str,
    company_name: str,
    seen: set[str],
) -> str | None:
    """Why a written search cannot be used, or None when it can."""
    if not query:
        return "empty"
    if query.lower() in seen:
        return "duplicate"
    if len(query.split()) > MAX_QUERY_WORDS:
        return "too_long"
    # Without the company name there is nothing to check a result against, and
    # this step's whole verification is "does the page name this company".
    if not any(
        contains_phrase(query, alias) for alias in company_aliases(company_name)
    ):
        return "missing_company_name"
    return None


def build_search_queries(
    company_name: str,
    company_profile: dict[str, Any],
    prompts: list[dict[str, Any]],
    raw_results: list[dict[str, Any]],
) -> list[dict[str, str]]:
    canonical = preferred_company_name(company_name)
    category = clean_search_phrase(str(company_profile.get("category", "")), 3)
    use_case = best_use_case(company_profile, prompts_for_company(company_name, raw_results))
    context = use_case or category

    queries = [
        {
            "query_type": "official",
            "query": f'"{canonical}" official website',
        },
        {
            "query_type": "category",
            "query": join_query(canonical, category),
        },
    ]
    if context and context.lower() != category.lower():
        queries.append(
            {
                "query_type": "use_case",
                "query": join_query(canonical, context),
            }
        )
    queries.append(
        {
            "query_type": "community",
            "query": f'site:reddit.com "{canonical}"',
        }
    )
    return dedupe_queries(queries)


def build_bounded_search_queries(
    entity: dict[str, Any],
    company_profile: dict[str, Any],
    prompts: list[dict[str, Any]],
    raw_results: list[dict[str, Any]],
) -> list[dict[str, str]]:
    queries = build_search_queries(
        str(entity["company_name"]),
        company_profile,
        prompts,
        raw_results,
    )
    by_type = {query["query_type"]: query for query in queries}
    query_types = (
        ("official", "category", "community")
        if entity.get("entity_type") == "user_company"
        else ("official", "category", "community")
    )
    selected = [by_type[kind] for kind in query_types if kind in by_type]
    return selected or queries[:2]


def select_fetch_candidates(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    selected = []
    counts: dict[tuple[str, str], int] = {}
    seen: set[tuple[str, str]] = set()
    for row in sorted(rows, key=lambda item: int(item.get("search_rank", 999))):
        group = (str(row.get("company_name")), str(row.get("query")))
        key = (str(row.get("company_name")), canonical_url(str(row.get("url", ""))))
        if key in seen or counts.get(group, 0) >= VERIFIED_RESULTS_PER_QUERY:
            continue
        seen.add(key)
        counts[group] = counts.get(group, 0) + 1
        selected.append(row)
    return selected


SAME_COMPANY_SYSTEM_PROMPT = """You decide whether a web page is about a
particular company, or about a different company that happens to share its
name.

We are counting how often a company is written about on the web. A page that
carries the name but belongs to somebody else inflates that count, and the
company is then told it has a web presence it does not have.

You are given a company, what its industry is, and a list of pages: address,
title and an extract. For each page, say whether it is about this company.

- Same name, different business is the thing to catch. An investment firm and
  a video analytics vendor can both be called Vintra.
- A page can be about the company without being flattering or detailed. A
  forum thread asking "has anyone used them" counts.
- A page that only lists the name among many others still counts, as long as
  it is this company being listed.
- When the page gives you nothing to tell the two apart, answer false. An
  uncounted real mention is a smaller error than a counted false one.

Return only the required JSON object.
"""

SAME_COMPANY_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "pages": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "url": {"type": "string"},
                    "is_this_company": {"type": "boolean"},
                    "reason": {"type": "string"},
                },
                "required": ["url", "is_this_company", "reason"],
            },
        }
    },
    "required": ["pages"],
}

# Two industry words on a page is enough to settle it without asking a model.
CLEAR_CONTEXT_MATCHES = 2
GATE_EXTRACT_LENGTH = 300


def gate_entity_mentions(
    entity_rows: list[dict[str, Any]],
    company_profile: dict[str, Any],
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Keep only the pages that are about the company they were found for.

    Until now the single test was whether the name appeared on the page, which
    is how an investment firm at vintracapital.com and a chatbot vendor at
    vintranordic.com were both counted as mentions of Vintra, a video
    analytics company. Under a measurement of how widely a company is written
    about, a wrong page does not merely add noise — it moves the number being
    reported.

    Cheap signals settle most pages: their own domain, or the industry showing
    up in the text. Only what is left over is worth asking a model about.
    """
    decided: dict[str, tuple[bool, str]] = {}
    ambiguous: list[dict[str, Any]] = []

    for entity in entity_rows:
        for row in entity.get("verified_mentions", []):
            key = f"{entity['company_name']}|{row.get('url')}"
            # Matching the resolved official domain is deliberately not a free
            # pass. That domain is itself a guess made from name similarity,
            # and on a live run it resolved Vintra, a video analytics company,
            # to vintracapital.com. Trusting it here would have waved the
            # investment firm straight through on the strongest signal we have.
            if len(row.get("matched_context_terms", [])) >= CLEAR_CONTEXT_MATCHES:
                decided[key] = (True, "industry_context_on_page")
            else:
                ambiguous.append({"entity": entity, "row": row, "key": key})

    model_calls = 0
    if ambiguous:
        by_company: dict[str, list[dict[str, Any]]] = {}
        for item in ambiguous:
            by_company.setdefault(str(item["entity"]["company_name"]), []).append(item)
        workers = max(1, min(len(by_company), PRESENCE_QUERY_CONCURRENCY))
        with ThreadPoolExecutor(max_workers=workers) as executor:
            futures = {
                executor.submit(
                    confirm_same_company,
                    name,
                    company_profile,
                    [item["row"] for item in items],
                ): items
                for name, items in by_company.items()
            }
            model_calls = len(futures)
            for future in as_completed(futures):
                items = futures[future]
                try:
                    verdicts = future.result()
                except Exception:  # noqa: BLE001 - a failed check is not fatal.
                    verdicts = {}
                for item in items:
                    url = str(item["row"].get("url"))
                    if url in verdicts:
                        keep, reason = verdicts[url]
                        decided[item["key"]] = (keep, f"model:{reason}")
                    else:
                        # Nothing came back for this page. Keeping it would put
                        # an unchecked page into a count that is meant to be
                        # checked, so it is held back and said so.
                        decided[item["key"]] = (False, "unchecked")

    kept_rows = []
    dropped_rows = []
    for entity in entity_rows:
        kept = []
        dropped = []
        for row in entity.get("verified_mentions", []):
            key = f"{entity['company_name']}|{row.get('url')}"
            keep, reason = decided.get(key, (False, "unchecked"))
            if keep:
                kept.append({**row, "accepted_because": reason})
            else:
                dropped.append(
                    {
                        "company_name": entity["company_name"],
                        "url": row.get("url"),
                        "domain": row.get("domain"),
                        "title": row.get("title"),
                        "reason": reason,
                    }
                )
        entity["verified_mentions"] = kept
        # Kept beside the entity so "no mentions found" can be told apart from
        # "mentions found and thrown away".
        entity["rejected_mentions"] = dropped
        kept_rows.extend(kept)
        dropped_rows.extend(dropped)

    return entity_rows, {
        "checked": len(kept_rows) + len(dropped_rows),
        "kept": len(kept_rows),
        "dropped": len(dropped_rows),
        "settled_without_a_model": len(kept_rows) + len(dropped_rows) - len(ambiguous),
        "model_calls": model_calls,
        "dropped_pages": dropped_rows[:25],
    }


def confirm_same_company(
    company_name: str,
    company_profile: dict[str, Any],
    rows: list[dict[str, Any]],
) -> dict[str, tuple[bool, str]]:
    """One call per company, covering every unclear page found for it."""
    pages = [
        {
            "url": row.get("url"),
            "title": row.get("title"),
            "extract": str(row.get("snippet") or "")[:GATE_EXTRACT_LENGTH],
        }
        for row in rows
    ]
    request = {
        "company_name": company_name,
        "industry": company_profile.get("category"),
        "what_this_industry_does": company_profile.get(
            "unique_value_proposition"
        ),
        "pages": pages,
    }
    payload = build_chat_payload(
        SAME_COMPANY_SYSTEM_PROMPT,
        json.dumps(request, ensure_ascii=False),
        json_response=True,
    )
    payload["response_format"] = {
        "type": "json_schema",
        "json_schema": {
            "name": "same_company",
            "strict": True,
            "schema": SAME_COMPANY_SCHEMA,
        },
    }
    response = extract_json_object(call_chat_completion(payload))
    verdicts: dict[str, tuple[bool, str]] = {}
    for item in response.get("pages", []):
        if not isinstance(item, dict):
            continue
        url = str(item.get("url", "")).strip()
        if url:
            verdicts[url] = (
                bool(item.get("is_this_company")),
                str(item.get("reason", ""))[:200],
            )
    return verdicts


def verify_search_result(
    row: dict[str, Any],
    *,
    company_profile: dict[str, Any],
) -> dict[str, Any] | None:
    html, status_code, final_url = fetch_html(str(row["url"]))
    if status_code < 200 or status_code >= 400:
        return None
    parsed = parse_page(final_url, html, status_code)
    page_text = " ".join(
        [
            str(parsed.get("title", "")),
            str(parsed.get("meta_description", "")),
            str(row.get("snippet", "")),
            str(parsed.get("main_text", ""))[:25000],
        ]
    )
    aliases = company_aliases(str(row["company_name"]))
    matched_alias = next(
        (alias for alias in aliases if contains_phrase(page_text, alias)),
        None,
    )
    if not matched_alias:
        return None

    context_terms = build_context_terms(company_profile)
    context_matches = [
        term for term in context_terms if contains_phrase(page_text, term)
    ]
    source_type = classify_source_url(final_url)
    relevance_score = min(
        100,
        55
        + min(25, len(context_matches) * 5)
        + (10 if matched_alias.lower() in str(parsed.get("title", "")).lower() else 0)
        + (5 if source_type in {"community", "review_platform", "news_or_blog"} else 0),
    )
    return {
        "company_name": row["company_name"],
        "url": canonical_url(final_url),
        "domain": domain_from_url(final_url),
        "title": parsed.get("title") or row.get("title"),
        "snippet": row.get("snippet", ""),
        "query": row.get("query"),
        "query_type": row.get("query_type"),
        "search_rank": row.get("search_rank"),
        "search_provider": row.get("search_provider"),
        "source_type": source_type,
        "matched_alias": matched_alias,
        "matched_context_terms": context_matches[:8],
        "relevance_score": relevance_score,
        "http_status": status_code,
        "verified": True,
        "retrieved_at": datetime.now(timezone.utc).isoformat(),
        "provenance": "independent_web_search",
    }


def prompts_for_company(
    company_name: str,
    raw_results: list[dict[str, Any]],
) -> list[str]:
    prompts = []
    for result in raw_results:
        if any(
            same_company(company_name, str(item.get("company_name", "")))
            for item in result.get("recommended_companies", [])
        ):
            prompt = str(result.get("prompt", "")).strip()
            if prompt:
                prompts.append(prompt)
    return list(dict.fromkeys(prompts))


def best_use_case(
    company_profile: dict[str, Any],
    company_prompts: list[str],
) -> str:
    use_cases = company_profile.get("use_cases", [])
    if isinstance(use_cases, list) and use_cases:
        return clean_search_phrase(str(use_cases[0]), 10)
    if company_prompts:
        return clean_search_phrase(company_prompts[0], 10)
    return ""


def build_context_terms(company_profile: dict[str, Any]) -> list[str]:
    values: list[str] = []
    category = str(company_profile.get("category", "")).strip()
    if category:
        values.append(category)
    for key in ("keywords", "industries"):
        items = company_profile.get(key, [])
        if isinstance(items, list):
            values.extend(str(item).strip() for item in items[:8])
    return [
        value
        for value in dict.fromkeys(values)
        if value and value.lower() not in CONTEXT_STOP_WORDS
    ]


def company_aliases(company_name: str) -> list[str]:
    normalized = " ".join(company_name.lower().split())
    known = KNOWN_ALIASES.get(normalized, [])
    aliases = [company_name, *known]
    words = re.findall(r"[A-Za-z0-9]+", company_name)
    if len(words) >= 2:
        acronym = "".join(word[0] for word in words if word)
        if len(acronym) >= 2:
            aliases.append(acronym)
    return list(dict.fromkeys(alias.strip() for alias in aliases if alias.strip()))


def preferred_company_name(company_name: str) -> str:
    aliases = company_aliases(company_name)
    return max(aliases, key=len)


def same_company(left: str, right: str) -> bool:
    left_aliases = {alias.lower() for alias in company_aliases(left)}
    right_aliases = {alias.lower() for alias in company_aliases(right)}
    return bool(left_aliases & right_aliases)


def clean_search_phrase(value: str, max_words: int) -> str:
    words = re.findall(r"[A-Za-z0-9][A-Za-z0-9+.-]*", value)
    cleaned = [word for word in words if word.lower() not in CONTEXT_STOP_WORDS]
    return " ".join(cleaned[:max_words])


def join_query(company_name: str, context: str) -> str:
    if not context:
        return f'"{company_name}"'
    return f'"{company_name}" {context}'


def dedupe_queries(queries: list[dict[str, str]]) -> list[dict[str, str]]:
    seen = set()
    deduped = []
    for query in queries:
        normalized = query["query"].lower()
        if normalized in seen:
            continue
        seen.add(normalized)
        deduped.append(query)
    return deduped


def contains_phrase(text: str, phrase: str) -> bool:
    if not phrase:
        return False
    return bool(
        re.search(
            rf"(?<![A-Za-z0-9]){re.escape(phrase)}(?![A-Za-z0-9])",
            text,
            flags=re.IGNORECASE,
        )
    )


def canonical_url(url: str) -> str:
    parsed = urlparse(url)
    path = parsed.path or "/"
    return parsed._replace(fragment="", query="", path=path).geturl().rstrip("/")


def empty_summary(entity_count: int) -> dict[str, Any]:
    return {
        "entities_checked": entity_count,
        "queries_run": 0,
        "search_errors": 0,
        "provider_queries": {},
        "fallback_queries": 0,
        "verified_mentions": 0,
        "official_websites_resolved": 0,
    }


def append_error_log(
    error_log_path: str | Path | None,
    error: dict[str, Any],
) -> None:
    if error_log_path is None:
        return
    path = Path(error_log_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(error, ensure_ascii=False) + "\n")
