from __future__ import annotations

from collections import deque
from datetime import datetime, timezone
from html.parser import HTMLParser
from http.client import InvalidURL
import json
import re
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urldefrag, urljoin, urlparse
from .netguard import BlockedUrlError, open_url_guarded


IMPORTANT_PATH_KEYWORDS = (
    "",
    "about",
    "product",
    "products",
    "feature",
    "features",
    "pricing",
    "faq",
    "docs",
    "documentation",
    "blog",
    "contact",
    "customers",
    "case-studies",
    "compare",
    "comparison",
)


class PageParser(HTMLParser):
    def __init__(self, base_url: str) -> None:
        super().__init__(convert_charrefs=True)
        self.base_url = base_url
        self.title = ""
        self.meta_description = ""
        self.headings: dict[str, list[str]] = {f"h{i}": [] for i in range(1, 7)}
        self.schema_json_ld: list[Any] = []
        self.links: list[dict[str, str]] = []
        self.image_alt_text: list[str] = []
        self.text_chunks: list[str] = []
        self.nav_links: list[dict[str, str]] = []
        self._tag_stack: list[str] = []
        self._capture_tag: str | None = None
        self._capture_text: list[str] = []
        self._script_type: str | None = None
        self._skip_text_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attrs_dict = {key.lower(): value or "" for key, value in attrs}
        self._tag_stack.append(tag)

        if tag in {"script", "style", "noscript"}:
            self._skip_text_depth += 1

        if tag == "title" or tag in self.headings:
            self._capture_tag = tag
            self._capture_text = []

        if tag == "meta":
            name = attrs_dict.get("name", "").lower()
            prop = attrs_dict.get("property", "").lower()
            if name == "description" or prop == "og:description":
                content = clean_text(attrs_dict.get("content", ""))
                if content and not self.meta_description:
                    self.meta_description = content

        if tag == "script":
            self._script_type = attrs_dict.get("type", "").lower()
            if self._script_type == "application/ld+json":
                self._capture_tag = "script"
                self._capture_text = []

        if tag == "a":
            href = attrs_dict.get("href", "")
            if href:
                item = {"url": normalize_url(urljoin(self.base_url, href)), "text": ""}
                self.links.append(item)
                if "nav" in self._tag_stack:
                    self.nav_links.append(item)

        if tag == "img":
            alt = clean_text(attrs_dict.get("alt", ""))
            if alt:
                self.image_alt_text.append(alt)

    def handle_endtag(self, tag: str) -> None:
        if self._capture_tag == tag:
            captured = clean_text(" ".join(self._capture_text))
            if tag == "title":
                self.title = captured
            elif tag in self.headings and captured:
                self.headings[tag].append(captured)
            elif tag == "script" and self._script_type == "application/ld+json":
                parsed = parse_json_ld(captured)
                if parsed is not None:
                    self.schema_json_ld.append(parsed)
            self._capture_tag = None
            self._capture_text = []

        if tag in {"script", "style", "noscript"} and self._skip_text_depth:
            self._skip_text_depth -= 1
            self._script_type = None

        if self._tag_stack:
            for index in range(len(self._tag_stack) - 1, -1, -1):
                if self._tag_stack[index] == tag:
                    del self._tag_stack[index:]
                    break

    def handle_data(self, data: str) -> None:
        text = clean_text(data)
        if not text:
            return

        if self._capture_tag:
            self._capture_text.append(text)

        if not self._skip_text_depth and len(text) > 1:
            self.text_chunks.append(text)
            if self.links and self._tag_stack and self._tag_stack[-1] == "a":
                self.links[-1]["text"] = clean_text(
                    f"{self.links[-1].get('text', '')} {text}"
                )


