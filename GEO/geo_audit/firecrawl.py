from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from itertools import repeat
import json
import os
import re
from threading import Lock
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen

from .llm import load_dotenv


FIRECRAWL_SCRAPE_CONCURRENCY = 6
FIRECRAWL_API_BASE = "https://api.firecrawl.dev/v2"
USER_PROFILE_PATH_TERMS = (
    "services",
    "solutions",
    "products",
    "industries",
    "use-cases",
    "customers",
    "case-studies",
    "pricing",
    "about",
    "contact",
)
USER_PROFILE_PAGE_GROUPS = (
    ("services", "solutions", "products"),
    ("industries", "use-cases"),
    ("customers", "case-studies"),
    ("pricing",),
    ("about", "contact"),
)


class FirecrawlError(RuntimeError):
    pass


class FirecrawlClient:
    def __init__(
        self,
        api_key: str,
        *,
        api_base: str = FIRECRAWL_API_BASE,
        max_requests: int = 40,
        max_reported_credits: int = 50,
        timeout: int = 45,
    ) -> None:
        self.api_key = api_key
        self.api_base = api_base.rstrip("/")
        self.max_requests = max(0, max_requests)
        self.max_reported_credits = max(0, max_reported_credits)
        self.timeout = max(5, timeout)
        self.request_count = 0
        self.reported_credits = 0
        self.events: list[dict[str, Any]] = []
        self._lock = Lock()

    @classmethod
    def from_environment(cls) -> FirecrawlClient | None:
        load_dotenv(override=True)
        api_key = os.environ.get("FIRECRAWL_API_KEY", "").strip()
        if not api_key:
            return None
        return cls(
            api_key,
            api_base=os.environ.get(
                "FIRECRAWL_API_BASE", FIRECRAWL_API_BASE
            ).strip(),
            max_requests=environment_int("FIRECRAWL_MAX_REQUESTS_PER_AUDIT", 40),
            max_reported_credits=environment_int(
                "FIRECRAWL_MAX_CREDITS_PER_AUDIT", 50
            ),
            timeout=environment_int("FIRECRAWL_TIMEOUT_SECONDS", 45),
        )

    def can_request(self, *, pending: int = 0) -> bool:
        """pending counts requests already promised but not yet sent, which is
        how a parallel batch reserves its share of the budget before starting."""
        return (
            self.request_count + pending < self.max_requests
            and self.reported_credits + pending < self.max_reported_credits
        )

    def map_site(self, url: str, *, limit: int = 30) -> list[dict[str, str]]:
        response = self._request(
            "map",
            "/map",
            {
                "url": url,
                "limit": max(1, min(limit, 50)),
                "includeSubdomains": False,
                "ignoreQueryParameters": True,
            },
            subject=url,
        )
        raw_links = response.get("links")
        if not isinstance(raw_links, list):
            raw_links = (response.get("data") or {}).get("links", [])
        links = []
        for item in raw_links or []:
            if isinstance(item, str):
                candidate = {"url": item, "title": ""}
            elif isinstance(item, dict):
                candidate = {
                    "url": str(item.get("url", "")).strip(),
                    "title": str(
                        item.get("title") or item.get("description") or ""
                    ).strip(),
                }
            else:
                continue
            if is_http_url(candidate["url"]):
                links.append(candidate)
        return dedupe_links(links)

    def scrape(self, url: str) -> dict[str, Any]:
        response = self._request(
            "scrape",
            "/scrape",
            {
                "url": url,
                "formats": ["markdown", "links"],
                "onlyMainContent": True,
                "removeBase64Images": True,
                "blockAds": True,
                "proxy": "basic",
                "storeInCache": True,
                "maxAge": 604800000,
                "timeout": self.timeout * 1000,
            },
            subject=url,
        )
        data = response.get("data", response)
        if not isinstance(data, dict):
            raise FirecrawlError("Firecrawl returned an invalid scrape response.")
        markdown = str(data.get("markdown", "")).strip()
        if not markdown:
            raise FirecrawlError("Firecrawl returned no page content.")
        return data

    def usage_summary(self) -> dict[str, Any]:
        return {
            "enabled": True,
            "request_limit": self.max_requests,
            "reported_credit_limit": self.max_reported_credits,
            "requests": self.request_count,
            "reported_credits": self.reported_credits,
            "events": list(self.events),
        }

    def _request(
        self,
        operation: str,
        path: str,
        payload: dict[str, Any],
        *,
        subject: str,
    ) -> dict[str, Any]:
        with self._lock:
            if not self.can_request():
                raise FirecrawlError("Firecrawl audit budget was reached.")
            self.request_count += 1

        request = Request(
            f"{self.api_base}{path}",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            method="POST",
        )
        try:
            with urlopen(request, timeout=self.timeout) as response:
                parsed = json.loads(response.read().decode("utf-8"))
            if not isinstance(parsed, dict) or parsed.get("success") is False:
                message = (
                    parsed.get("error", "Firecrawl request failed.")
                    if isinstance(parsed, dict)
                    else "Firecrawl returned an invalid response."
                )
                raise FirecrawlError(str(message))
            credits = reported_credits(parsed)
            with self._lock:
                self.reported_credits += credits
                self.events.append(
                    usage_event(operation, subject, True, credits=credits)
                )
            return parsed
        except (HTTPError, URLError, TimeoutError, ValueError, json.JSONDecodeError) as exc:
            message = firecrawl_error_message(exc)
            with self._lock:
                self.events.append(
                    usage_event(operation, subject, False, error=message)
                )
            raise FirecrawlError(message) from exc
        except FirecrawlError as exc:
            with self._lock:
                self.events.append(
                    usage_event(operation, subject, False, error=str(exc))
                )
            raise


