from __future__ import annotations

from collections import Counter
import html
import math
import re
import unicodedata
from typing import Any
from urllib.parse import urlsplit, urlunsplit


PAGE_SET_WEIGHT = 0.35
CONTENT_WEIGHT = 0.65
MAJOR_TOTAL_CHANGE = 0.16
MAJOR_PAGE_CHANGE = 0.24
MIN_SUBSTANTIVE_WORDS = 80


def normalize_meaningful_text(value: object) -> str:
    """Ignore formatting noise while preserving words and numbers.

    Case, punctuation, repeated whitespace and Unicode presentation forms do
    not change meaning. Numbers stay because a new price or product limit is a
    real company-profile change.
    """
    text = unicodedata.normalize("NFKC", html.unescape(str(value or ""))).casefold()
    text = re.sub(r"[^\w]+", " ", text, flags=re.UNICODE)
    return " ".join(text.split())


def canonical_page_url(value: object) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    try:
        parsed = urlsplit(raw)
        host = parsed.netloc.casefold().removeprefix("www.")
        path = re.sub(r"/+", "/", parsed.path or "/").rstrip("/") or "/"
        return urlunsplit((parsed.scheme.casefold() or "https", host, path, "", ""))
    except ValueError:
        return raw.casefold().rstrip("/")


def _heading_text(page: dict[str, Any]) -> str:
    headings = page.get("headings")
    if not isinstance(headings, dict):
        return ""
    values: list[str] = []
    for level in ("h1", "h2", "h3", "h4", "h5", "h6"):
        items = headings.get(level)
        if isinstance(items, list):
            values.extend(str(item) for item in items)
    return " ".join(values)


def _page_text(page: dict[str, Any]) -> str:
    return normalize_meaningful_text(
        " ".join(
            (
                str(page.get("title") or ""),
                str(page.get("meta_description") or ""),
                _heading_text(page),
                str(page.get("main_text") or page.get("text") or ""),
            )
        )
    )


def _cosine_similarity(left: str, right: str) -> float:
    if left == right:
        return 1.0
    left_counts = Counter(left.split())
    right_counts = Counter(right.split())
    if not left_counts or not right_counts:
        return 0.0
    shared = sum(value * right_counts.get(word, 0) for word, value in left_counts.items())
    left_size = math.sqrt(sum(value * value for value in left_counts.values()))
    right_size = math.sqrt(sum(value * value for value in right_counts.values()))
    return shared / max(left_size * right_size, 1.0)


def _word_set_similarity(left: str, right: str) -> float:
    left_words = set(left.split())
    right_words = set(right.split())
    if not left_words and not right_words:
        return 1.0
    return len(left_words & right_words) / max(len(left_words | right_words), 1)


def _content_change(left: str, right: str) -> float:
    if left == right:
        return 0.0
    similarity = 0.75 * _cosine_similarity(left, right) + 0.25 * _word_set_similarity(left, right)
    return max(0.0, min(1.0, 1.0 - similarity))


def _page_map(snapshot: dict[str, Any]) -> dict[str, tuple[str, int]]:
    mapped: dict[str, tuple[str, int]] = {}
    for page in snapshot.get("pages") or []:
        if not isinstance(page, dict):
            continue
        url = canonical_page_url(page.get("url"))
        if not url:
            continue
        text = _page_text(page)
        mapped[url] = (text, len(text.split()))
    return mapped


def compare_website_snapshots(
    previous: dict[str, Any],
    current: dict[str, Any],
) -> dict[str, Any]:
    """Decide whether a saved company profile is still safe to reuse.

    The decision is intentionally conservative: missing or weak current data
    rebuilds. Cosmetic changes do not. The returned measurements are stored so
    production decisions can be audited instead of hidden in a boolean.
    """
    old_pages = _page_map(previous)
    new_pages = _page_map(current)
    if not old_pages or not new_pages:
        return {
            "decision": "rebuild",
            "confidence": "low",
            "reason": "A reliable before-and-after page set was not available.",
            "page_set_change": 1.0,
            "content_change": 1.0,
            "weighted_change": 1.0,
            "added_pages": sorted(set(new_pages) - set(old_pages)),
            "removed_pages": sorted(set(old_pages) - set(new_pages)),
            "changed_pages": [],
        }

    old_urls = set(old_pages)
    new_urls = set(new_pages)
    added = sorted(new_urls - old_urls)
    removed = sorted(old_urls - new_urls)
    shared = sorted(old_urls & new_urls)
    page_set_change = len(old_urls ^ new_urls) / max(len(old_urls | new_urls), 1)

    changed_pages: list[dict[str, Any]] = []
    total_weight = 0.0
    weighted_content_change = 0.0
    for url in shared:
        old_text, old_words = old_pages[url]
        new_text, new_words = new_pages[url]
        change = _content_change(old_text, new_text)
        weight = max(1.0, math.sqrt(max(old_words, new_words, 1)))
        total_weight += weight
        weighted_content_change += change * weight
        if change >= 0.01:
            changed_pages.append(
                {
                    "url": url,
                    "change": round(change, 4),
                    "old_words": old_words,
                    "new_words": new_words,
                }
            )
    content_change = weighted_content_change / max(total_weight, 1.0)
    weighted_change = PAGE_SET_WEIGHT * page_set_change + CONTENT_WEIGHT * content_change

    substantive_added = [url for url in added if new_pages[url][1] >= MIN_SUBSTANTIVE_WORDS]
    substantive_removed = [url for url in removed if old_pages[url][1] >= MIN_SUBSTANTIVE_WORDS]
    major_page_edits = [
        row
        for row in changed_pages
        if row["change"] >= MAJOR_PAGE_CHANGE
        and max(row["old_words"], row["new_words"]) >= MIN_SUBSTANTIVE_WORDS
    ]
    fetch_coverage = len(new_pages) / max(len(old_pages), 1)

    reasons: list[str] = []
    rebuild = False
    confidence = "high"
    if fetch_coverage < 0.6:
        rebuild = True
        confidence = "low"
        reasons.append("Too few previous pages could be checked safely.")
    if substantive_added:
        rebuild = True
        reasons.append("Substantial pages were added.")
    if substantive_removed:
        rebuild = True
        reasons.append("Substantial pages were removed.")
    if major_page_edits:
        rebuild = True
        reasons.append("At least one substantial page changed materially.")
    if weighted_change >= MAJOR_TOTAL_CHANGE:
        rebuild = True
        reasons.append("The website changed materially overall.")
    if not rebuild:
        reasons.append(
            "Only cosmetic or minor content differences were found."
            if changed_pages or added or removed
            else "The meaningful website content is unchanged."
        )

    return {
        "decision": "rebuild" if rebuild else "reuse",
        "confidence": confidence,
        "reason": " ".join(reasons),
        "weights": {"page_set": PAGE_SET_WEIGHT, "content": CONTENT_WEIGHT},
        "thresholds": {
            "overall": MAJOR_TOTAL_CHANGE,
            "page": MAJOR_PAGE_CHANGE,
            "substantive_words": MIN_SUBSTANTIVE_WORDS,
        },
        "page_set_change": round(page_set_change, 4),
        "content_change": round(content_change, 4),
        "weighted_change": round(weighted_change, 4),
        "fetch_coverage": round(fetch_coverage, 4),
        "added_pages": added,
        "removed_pages": removed,
        "substantive_added_pages": substantive_added,
        "substantive_removed_pages": substantive_removed,
        "changed_pages": sorted(changed_pages, key=lambda row: -row["change"]),
    }
