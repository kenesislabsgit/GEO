from __future__ import annotations

from typing import Any
from urllib.parse import urlparse

from .crawler import crawl_website
from .evidence import build_website_evidence
from .firecrawl import (
    FirecrawlClient,
    FirecrawlError,
    environment_int,
    firecrawl_document_to_page,
)
from .site_discovery import discover_competitor_site
from .source_analysis import analyze_sources


def build_competitor_evidence(
    patterns: dict[str, Any],
    *,
    competitor_sites: dict[str, str] | None = None,
    web_presence: dict[str, Any] | None = None,
    max_pages: int = 8,
    crawl_limit: int | None = None,
    firecrawl_client: FirecrawlClient | None = None,
) -> dict[str, Any]:
    """crawl_limit caps how many of the recurring competitors get their website
    read. The free audit reads only the most-recommended one; the rest are still
    listed from the AI answers and their citations."""
    competitor_sites = competitor_sites or {}
    web_presence = web_presence or {}
    evidence_items = []

    firecrawl_competitor_limit = environment_int(
        "FIRECRAWL_MAX_COMPETITORS_PER_AUDIT", 5
    )
    firecrawl_page_limit = environment_int(
        "FIRECRAWL_MAX_PAGES_PER_COMPETITOR", 4
    )

    for competitor_index, competitor in enumerate(
        patterns.get("top_competitors", [])
    ):
        name = competitor.get("company_name", "Unknown")
        cited_urls = competitor.get("source_urls", [])
        presence = find_web_presence(name, web_presence)
        verified_mentions = presence.get("verified_mentions", [])
        verified_urls = [
            str(row.get("url"))
            for row in verified_mentions
            if row.get("verified") and row.get("url")
        ]
        manual_site = find_competitor_site(name, competitor_sites)
        site_discovery = discover_competitor_site(
            name,
            [*cited_urls, *verified_urls],
            manual_site=manual_site,
        )
        site_url = presence.get("official_website") or site_discovery.get(
            "official_website"
        )

        item: dict[str, Any] = {
            "company_name": name,
            "recommendation_pattern": {
                "mention_frequency": competitor.get("mention_frequency", 0),
                "average_rank": competitor.get("average_rank"),
                "models": competitor.get("models", []),
                "citation_frequency": competitor.get("citation_frequency", 0),
                "source_urls": cited_urls,
                "sample_reasoning": competitor.get("sample_reasoning", []),
            },
            "website_url": site_url or "Unknown",
            "site_discovery": site_discovery,
            "website_snapshot": None,
            "website_evidence": None,
            "source_analysis": analyze_sources(cited_urls, official_domain=site_url),
            "verified_web_mentions": verified_mentions,
            "web_presence_summary": {
                "verified_mentions": len(verified_mentions),
                "source_types": sorted(
                    {
                        str(row.get("source_type", "other_source"))
                        for row in verified_mentions
                    }
                ),
            },
            "external_authority_evidence": classify_external_sources(
                verified_urls,
                official_domain=site_url,
            ),
            "collection_status": "citation_only",
            "firecrawl_enhancement": {
                "attempted": False,
                "pages_added": 0,
                "errors": [],
            },
        }

        may_crawl = crawl_limit is None or competitor_index < crawl_limit
        if site_url and max_pages > 0 and may_crawl:
            snapshot = empty_snapshot(site_url)
            try:
                snapshot = crawl_website(site_url, max_pages=max_pages)
            except Exception as exc:  # noqa: BLE001 - keep audit running.
                snapshot["failed_pages"].append(
                    {"url": site_url, "error": str(exc)}
                )

            initial_evidence = build_website_evidence(snapshot)
            if (
                firecrawl_client is not None
                and competitor_index < firecrawl_competitor_limit
                and should_enhance_with_firecrawl(snapshot, initial_evidence)
            ):
                snapshot, enhancement = enhance_competitor_snapshot(
                    firecrawl_client,
                    site_url,
                    snapshot,
                    initial_evidence,
                    max_pages=max(0, min(firecrawl_page_limit, max_pages)),
                    cited_urls=cited_urls,
                )
                item["firecrawl_enhancement"] = enhancement

            item["website_snapshot"] = snapshot
            if snapshot.get("pages"):
                item["website_evidence"] = build_website_evidence(snapshot)
                item["collection_status"] = "website_and_citations"
                if item["firecrawl_enhancement"]["pages_added"]:
                    item["collection_status"] = (
                        "website_and_citations_firecrawl_enhanced"
                    )
            else:
                item["collection_status"] = "website_failed"
                item["collection_error"] = (
                    "No pages crawled from discovered website."
                )
        elif site_url:
            item["collection_status"] = "citation_only_with_discovered_site"

        evidence_items.append(item)

    return {
        "summary": {
            "competitors_checked": len(evidence_items),
            "with_website_evidence": sum(
                1 for item in evidence_items if item["website_evidence"]
            ),
            "citation_only": sum(
                1 for item in evidence_items if item["collection_status"] == "citation_only"
            ),
            "firecrawl_enhanced": sum(
                1
                for item in evidence_items
                if item.get("firecrawl_enhancement", {}).get("pages_added", 0)
            ),
        },
        "competitors": evidence_items,
        "firecrawl": (
            firecrawl_client.usage_summary()
            if firecrawl_client is not None
            else {"enabled": False}
        ),
    }


