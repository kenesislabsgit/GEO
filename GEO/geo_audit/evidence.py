from __future__ import annotations

from typing import Any
from urllib.parse import urlparse


PAGE_KEYWORDS = {
    "use_case_pages_found": ("use-case", "use-cases", "solutions", "industries"),
    "feature_pages_found": ("feature", "features", "product", "products"),
    "pricing_page_found": ("pricing", "plans"),
    "faq_page_found": ("faq", "questions"),
    "documentation_found": ("docs", "documentation", "developer", "api"),
    "comparison_pages_found": ("compare", "comparison", "alternatives", "versus", "vs"),
    "testimonials_or_case_studies_found": (
        "customers",
        "case-study",
        "case-studies",
        "testimonial",
        "testimonials",
    ),
}

PAGE_EXCLUSIONS = {
    "feature_pages_found": ("pricing", "plans"),
}


def build_website_evidence(snapshot: dict[str, Any]) -> dict[str, Any]:
    pages = snapshot.get("pages", [])
    homepage = find_homepage(snapshot)
    all_links = collect_links(pages)

    page_flags = {
        field: find_matching_urls(
            all_links,
            keywords,
            excluded_keywords=PAGE_EXCLUSIONS.get(field, ()),
        )
        for field, keywords in PAGE_KEYWORDS.items()
    }

    homepage_h1 = first_heading(homepage, "h1")
    homepage_h2 = first_heading(homepage, "h2")

    return {
        "domain": snapshot.get("domain", "Unknown"),
        "source_snapshot": "website_snapshot.json",
        "homepage_url": homepage.get("url", "Unknown") if homepage else "Unknown",
        "homepage_headline": homepage_h1 or homepage.get("title", "Unknown") if homepage else "Unknown",
        "homepage_subheadline": homepage_h2 or "Unknown",
        "primary_cta": detect_primary_cta(homepage),
        "target_audience_clarity": score_clarity(homepage, audience_terms()),
        "industry_clarity": score_clarity(homepage, industry_terms()),
        "schema_json_ld_found": schema_summary(pages),
        "metadata_quality": metadata_quality(pages),
        "navigation_clarity": navigation_clarity(pages),
        **page_flags,
        "evidence_notes": build_notes(homepage, page_flags),
    }


def find_homepage(snapshot: dict[str, Any]) -> dict[str, Any]:
    pages = snapshot.get("pages", [])
    normalized_url = snapshot.get("normalized_url", "").rstrip("/")
    for page in pages:
        if page.get("url", "").rstrip("/") == normalized_url:
            return page
    return pages[0] if pages else {}