def crawl_website(start_url: str, max_pages: int = 12) -> dict[str, Any]:
    normalized_start = ensure_url(start_url)
    allowed_domains = candidate_domains(normalized_start)
    queue: deque[str] = deque(candidate_start_urls(normalized_start))
    seen: set[str] = set()
    stored: set[str] = set()
    dns_failed_hosts: set[str] = set()
    pages: list[dict[str, Any]] = []
    failed_pages: list[dict[str, str]] = []

    while queue and len(pages) < max_pages:
        current_url = queue.popleft()
        if current_url in seen:
            continue
        seen.add(current_url)
        current_host = urlparse(current_url).netloc.lower()
        if current_host in dns_failed_hosts:
            continue

        if current_url.endswith("/sitemap.xml"):
            try:
                sitemap_urls = fetch_sitemap_urls(current_url)
                for sitemap_url in sitemap_urls:
                    if (
                        sitemap_url not in seen
                        and is_allowed_domain(sitemap_url, allowed_domains)
                    ):
                        queue.append(sitemap_url)
                queue = prioritize_queue(queue)
            except (HTTPError, URLError, TimeoutError, ValueError, InvalidURL) as exc:
                failed_pages.append({"url": current_url, "error": str(exc)})
                if is_dns_error(exc):
                    dns_failed_hosts.add(current_host)
            continue

        try:
            html, status_code, final_url = fetch_html(current_url)
        except (HTTPError, URLError, TimeoutError, ValueError, InvalidURL) as exc:
            failed_pages.append({"url": current_url, "error": str(exc)})
            if is_dns_error(exc):
                dns_failed_hosts.add(current_host)
            continue

        # http://, https:// and the www variant of one page are one page.
        # Some sites redirect between them and some serve all three, so the
        # address they arrived under cannot be the identity. Storing each spent
        # three of a competitor's six page slots on the same text.
        page_key = same_page_key(final_url)
        if page_key in stored:
            continue
        stored.add(page_key)
        seen.add(final_url)

        parsed_page = parse_page(final_url, html, status_code)
        pages.append(parsed_page)
        allowed_domains.add(urlparse(final_url).netloc.lower())

        for link in parsed_page["internal_links"]:
            link_url = link["url"]
            if link_url not in seen and is_allowed_domain(link_url, allowed_domains):
                queue.append(link_url)

        queue = prioritize_queue(queue)

    return {
        "input_url": start_url,
        "normalized_url": normalized_start,
        "domain": urlparse(normalized_start).netloc.lower(),
        "allowed_domains": sorted(allowed_domains),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "max_pages": max_pages,
        "pages": pages,
        "failed_pages": failed_pages,
    }


def same_page_key(url: str) -> str:
    """One key per page, whatever scheme or host prefix reached it."""
    parsed = urlparse(url)
    host = parsed.netloc.lower().removeprefix("www.")
    return f"{host}{parsed.path.rstrip('/')}?{parsed.query}"


def fetch_html(url: str) -> tuple[str, int, str]:
    # Guarded fetch: the audited website and every redirect it takes is
    # untrusted input. netguard validates each hop against internal ranges
    # and caps the body.
    final_url, response_headers, body = open_url_guarded(
        url,
        timeout=15,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/126.0 Safari/537.36 GEOAuditBot/0.1"
            ),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
        },
    )
    content_type = response_headers.get("Content-Type", "")
    if "text/html" not in content_type and "application/xhtml+xml" not in content_type:
        raise ValueError(f"Unsupported content type: {content_type}")
    charset = "utf-8"
    match = re.search(r"charset=([A-Za-z0-9_-]+)", content_type)
    if match:
        charset = match.group(1)
    html = body.decode(charset, errors="replace")
    return html, 200, final_url


def fetch_sitemap_urls(url: str, max_urls: int = 50) -> list[str]:
    _, _, body = open_url_guarded(
        url,
        timeout=15,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/126.0 Safari/537.36 GEOAuditBot/0.1"
            ),
            "Accept": "application/xml,text/xml,*/*;q=0.8",
        },
    )
    text = body.decode("utf-8", errors="replace")
    urls = re.findall(r"<loc>\s*(https?://[^<\s]+)\s*</loc>", text, flags=re.IGNORECASE)
    return [normalize_url(url) for url in urls[:max_urls]]


def parse_page(url: str, html: str, status_code: int) -> dict[str, Any]:
    parser = PageParser(url)
    parser.feed(html)

    links = dedupe_links(parser.links)
    domain = urlparse(url).netloc.lower()
    internal_links = [link for link in links if is_same_domain(link["url"], domain)]

    return {
        "url": url,
        "status_code": status_code,
        "title": parser.title,
        "meta_description": parser.meta_description,
        "headings": parser.headings,
        "schema_json_ld": parser.schema_json_ld,
        "navigation": dedupe_links(parser.nav_links),
        "internal_links": internal_links,
        "image_alt_text": sorted(set(parser.image_alt_text)),
        "main_text": build_main_text(parser.text_chunks),
    }