IMPORTANT_EVIDENCE_FIELDS = (
    "feature_pages_found",
    "use_case_pages_found",
    "testimonials_or_case_studies_found",
    "faq_page_found",
    "pricing_page_found",
    "documentation_found",
)

FIELD_URL_KEYWORDS = {
    "use_case_pages_found": ("use-case", "use-cases", "solution", "industry"),
    "feature_pages_found": ("feature", "features", "product", "platform"),
    "pricing_page_found": ("pricing", "plans"),
    "faq_page_found": ("faq", "questions"),
    "testimonials_or_case_studies_found": (
        "customer",
        "case-study",
        "case-studies",
        "testimonial",
    ),
    "documentation_found": ("docs", "documentation", "developer", "api"),
}


def should_enhance_with_firecrawl(
    snapshot: dict[str, Any],
    evidence: dict[str, Any],
) -> bool:
    pages = snapshot.get("pages", [])
    useful_text = sum(
        len(str(page.get("main_text", "")).strip())
        for page in pages
    )
    if not pages or useful_text < 1000:
        return True
    return any(
        not evidence_field_has_fetched_page(snapshot, evidence, field)
        for field in IMPORTANT_EVIDENCE_FIELDS
    )


def enhance_competitor_snapshot(
    client: FirecrawlClient,
    site_url: str,
    snapshot: dict[str, Any],
    evidence: dict[str, Any],
    *,
    max_pages: int,
    cited_urls: list[str] | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    result: dict[str, Any] = {
        "attempted": True,
        "pages_added": 0,
        "mapped_urls": 0,
        "errors": [],
    }
    if max_pages <= 0 or not client.can_request():
        return snapshot, result

    missing_fields = [
        field
        for field in IMPORTANT_EVIDENCE_FIELDS
        if not evidence_field_has_fetched_page(snapshot, evidence, field)
    ]
    try:
        mapped = client.map_site(site_url, limit=30)
        result["mapped_urls"] = len(mapped)
    except FirecrawlError as exc:
        mapped = []
        result["errors"].append({"operation": "map", "error": str(exc)})
    mapped.extend(
        {
            "url": str(match.get("url", "")),
            "title": str(match.get("text", "")),
        }
        for field in missing_fields
        for match in (evidence.get(field) or {}).get("matches", [])
        if match.get("url")
    )

    existing = {
        canonical_url(str(page.get("url", "")))
        for page in snapshot.get("pages", [])
    }
    candidates = priority_firecrawl_urls(
        site_url,
        mapped,
        missing_fields,
        existing,
        weak_snapshot=not snapshot.get("pages"),
        cited_urls=cited_urls,
    )
    if not candidates and not snapshot.get("pages"):
        candidates = [site_url]

    for url in candidates[:max_pages]:
        if not client.can_request():
            break
        try:
            document = client.scrape(url)
            page = firecrawl_document_to_page(document, url)
        except FirecrawlError as exc:
            result["errors"].append(
                {"operation": "scrape", "url": url, "error": str(exc)}
            )
            continue
        key = canonical_url(str(page.get("url", "")))
        if not key or key in existing:
            continue
        existing.add(key)
        snapshot.setdefault("pages", []).append(page)
        result["pages_added"] += 1
    return snapshot, result


def priority_firecrawl_urls(
    site_url: str,
    mapped: list[dict[str, str]],
    missing_fields: list[str],
    existing: set[str],
    *,
    weak_snapshot: bool,
    cited_urls: list[str] | None = None,
) -> list[str]:
    """Which of a competitor's pages to read, best first.

    The pages the AI itself cited when recommending them come first. Those are
    its own answer to "why this company", so no keyword list we invent will
    beat them. Triya was recommended fourteen times off
    /solutions/on-premise-video-analytics and /use-cases/manufacturing, and we
    read neither, spending the budget on licence plate recognition instead.
    """
    candidates: list[tuple[int, str]] = []
    root_domain = urlparse(site_url).netloc.lower().removeprefix("www.")
    if weak_snapshot:
        candidates.append((0, site_url))
    for url in cited_urls or []:
        url = str(url).strip()
        domain = urlparse(url).netloc.lower().removeprefix("www.")
        if url and domain == root_domain and canonical_url(url) not in existing:
            candidates.append((1, url))
    for row in mapped:
        url = str(row.get("url", "")).strip()
        domain = urlparse(url).netloc.lower().removeprefix("www.")
        if not url or domain != root_domain or canonical_url(url) in existing:
            continue
        haystack = f"{url} {row.get('title', '')}".lower()
        matching_positions = [
            index
            for index, field in enumerate(missing_fields)
            if any(term in haystack for term in FIELD_URL_KEYWORDS[field])
        ]
        if not matching_positions:
            continue
        candidates.append((10 + min(matching_positions), url))
    return dedupe_urls(
        url for _, url in sorted(candidates, key=lambda item: (item[0], item[1]))
    )


def empty_snapshot(site_url: str) -> dict[str, Any]:
    return {
        "input_url": site_url,
        "normalized_url": site_url,
        "domain": urlparse(site_url).netloc.lower(),
        "pages": [],
        "failed_pages": [],
    }


def evidence_field_has_fetched_page(
    snapshot: dict[str, Any],
    evidence: dict[str, Any],
    field: str,
) -> bool:
    fetched = {
        canonical_url(str(page.get("url", "")))
        for page in snapshot.get("pages", [])
    }
    return any(
        canonical_url(str(url)) in fetched
        for url in (evidence.get(field) or {}).get("urls", [])
    )


def canonical_url(value: str) -> str:
    return value.strip().rstrip("/").lower()


def dedupe_urls(values: Any) -> list[str]:
    rows = []
    seen = set()
    for value in values:
        key = canonical_url(str(value))
        if not key or key in seen:
            continue
        seen.add(key)
        rows.append(str(value))
    return rows


def find_competitor_site(name: str, competitor_sites: dict[str, str]) -> str | None:
    normalized_name = normalize_name(name)
    for key, value in competitor_sites.items():
        if normalize_name(key) == normalized_name:
            return value
    return None


def classify_external_sources(
    urls: list[str],
    *,
    official_domain: str | None = None,
) -> dict[str, Any]:
    source_analysis = analyze_sources(urls, official_domain=official_domain)
    categories = {
        "official_sites": [],
        "review_platforms": [],
        "analyst_or_reports": [],
        "industry_publications": [],
        "developer_sources": [],
        "communities": [],
        "news_or_blogs": [],
        "other_sources": [],
    }

    for url in urls:
        source_type = analyze_sources([url], official_domain=official_domain)[
            "source_type_counts"
        ]
        source_type_name = source_type[0]["type"] if source_type else "other_source"
        lower = url.lower()
        if source_type_name == "official_site":
            categories["official_sites"].append(url)
        elif source_type_name == "review_platform":
            categories["review_platforms"].append(url)
        elif source_type_name == "developer_source":
            categories["developer_sources"].append(url)
        elif source_type_name == "community":
            categories["communities"].append(url)
        elif source_type_name == "news_or_blog":
            categories["news_or_blogs"].append(url)
        elif source_type_name == "analyst_or_report":
            categories["analyst_or_reports"].append(url)
            categories["industry_publications"].append(url)
        elif any(term in lower for term in ("gartner", "forrester", "report", "review")):
            categories["industry_publications"].append(url)
        else:
            categories["other_sources"].append(url)

    return {
        **categories,
        "total_sources": len(urls),
        "source_analysis": source_analysis,
    }


def normalize_name(value: str) -> str:
    return " ".join(value.lower().split())


def find_web_presence(
    name: str,
    web_presence: dict[str, Any],
) -> dict[str, Any]:
    normalized_name = normalize_name(name)
    for entity in web_presence.get("entities", []):
        if normalize_name(str(entity.get("company_name", ""))) == normalized_name:
            return entity
    return {}

