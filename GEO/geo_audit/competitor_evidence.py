from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from typing import Any
from urllib.parse import urlparse

from .aggregation import canonical_company_key
from .crawler import crawl_website
from .evidence import build_website_evidence
from .firecrawl import (
    FirecrawlClient,
    FirecrawlError,
    environment_int,
    firecrawl_document_to_page,
    scrape_pages,
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
    """crawl_limit caps how many competitors get their website read. The free
    audit reads one; the rest are still listed from the AI answers and their
    citations. Which one it reads comes from `patterns["investigation_priority"]`
    — the company that placed best in the questions the audited company was
    missing from — not from whoever is named most often overall."""
    competitor_sites = competitor_sites or {}
    web_presence = web_presence or {}
    evidence_items = []

    firecrawl_competitor_limit = environment_int(
        "FIRECRAWL_MAX_COMPETITORS_PER_AUDIT", 5
    )
    firecrawl_page_limit = environment_int(
        "FIRECRAWL_MAX_PAGES_PER_COMPETITOR", 4
    )

    # Which websites are worth the crawl budget. `top_competitors` is ordered
    # by how often a name appears, which answers "who does AI recommend" and
    # not "who beat us". `investigation_priority` scores placement inside the
    # questions the audited company was missing from, so the one site a free
    # audit reads is the one that can actually explain a loss.
    investigation_order = [
        normalize_investigation_name(entry.get("company_name"))
        for entry in patterns.get("investigation_priority", [])
        if entry.get("company_name")
    ]
    crawl_names = (
        set(investigation_order[:crawl_limit])
        if crawl_limit is not None and investigation_order
        else None
    )

    def collect_one(
        competitor_index: int,
        competitor: dict[str, Any],
    ) -> dict[str, Any]:
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
        site_url = preferred_competitor_site(
            presence.get("official_website"),
            site_discovery.get("official_website"),
            cited_urls,
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

        if crawl_names is not None:
            may_crawl = normalize_investigation_name(name) in crawl_names
        else:
            may_crawl = crawl_limit is None or competitor_index < crawl_limit
        if site_url and max_pages > 0 and may_crawl:
            snapshot = empty_snapshot(site_url)
            try:
                snapshot = crawl_website(
                    site_url,
                    max_pages=max_pages,
                    time_budget_seconds=COMPETITOR_CRAWL_SECONDS,
                    max_failures=COMPETITOR_CRAWL_MAX_FAILURES,
                )
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
                # No model call here. Asked what each page was for, it returned
                # "Provides background information about the company, its
                # mission" for a page already titled "About Us | Calendly" -
                # the title reworded, at a call per competitor. The report
                # writer sees the title and opens the page when it needs more,
                # which costs nothing because the text is already in hand.
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

        return item

    # Five competitors were read one after another, and each one is a crawl of
    # somebody else's website: nothing about Triya has to finish before
    # Camlytics can start. The Firecrawl client counts its own budget behind a
    # lock, so a competitor that arrives after it is spent fails its scrapes
    # and keeps whatever the plain crawler found, exactly as before.
    competitors = list(patterns.get("top_competitors", []))
    listed = {
        normalize_investigation_name(item.get("company_name"))
        for item in competitors
    }
    # A company that won a question the audited company lost may still sit
    # outside the top five by mention count, and then never reach this loop at
    # all. Pull in the ones we intend to crawl so the budget can be spent on
    # them; the rest of the list is unchanged.
    if crawl_names:
        by_name = {
            normalize_investigation_name(item.get("company_name")): item
            for item in patterns.get("competitors", [])
        }
        for key in investigation_order[:crawl_limit]:
            if key in listed:
                continue
            extra = by_name.get(key)
            if extra:
                competitors.append(extra)
                listed.add(key)
    if competitors:
        with ThreadPoolExecutor(
            max_workers=max(1, min(COMPETITOR_CONCURRENCY, len(competitors)))
        ) as executor:
            evidence_items = list(
                executor.map(collect_one, range(len(competitors)), competitors)
            )

    # A competitor whose website was never found reads no pages, so it can
    # never be cited and never compared - while still sitting in the counts
    # and the competitor list as though it had been looked at. Rather than
    # crawl spare sites on every run to insure against that, the next
    # competitor down is read only when one actually came back empty.
    replacements = replacements_for_empty_competitors(
        evidence_items, patterns, listed
    )
    if replacements:
        with ThreadPoolExecutor(
            max_workers=max(1, min(COMPETITOR_CONCURRENCY, len(replacements)))
        ) as executor:
            evidence_items.extend(
                executor.map(
                    collect_one,
                    range(len(competitors), len(competitors) + len(replacements)),
                    replacements,
                )
            )

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


def replacements_for_empty_competitors(
    evidence_items: list[dict[str, Any]],
    patterns: dict[str, Any],
    already_listed: set[str],
) -> list[dict[str, Any]]:
    """Read the next rival down for each one that came back with nothing.

    Only the ones that came back with no pages at all matter here. A rival with
    two pages can still be quoted; a rival with none cannot be cited, cannot be
    compared, and yet still sits in the counts as though it had been looked at.

    The replacements come from the companies that beat the audited company in
    the questions it was missing from, before falling back to whoever was named
    most often. A company that won a lost question is the one the report needs
    to point at; the most-mentioned name may have won nothing.
    """
    empty = sum(
        1
        for item in evidence_items
        if not (item.get("website_snapshot") or {}).get("pages")
    )
    if not empty:
        return []
    ranked = [
        *patterns.get("investigation_priority", []),
        *patterns.get("top_competitors", []),
    ]
    picked: list[dict[str, Any]] = []
    seen = set(already_listed)
    by_name = {
        normalize_investigation_name(item.get("company_name")): item
        for item in patterns.get("top_competitors", [])
    }
    for entry in ranked:
        key = normalize_investigation_name(entry.get("company_name"))
        if not key or key in seen:
            continue
        candidate = by_name.get(key)
        if not candidate:
            continue
        seen.add(key)
        picked.append(candidate)
        if len(picked) >= empty:
            break
    return picked


# Reading five competitor websites at once. Each is an unrelated site, and
# the slow part is waiting on their servers rather than our own work.
COMPETITOR_CONCURRENCY = 5

# Every competitor site is read at the same time, so the step ends when the
# slowest one does. Measured on four real sites: two answered in under ten
# seconds, one took sixty-eight, and one reached its pages only after working
# through nineteen dead links.
#
# Thirty seconds rather than twenty, because twenty was measured to cost real
# evidence: the dead-link site returned one page at twenty seconds, two at
# thirty and all eight by forty-five. Below thirty a rival contributes nothing
# citable, which is a worse outcome than the wait.
#
# No separate cap on failures. One was tried at five and then twelve; both
# stopped that site before its pages appeared, while the clock alone bounds
# the damage just as well.
COMPETITOR_CRAWL_SECONDS = 30.0
COMPETITOR_CRAWL_MAX_FAILURES = None


def preferred_competitor_site(
    presence_site: str | None,
    discovered_site: str | None,
    cited_urls: list[str],
) -> str:
    """The site the AI was actually looking at when it recommended them.

    A web search for a company name is a guess, and a short name collides:
    searching "Triya" returned a doctor's website, which outranked the correct
    answer and would have had us quote a clinic as a video analytics rival.
    The AI cited triya.ai four times while recommending them, and a citation is
    evidence where a name match is a coincidence, so a candidate carrying a
    cited domain wins.
    """
    cited_domains = {
        urlparse(str(url)).netloc.lower().removeprefix("www.")
        for url in cited_urls or []
        if str(url).strip()
    }
    cited_domains.discard("")
    for candidate in (presence_site, discovered_site):
        if not candidate:
            continue
        domain = urlparse(str(candidate)).netloc.lower().removeprefix("www.")
        if domain in cited_domains:
            return str(candidate)
    return str(presence_site or discovered_site or "")
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

    for url, page, error in scrape_pages(client, candidates[:max_pages]):
        if error is not None:
            result["errors"].append(
                {"operation": "scrape", "url": url, "error": error}
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
    # Canonical, so "Kenesis Labs" here finds the research done under
    # "Kenesis" - the two names are one company.
    normalized_name = canonical_company_key(name)
    for entity in web_presence.get("entities", []):
        if canonical_company_key(str(entity.get("company_name", ""))) == normalized_name:
            return entity
    return {}



def normalize_investigation_name(value: Any) -> str:
    """Match company names between the priority list and the competitor rows.

    Both come from the same aggregation output, so a plain case and whitespace
    fold is enough — and is all that is wanted here. Anything looser would
    match "Axis" to "Axis Communications", which is the substring trap this
    codebase has already paid for three times.
    """
    return " ".join(str(value or "").lower().split())