def ensure_url(url: str) -> str:
    value = url.strip()
    if not value:
        raise ValueError("Website URL is required.")
    if not value.startswith(("http://", "https://")):
        value = f"https://{value}"
    normalized = normalize_url(value)
    parsed = urlparse(normalized)
    try:
        hostname = parsed.hostname or ""
    except ValueError as exc:
        raise ValueError("Website URL has an invalid hostname.") from exc
    if (
        parsed.scheme not in {"http", "https"}
        or not hostname
        or any(character.isspace() or ord(character) < 32 for character in hostname)
    ):
        raise ValueError("Website URL must contain a valid public hostname.")
    if parsed.username or parsed.password:
        raise ValueError("Website URL must not contain login credentials.")
    return normalized


def normalize_url(url: str) -> str:
    clean_url, _fragment = urldefrag(url)
    parsed = urlparse(clean_url)
    path = quote(parsed.path or "/", safe="/:@!$&'()*+,;=-._~%")
    query = quote(parsed.query.rstrip("&"), safe="=&?/:;+,%@-._~")
    normalized = parsed._replace(path=path, query=query)
    return normalized.geturl().rstrip("/") if path != "/" else normalized.geturl()


def is_same_domain(url: str, domain: str) -> bool:
    parsed_domain = urlparse(url).netloc.lower()
    return parsed_domain == domain


def is_allowed_domain(url: str, domains: set[str]) -> bool:
    parsed_domain = urlparse(url).netloc.lower()
    return parsed_domain in domains


def candidate_domains(url: str) -> set[str]:
    parsed = urlparse(url)
    domain = parsed.netloc.lower()
    domains = {domain}
    if domain.startswith("www."):
        domains.add(domain[4:])
    else:
        domains.add(f"www.{domain}")
    return domains


def candidate_start_urls(url: str) -> list[str]:
    parsed = urlparse(url)
    domain = parsed.netloc.lower()
    path = parsed.path or "/"
    query = f"?{parsed.query}" if parsed.query else ""
    domains = [domain]
    if domain.startswith("www."):
        domains.append(domain[4:])
    else:
        domains.append(f"www.{domain}")

    candidates = []
    for scheme in [parsed.scheme or "https", "https", "http"]:
        for candidate_domain in domains:
            candidates.append(f"{scheme}://{candidate_domain}{path}{query}")
    for candidate_domain in domains:
        candidates.append(f"https://{candidate_domain}/sitemap.xml")
    return list(dict.fromkeys(normalize_url(item) for item in candidates))


def prioritize_queue(queue: deque[str]) -> deque[str]:
    unique_urls = list(dict.fromkeys(queue))
    unique_urls.sort(key=priority_score)
    return deque(unique_urls)


def priority_score(url: str) -> tuple[int, int, str]:
    path = urlparse(url).path.strip("/").lower()
    if path == "":
        return (0, 0, url)
    keyword_hit = any(keyword and keyword in path for keyword in IMPORTANT_PATH_KEYWORDS)
    return (0 if keyword_hit else 1, path.count("/"), url)


def dedupe_links(links: list[dict[str, str]]) -> list[dict[str, str]]:
    deduped: dict[str, dict[str, str]] = {}
    for link in links:
        url = link.get("url", "")
        if not url.startswith(("http://", "https://")):
            continue
        if url not in deduped:
            deduped[url] = {"url": url, "text": clean_text(link.get("text", ""))}
        elif not deduped[url]["text"] and link.get("text"):
            deduped[url]["text"] = clean_text(link["text"])
    return list(deduped.values())


def clean_text(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def is_dns_error(exc: Exception) -> bool:
    message = str(exc).lower()
    return any(
        marker in message
        for marker in (
            "getaddrinfo failed",
            "name or service not known",
            "nodename nor servname provided",
            "temporary failure in name resolution",
        )
    )


def build_main_text(chunks: list[str], max_chars: int = 20000) -> str:
    seen: set[str] = set()
    cleaned: list[str] = []
    for chunk in chunks:
        text = clean_text(chunk)
        if len(text) < 2 or text in seen:
            continue
        seen.add(text)
        cleaned.append(text)
    return "\n".join(cleaned)[:max_chars]


def parse_json_ld(raw_text: str) -> Any | None:
    if not raw_text:
        return None
    try:
        return json.loads(raw_text)
    except json.JSONDecodeError:
        return None