def should_enrich_user_snapshot(snapshot: dict[str, Any]) -> bool:
    pages = snapshot.get("pages", [])
    if not pages:
        return True
    substantial_pages = [
        page
        for page in pages
        if len(str(page.get("main_text", "")).strip()) >= 800
    ]
    homepage = min(
        pages,
        key=lambda page: len(urlparse(str(page.get("url", ""))).path.strip("/")),
    )
    homepage_is_weak = len(str(homepage.get("main_text", "")).strip()) < 800
    has_buyer_context_page = any(
        any(term in urlparse(str(page.get("url", ""))).path.lower() for term in USER_PROFILE_PATH_TERMS)
        for page in pages
    )
    return (
        homepage_is_weak
        or len(substantial_pages) < 2
        or (not has_buyer_context_page and len(pages) < 3)
    )


def enrich_user_snapshot(
    client: FirecrawlClient,
    site_url: str,
    snapshot: dict[str, Any],
    *,
    max_pages: int = 4,
) -> tuple[dict[str, Any], dict[str, Any]]:
    result: dict[str, Any] = {
        "attempted": True,
        "reason": "website snapshot lacked enough reliable buyer context",
        "mapped_urls": 0,
        "pages_added": 0,
        "pages_replaced": 0,
        "errors": [],
    }
    if max_pages <= 0 or not client.can_request():
        result["reason"] = "Firecrawl request budget is unavailable"
        return snapshot, result

    try:
        mapped = client.map_site(site_url, limit=30)
        result["mapped_urls"] = len(mapped)
    except FirecrawlError as exc:
        mapped = []
        result["errors"].append({"operation": "map", "error": str(exc)})
        if is_terminal_site_error(str(exc)):
            result["reason"] = "Firecrawl could not resolve or access the website"
            snapshot["firecrawl_enrichment"] = result
            return snapshot, result

    existing_pages = {
        canonical_url(str(page.get("url", ""))): page
        for page in snapshot.get("pages", [])
        if canonical_url(str(page.get("url", "")))
    }
    candidates: list[tuple[int, str]] = []
    root_key = canonical_url(site_url)
    root_page = existing_pages.get(root_key)
    if root_page is None or len(str(root_page.get("main_text", "")).strip()) < 800:
        candidates.append((0, site_url))

    root_domain = urlparse(site_url).netloc.lower().removeprefix("www.")
    for row in mapped:
        url = str(row.get("url", "")).strip()
        parsed = urlparse(url)
        if parsed.netloc.lower().removeprefix("www.") != root_domain:
            continue
        haystack = f"{parsed.path} {row.get('title', '')}".lower()
        group_positions = [
            index
            for index, terms in enumerate(USER_PROFILE_PAGE_GROUPS)
            if any(term in haystack for term in terms)
        ]
        if not group_positions:
            continue
        existing = existing_pages.get(canonical_url(url))
        if existing and len(str(existing.get("main_text", "")).strip()) >= 800:
            continue
        candidates.append((10 + min(group_positions), url))

    seen: set[str] = set()
    selected = []
    ordered_candidates = sorted(candidates, key=lambda item: (item[0], item[1]))
    selected_priorities: set[int] = set()
    diverse_candidates = []
    remaining_candidates = []
    for priority, url in ordered_candidates:
        if priority not in selected_priorities:
            selected_priorities.add(priority)
            diverse_candidates.append((priority, url))
        else:
            remaining_candidates.append((priority, url))
    for _priority, url in diverse_candidates + remaining_candidates:
        key = canonical_url(url)
        if not key or key in seen:
            continue
        seen.add(key)
        selected.append(url)

    for url, page, error in scrape_pages(client, selected[:max_pages]):
        if error is not None:
            result["errors"].append(
                {"operation": "scrape", "url": url, "error": error}
            )
            continue
        key = canonical_url(str(page.get("url", "")))
        current = existing_pages.get(key)
        if current is None:
            snapshot.setdefault("pages", []).append(page)
            existing_pages[key] = page
            result["pages_added"] += 1
        elif len(str(page.get("main_text", "")).strip()) > len(
            str(current.get("main_text", "")).strip()
        ):
            index = snapshot["pages"].index(current)
            snapshot["pages"][index] = page
            existing_pages[key] = page
            result["pages_replaced"] += 1

    snapshot["firecrawl_enrichment"] = result
    return snapshot, result


