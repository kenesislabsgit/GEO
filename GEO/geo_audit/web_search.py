from __future__ import annotations

from datetime import datetime, timezone
import logging
from threading import BoundedSemaphore
from time import sleep
from typing import Any
from urllib.parse import urlparse

from .agentcore_search import AgentCoreWebSearchClient


LOGGER = logging.getLogger(__name__)


class DDGSSearchClient:
    provider = "duckduckgo"
    _request_slots = BoundedSemaphore(2)

    def __init__(self, *, timeout: int = 15) -> None:
        try:
            from ddgs import DDGS
        except ImportError as exc:
            raise RuntimeError(
                "The ddgs package is not installed. Run: pip install -r requirements.txt"
            ) from exc
        self.client_class = DDGS
        self.timeout = timeout

    def search(self, query: str, max_results: int = 4) -> list[dict[str, Any]]:
        results = []
        last_error: Exception | None = None
        for attempt in range(2):
            try:
                with self._request_slots:
                    client = self.client_class(timeout=self.timeout)
                    results = client.text(
                        query,
                        region="wt-wt",
                        safesearch="moderate",
                        max_results=max(1, max_results),
                        backend="duckduckgo",
                    )
                if results:
                    break
            except Exception as exc:  # noqa: BLE001 - caller owns provider fallback.
                last_error = exc
            if attempt == 0:
                sleep(0.35)
        if not results and last_error is not None:
            raise last_error
        rows = []
        for rank, item in enumerate(results or [], start=1):
            if not isinstance(item, dict):
                continue
            url = str(item.get("href") or item.get("url") or "").strip()
            if not is_http_url(url):
                continue
            rows.append(
                {
                    "url": url,
                    "title": str(item.get("title", "")).strip(),
                    "snippet": str(
                        item.get("body") or item.get("snippet") or ""
                    ).strip(),
                    "published_date": str(
                        item.get("date") or item.get("publishedDate") or ""
                    ).strip(),
                    "search_rank": rank,
                }
            )
        return rows


class FallbackWebSearchClient:
    provider = "duckduckgo_with_agentcore_fallback"

    def __init__(
        self,
        primary: DDGSSearchClient,
        fallback: AgentCoreWebSearchClient | None = None,
    ) -> None:
        self.primary = primary
        self.fallback = fallback

    def search(
        self,
        query: str,
        max_results: int = 4,
    ) -> dict[str, Any]:
        errors: list[dict[str, Any]] = []
        try:
            rows = self.primary.search(query, max_results)
            if rows:
                return {
                    "results": add_provider(rows, self.primary.provider),
                    "provider": self.primary.provider,
                    "fallback_used": False,
                    "errors": errors,
                }
            errors.append(
                search_error(
                    self.primary.provider,
                    query,
                    "empty_results",
                    "DuckDuckGo returned no usable search results.",
                )
            )
        except Exception as exc:  # noqa: BLE001 - fallback handles provider failures.
            errors.append(
                search_error(
                    self.primary.provider,
                    query,
                    "request_failed",
                    str(exc),
                )
            )

        if self.fallback is None:
            LOGGER.warning(
                "Web search failed without AgentCore fallback: query=%r errors=%r",
                query,
                errors,
            )
            return {
                "results": [],
                "provider": self.primary.provider,
                "fallback_used": False,
                "errors": errors,
            }

        try:
            rows = self.fallback.search(query, max_results)
            if rows:
                LOGGER.warning(
                    "DuckDuckGo search failed; AgentCore fallback succeeded: query=%r",
                    query,
                )
                return {
                    "results": add_provider(rows, "aws_agentcore_web_search"),
                    "provider": "aws_agentcore_web_search",
                    "fallback_used": True,
                    "errors": errors,
                }
            errors.append(
                search_error(
                    "aws_agentcore_web_search",
                    query,
                    "empty_results",
                    "AgentCore returned no usable search results.",
                )
            )
        except Exception as exc:  # noqa: BLE001 - errors are persisted by the audit.
            errors.append(
                search_error(
                    "aws_agentcore_web_search",
                    query,
                    "request_failed",
                    str(exc),
                )
            )

        LOGGER.error("All web search providers failed: query=%r errors=%r", query, errors)
        return {
            "results": [],
            "provider": "none",
            "fallback_used": True,
            "errors": errors,
        }


def search_error(
    provider: str,
    query: str,
    error_type: str,
    message: str,
) -> dict[str, Any]:
    return {
        "provider": provider,
        "query": query,
        "error_type": error_type,
        "error": message,
        "occurred_at": datetime.now(timezone.utc).isoformat(),
    }


def add_provider(
    rows: list[dict[str, Any]],
    provider: str,
) -> list[dict[str, Any]]:
    return [{**row, "search_provider": provider} for row in rows]


def is_http_url(url: str) -> bool:
    parsed = urlparse(url)
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)
