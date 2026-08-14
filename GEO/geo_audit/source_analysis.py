from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from .netguard import open_url_guarded


SOURCE_TYPE_RULES = (
    ("provider_redirect", ("vertexaisearch.cloud.google.com",)),
    ("review_platform", ("g2.com", "capterra.com", "trustradius.com")),
    ("analyst_or_report", ("gartner.com", "forrester.com", "report", "whitepaper")),
    ("developer_source", ("github.com", "docs.", "/docs", "developer.", "api.")),
    ("community", ("reddit.com", "news.ycombinator.com", "stackoverflow.com")),
    ("social_or_video", ("linkedin.com", "youtube.com", "facebook.com", "twitter.com", "x.com")),
    ("encyclopedia", ("wikipedia.org",)),
    ("news_or_blog", ("blog", "news", "techcrunch.com", "forbes.com", "medium.com")),
)


def analyze_sources(
    urls: list[str],
    *,
    official_domain: str | None = None,
) -> dict[str, Any]:
    normalized_urls = normalize_source_urls(urls)
    redirect_mappings = [
        {"original_url": original, "resolved_url": resolved}
        for original, resolved in zip(urls, normalized_urls)
        if original != resolved
    ]
    domain_counts = Counter(domain_from_url(url) for url in normalized_urls)
    type_counts = Counter(
        classify_source_url(url, official_domain=official_domain)
        for url in normalized_urls
    )

    domains = [
        {
            "domain": domain,
            "count": count,
            "type": classify_domain(domain, official_domain=official_domain),
            "sample_urls": [
                url for url in normalized_urls if domain_from_url(url) == domain
            ][:5],
        }
        for domain, count in domain_counts.most_common()
    ]

    return {
        "total_source_urls": len(normalized_urls),
        "unique_domains": len(domain_counts),
        "redirect_mappings": redirect_mappings[:25],
        "source_type_counts": [
            {"type": source_type, "count": count}
            for source_type, count in type_counts.most_common()
        ],
        "domains": domains,
    }


def build_global_source_analysis(
    competitors: list[dict[str, Any]],
) -> dict[str, Any]:
    domain_counts: Counter[str] = Counter()
    type_counts: Counter[str] = Counter()
    competitor_source_rows = []

    for competitor in competitors:
        company_name = competitor.get("company_name", "Unknown")
        source_urls = competitor.get("source_urls", [])
        analysis = analyze_sources(source_urls)
        competitor_source_rows.append(
            {
                "company_name": company_name,
                "mention_frequency": competitor.get("mention_frequency", 0),
                "source_frequency": competitor.get("source_frequency", 0),
                "source_analysis": analysis,
            }
        )
        for domain in analysis["domains"]:
            domain_counts[domain["domain"]] += domain["count"]
            type_counts[domain["type"]] += domain["count"]

    return {
        "top_domains": [
            {"domain": domain, "count": count}
            for domain, count in domain_counts.most_common(25)
            if classify_domain(domain) != "provider_redirect"
        ],
        "provider_redirect_domains": [
            {"domain": domain, "count": count}
            for domain, count in domain_counts.most_common(25)
            if classify_domain(domain) == "provider_redirect"
        ],
        "source_type_counts": [
            {"type": source_type, "count": count}
            for source_type, count in type_counts.most_common()
        ],
        "competitors": competitor_source_rows,
    }


def classify_source_url(url: str, *, official_domain: str | None = None) -> str:
    domain = domain_from_url(url)
    if official_domain and same_or_subdomain(domain, normalize_domain(official_domain)):
        return "official_site"

    lower_url = url.lower()
    for source_type, markers in SOURCE_TYPE_RULES:
        if any(marker in lower_url for marker in markers):
            return source_type
    return "other_source"


def normalize_source_urls(urls: list[str]) -> list[str]:
    normalized = []
    for url in urls:
        if not is_http_url(url):
            continue
        normalized.append(resolve_source_url(url))
    return normalized


_RESOLVE_CACHE: dict[str, str] = {}


def resolve_source_url(url: str) -> str:
    if url in _RESOLVE_CACHE:
        return _RESOLVE_CACHE[url]

    if domain_from_url(url) != "vertexaisearch.cloud.google.com":
        _RESOLVE_CACHE[url] = url
        return url

    try:
        final_url, _, _ = open_url_guarded(
            url,
            timeout=12,
            max_bytes=256 * 1024,
            headers={"User-Agent": "GEOAuditBot/0.1 (+https://example.local/audit)"},
        )
    except (HTTPError, URLError, TimeoutError, ValueError, OSError):
        final_url = url

    _RESOLVE_CACHE[url] = final_url
    return final_url


def verify_source_url(
    url: str,
    *,
    match_terms: tuple[str, ...] = (),
) -> dict[str, Any]:
    """Check a cited URL loads. When match_terms are supplied, also report
    whether the fetched page actually names the audited company."""
    if not is_http_url(url):
        return {
            "url": url,
            "verified": False,
            "error": "Not an HTTP(S) URL.",
        }
    try:
        # AI answers cite arbitrary URLs; every one is untrusted input and
        # goes through the network guard (public addresses only, capped body).
        final_url, response_headers, body = open_url_guarded(
            url,
            timeout=12,
            max_bytes=MAX_VERIFY_BYTES,
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 Chrome/126.0 Safari/537.36 GEOAuditBot/0.2"
                ),
                "Accept": "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.5",
            },
        )
        status = 200
        content_type = response_headers.get("Content-Type", "")
        valid_content = (
            "text/html" in content_type
            or "application/xhtml+xml" in content_type
            or "application/pdf" in content_type
        )
        mentions_company = None
        if match_terms and valid_content and "text/html" in content_type:
            mentions_company = page_mentions_terms(body, match_terms)
        return {
            "url": url,
            "resolved_url": final_url,
            "verified": 200 <= status < 400 and valid_content,
            "http_status": status,
            "content_type": content_type,
            "mentions_company": mentions_company,
            "checked_at": datetime.now(timezone.utc).isoformat(),
            "error": None
            if valid_content
            else f"Unsupported content type: {content_type}",
        }
    except (HTTPError, URLError, TimeoutError, ValueError, OSError) as exc:
        return {
            "url": url,
            "verified": False,
            "checked_at": datetime.now(timezone.utc).isoformat(),
            "error": str(exc),
        }


MAX_VERIFY_BYTES = 400_000


def page_mentions_terms(body: bytes, match_terms: tuple[str, ...]) -> bool:
    """Does this page name the company anywhere in its readable text?"""
    try:
        text = body.decode("utf-8", errors="ignore").lower()
    except (UnicodeDecodeError, AttributeError):
        return False
    return any(term.strip().lower() in text for term in match_terms if term.strip())


def classify_domain(domain: str, *, official_domain: str | None = None) -> str:
    normalized = normalize_domain(domain)
    if official_domain and same_or_subdomain(normalized, normalize_domain(official_domain)):
        return "official_site"

    for source_type, markers in SOURCE_TYPE_RULES:
        if any(marker in normalized for marker in markers):
            return source_type
    return "other_source"


def domain_from_url(url: str) -> str:
    return normalize_domain(urlparse(url).netloc)


def normalize_domain(domain: str) -> str:
    parsed = urlparse(domain if "://" in domain else f"https://{domain}")
    value = (parsed.netloc or parsed.path).lower().strip()
    if value.startswith("www."):
        value = value[4:]
    return value.split(":")[0]


def same_or_subdomain(domain: str, parent: str) -> bool:
    return domain == parent or domain.endswith(f".{parent}")


def is_http_url(url: str) -> bool:
    parsed = urlparse(url)
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)