def collect_links(pages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    links: list[dict[str, Any]] = []
    for page in pages:
        links.extend(
            {**link, "fetched": False}
            for link in page.get("internal_links", [])
        )
        links.extend(
            {**link, "fetched": False}
            for link in page.get("navigation", [])
        )
        links.append(
            {
                "url": page.get("url", ""),
                "text": page.get("title", ""),
                "fetched": True,
                "fetch_provider": page.get("fetch_provider", "deterministic_crawler"),
                "excerpt": readable_excerpt(page.get("main_text", "")),
            }
        )
    deduped: dict[str, dict[str, Any]] = {}
    for link in links:
        url = link.get("url", "")
        if not url:
            continue
        current = deduped.get(url)
        if current is None or (link.get("fetched") and not current.get("fetched")):
            deduped[url] = dict(link)
    return list(deduped.values())


SKIP_LINK_PREFIXES = (
    "skip to main content",
    "skip to content",
    "skip to footer",
    "skip to navigation",
    "skip navigation",
    "accept all cookies",
    "cookie settings",
)


def readable_excerpt(main_text: Any, max_length: int = 320) -> str:
    """Page text without the accessibility skip-links and cookie banners that
    sit at the top of most pages. These excerpts are quoted in the report."""
    text = " ".join(str(main_text or "").split())
    changed = True
    while changed:
        changed = False
        lowered = text.lower()
        for prefix in SKIP_LINK_PREFIXES:
            if lowered.startswith(prefix):
                text = text[len(prefix) :].lstrip(" .:-|")
                changed = True
                break
    return text[:max_length]


def find_matching_urls(
    links: list[dict[str, Any]],
    keywords: tuple[str, ...],
    *,
    excluded_keywords: tuple[str, ...] = (),
) -> dict[str, Any]:
    matches = []
    for link in links:
        url = str(link.get("url", ""))
        text = str(link.get("text", "")).strip()
        parsed = urlparse(url)
        if parsed.path.rstrip("/") == "":
            continue
        haystack = f"{url} {text}".lower()
        if excluded_keywords and any(
            keyword in haystack for keyword in excluded_keywords
        ):
            continue
        if any(keyword in haystack for keyword in keywords):
            matches.append(
                {
                    "url": url,
                    "text": text,
                    "fetched": bool(link.get("fetched")),
                    "fetch_provider": link.get("fetch_provider"),
                    "excerpt": link.get("excerpt"),
                }
            )
    return {
        "found": bool(matches),
        "urls": [match["url"] for match in matches[:10]],
        "matches": matches[:10],
    }


def first_heading(page: dict[str, Any], level: str) -> str:
    headings = page.get("headings", {}).get(level, [])
    return headings[0] if headings else ""


def detect_primary_cta(page: dict[str, Any]) -> dict[str, str]:
    if not page:
        return {"found": False, "text": "Unknown", "url": "Unknown"}

    cta_terms = (
        "get started",
        "start free",
        "try",
        "book",
        "demo",
        "contact",
        "sign up",
        "request",
        "buy",
    )
    for link in page.get("internal_links", []) + page.get("navigation", []):
        text = link.get("text", "").strip()
        if text and any(term in text.lower() for term in cta_terms):
            return {"found": True, "text": text, "url": link.get("url", "Unknown")}
    return {"found": False, "text": "Unknown", "url": "Unknown"}


def score_clarity(page: dict[str, Any], terms: tuple[str, ...]) -> dict[str, Any]:
    if not page:
        return {"level": "Unknown", "matched_terms": []}

    text = " ".join(
        [
            page.get("title", ""),
            page.get("meta_description", ""),
            first_heading(page, "h1"),
            first_heading(page, "h2"),
            page.get("main_text", "")[:3000],
        ]
    ).lower()
    matched = sorted({term for term in terms if term in text})

    if len(matched) >= 3:
        level = "High"
    elif matched:
        level = "Medium"
    else:
        level = "Low"
    return {"level": level, "matched_terms": matched}


def audience_terms() -> tuple[str, ...]:
    return (
        "teams",
        "businesses",
        "companies",
        "startups",
        "enterprise",
        "developers",
        "marketers",
        "sales",
        "manufacturing",
        "agencies",
        "creators",
    )


def industry_terms() -> tuple[str, ...]:
    return (
        "software",
        "saas",
        "healthcare",
        "finance",
        "manufacturing",
        "education",
        "retail",
        "security",
        "legal",
        "accounting",
        "crm",
        "project management",
    )


def schema_summary(pages: list[dict[str, Any]]) -> dict[str, Any]:
    urls = [page.get("url", "") for page in pages if page.get("schema_json_ld")]
    return {"found": bool(urls), "pages": urls}


def metadata_quality(pages: list[dict[str, Any]]) -> dict[str, Any]:
    total = len(pages)
    with_titles = sum(1 for page in pages if page.get("title"))
    with_descriptions = sum(1 for page in pages if page.get("meta_description"))
    if total == 0:
        level = "Unknown"
    elif with_titles == total and with_descriptions == total:
        level = "High"
    elif with_titles and with_descriptions:
        level = "Medium"
    else:
        level = "Low"
    return {
        "level": level,
        "pages_checked": total,
        "pages_with_titles": with_titles,
        "pages_with_meta_descriptions": with_descriptions,
    }


def navigation_clarity(pages: list[dict[str, Any]]) -> dict[str, Any]:
    nav_items = []
    for page in pages:
        nav_items.extend(page.get("navigation", []))
    labels = sorted({item.get("text", "") for item in nav_items if item.get("text", "")})
    if len(labels) >= 5:
        level = "High"
    elif labels:
        level = "Medium"
    else:
        level = "Low"
    return {"level": level, "labels": labels[:25]}


def build_notes(homepage: dict[str, Any], page_flags: dict[str, Any]) -> list[str]:
    notes = []
    if homepage:
        if not first_heading(homepage, "h1"):
            notes.append("Homepage H1 was not found.")
        if not homepage.get("meta_description"):
            notes.append("Homepage meta description was not found.")
    for field, value in page_flags.items():
        if not value["found"]:
            notes.append(f"{field.replace('_', ' ').title()} was not found.")
    return notes

