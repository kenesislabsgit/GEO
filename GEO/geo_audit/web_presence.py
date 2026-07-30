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

from .agentcore_search import AGENTCORE_REGION, AgentCoreWebSearchClient
from .crawler import fetch_html, parse_page
from .llm import load_dotenv
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

    search_tasks = []
    for entity in entities:
        queries = build_bounded_search_queries(
            entity, company_profile, prompts, raw_results
        )
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