def scrape_pages(
    client: FirecrawlClient,
    urls: list[str],
    *,
    concurrency: int = FIRECRAWL_SCRAPE_CONCURRENCY,
) -> list[tuple[str, dict[str, Any] | None, str | None]]:
    """Scrape pages at the same time, and hand them back in the order asked.

    One page at a time was three quarters of the crawl: six pages cost 9.6s
    while our own crawler did eight in 1.8s. The pages have nothing to do with
    each other, so waiting for each in turn bought nothing.

    Results keep the requested order rather than the order they finish in.
    Page ids are positions in this list, so a run that reordered them by
    network luck would move the evidence under every quote.
    """
    wanted = [url for url in urls if url]
    if not wanted:
        return []
    # Reserve the budget up front. Asking can_request() inside the workers
    # races: every one of them reads the count before any has spent it.
    allowed = []
    for url in wanted:
        if not client.can_request(pending=len(allowed)):
            break
        allowed.append(url)

    rows: list[tuple[str, dict[str, Any] | None, str | None]] = []
    with ThreadPoolExecutor(
        max_workers=max(1, min(concurrency, len(allowed)))
    ) as executor:
        documents = list(executor.map(scrape_one, repeat(client), allowed))
    for url, (document, error) in zip(allowed, documents):
        if error is not None:
            rows.append((url, None, error))
        else:
            rows.append((url, firecrawl_document_to_page(document, url), None))
    return rows


def scrape_one(
    client: FirecrawlClient,
    url: str,
) -> tuple[dict[str, Any] | None, str | None]:
    try:
        return client.scrape(url), None
    except FirecrawlError as exc:
        return None, str(exc)


def firecrawl_document_to_page(
    document: dict[str, Any],
    requested_url: str,
) -> dict[str, Any]:
    metadata = document.get("metadata", {})
    if not isinstance(metadata, dict):
        metadata = {}
    url = str(
        metadata.get("sourceURL")
        or metadata.get("url")
        or requested_url
    ).strip()
    markdown = str(document.get("markdown", "")).strip()
    links = normalize_document_links(document.get("links", []), url)
    headings = {f"h{level}": [] for level in range(1, 7)}
    for hashes, text in re.findall(r"(?m)^(#{1,6})\s+(.+?)\s*$", markdown):
        headings[f"h{len(hashes)}"].append(clean_markdown_text(text))
    title = str(metadata.get("title", "")).strip()
    if not title and headings["h1"]:
        title = headings["h1"][0]
    return {
        "url": url,
        "status_code": int(
            metadata.get("statusCode") or metadata.get("pageStatusCode") or 200
        ),
        "title": title,
        "meta_description": str(
            metadata.get("description") or metadata.get("ogDescription") or ""
        ).strip(),
        "headings": headings,
        "schema_json_ld": [],
        "navigation": [],
        "internal_links": [
            item
            for item in links
            if same_domain(item["url"], url)
        ],
        "external_links": [
            item
            for item in links
            if not same_domain(item["url"], url)
        ],
        "image_alt_text": [],
        "main_text": markdown_body_text(markdown),
        "fetch_provider": "firecrawl",
        "firecrawl_verified": True,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }


def normalize_document_links(value: Any, base_url: str) -> list[dict[str, str]]:
    if not isinstance(value, list):
        return []
    rows = []
    for item in value:
        if isinstance(item, str):
            url = item
            text = ""
        elif isinstance(item, dict):
            url = str(item.get("url") or item.get("href") or "")
            text = str(item.get("text") or item.get("title") or "")
        else:
            continue
        resolved = urljoin(base_url, url.strip())
        if is_http_url(resolved):
            rows.append({"url": resolved, "text": text.strip()})
    return dedupe_links(rows)


def clean_markdown_text(value: Any) -> str:
    """One line of plain words. For titles and headings, which are one line."""
    text = strip_markdown_links(str(value or ""))
    text = re.sub(r"(?m)^#{1,6}\s*", "", text)
    text = re.sub(r"[`*_~>|]", " ", text)
    return " ".join(unescape_markdown(text).split())


def markdown_body_text(value: Any) -> str:
    """Firecrawl's markdown with its shape intact, minus the link plumbing.

    Flattening a page to one line was quietly costing us. A heading, a bullet
    list of client names and a contact form all arrived as the same run-on
    sentence, so the model stitched quotes across unrelated blocks, read a
    head office address as a market claim, and read a form placeholder as a
    customer. The markers are what tell those apart, so we pay for them and
    now keep them.
    """
    text = strip_markdown_links(str(value or ""))
    lines: list[str] = []
    for raw in text.splitlines():
        # A trailing backslash is a markdown hard break, not content.
        line = unescape_markdown(re.sub(r"\\+$", "", raw.rstrip())).rstrip()
        if line:
            lines.append(line)
        elif lines and lines[-1]:
            lines.append("")
    return "\n".join(lines).strip()


def unescape_markdown(text: str) -> str:
    """Firecrawl escapes punctuation, so a quote reads "We\\'ll" on the page."""
    return re.sub(r"\\([\\`*_{}\[\]()#+\-.!'\"])", r"\1", text)


def strip_markdown_links(text: str) -> str:
    text = re.sub(r"!\[([^\]]*)\]\([^)]+\)", r"\1", text)
    return re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)


def reported_credits(response: dict[str, Any]) -> int:
    candidates = [
        response.get("creditsUsed"),
        (response.get("data") or {}).get("creditsUsed")
        if isinstance(response.get("data"), dict)
        else None,
        (response.get("metadata") or {}).get("creditsUsed")
        if isinstance(response.get("metadata"), dict)
        else None,
    ]
    for value in candidates:
        try:
            if value is not None:
                return max(0, int(value))
        except (TypeError, ValueError):
            continue
    return 1


def firecrawl_error_message(exc: Exception) -> str:
    if isinstance(exc, HTTPError):
        try:
            detail = exc.read().decode("utf-8", errors="replace")[:500]
        except OSError:
            detail = ""
        return f"HTTP {exc.code}: {detail or exc.reason}"
    return str(exc)


def is_terminal_site_error(message: str) -> bool:
    normalized = message.lower()
    return any(
        marker in normalized
        for marker in (
            "dns resolution failed",
            "could not be translated to an ip address",
            "domain does not exist",
            "invalid url",
        )
    )


def usage_event(
    operation: str,
    subject: str,
    success: bool,
    *,
    credits: int = 0,
    error: str | None = None,
) -> dict[str, Any]:
    return {
        "operation": operation,
        "subject": subject,
        "success": success,
        "reported_credits": credits,
        "error": error,
        "occurred_at": datetime.now(timezone.utc).isoformat(),
    }


def environment_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, str(default)))
    except ValueError:
        return default


def is_http_url(value: str) -> bool:
    parsed = urlparse(value)
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def same_domain(left: str, right: str) -> bool:
    left_domain = urlparse(left).netloc.lower().removeprefix("www.")
    right_domain = urlparse(right).netloc.lower().removeprefix("www.")
    return bool(left_domain and left_domain == right_domain)


def canonical_url(value: str) -> str:
    parsed = urlparse(value.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return ""
    path = parsed.path.rstrip("/") or "/"
    return parsed._replace(
        scheme=parsed.scheme.lower(),
        netloc=parsed.netloc.lower().removeprefix("www."),
        path=path,
        query="",
        fragment="",
    ).geturl()


def dedupe_links(rows: list[dict[str, str]]) -> list[dict[str, str]]:
    deduped = []
    seen = set()
    for row in rows:
        key = row.get("url", "").rstrip("/")
        if not key or key in seen:
            continue
        seen.add(key)
        deduped.append(row)
    return deduped
