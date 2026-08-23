from __future__ import annotations

from contextlib import contextmanager
import json
import logging
import os
import random
import time
from typing import Any, Callable, Iterator, TypeVar
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


T = TypeVar("T")
TRANSIENT_STATUS = {408, 409, 425, 429, 500, 502, 503, 504, 520, 522, 524}
LOGGER = logging.getLogger(__name__)


def estimated_tokens(payload: Any) -> int:
    try:
        encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    except (TypeError, ValueError):
        encoded = str(payload)
    input_estimate = max(1, len(encoded.encode("utf-8")) // 4)
    output_estimate = 0
    if isinstance(payload, dict):
        for key in ("max_output_tokens", "max_tokens", "max_tokens_to_sample"):
            value = payload.get(key)
            if isinstance(value, (int, float)) and value > 0:
                output_estimate = max(output_estimate, int(value))
    if output_estimate == 0:
        try:
            output_estimate = max(
                0, int(os.environ.get("AI_DEFAULT_OUTPUT_TOKEN_ESTIMATE", "2000"))
            )
        except ValueError:
            output_estimate = 2000
    return input_estimate + output_estimate


@contextmanager
def provider_slot(provider: str, payload: Any) -> Iterator[None]:
    base = os.environ.get("AI_CONTROLLER_URL", "").rstrip("/")
    token = os.environ.get("AI_CONTROLLER_TOKEN", "")
    audit_id = os.environ.get("GEO_AUDIT_ID", "")
    if not base or not token or not audit_id:
        yield
        return

    lease_id = ""
    body = json.dumps(
        {
            "auditId": audit_id,
            "provider": provider,
            "estimatedTokens": estimated_tokens(payload),
        }
    ).encode("utf-8")
    request = Request(
        f"{base}/internal/ai/acquire",
        data=body,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urlopen(request, timeout=600) as response:
        lease = json.loads(response.read().decode("utf-8"))
        lease_id = str(lease.get("id") or "")
    if not lease_id:
        raise RuntimeError("AI controller returned no lease")

    try:
        yield
    finally:
        release = Request(
            f"{base}/internal/ai/release",
            data=json.dumps({"leaseId": lease_id}).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with urlopen(release, timeout=5) as response:
                response.read()
        except Exception:
            # The controller lease expires, so a lost release cannot block
            # later audits forever.
            pass


def run_ai_call(
    provider: str,
    payload: Any,
    operation: Callable[[], T],
    *,
    max_attempts: int = 3,
) -> T:
    """Run one provider request fairly and retry only temporary failures."""
    for attempt in range(max(1, max_attempts)):
        try:
            with provider_slot(provider, payload):
                return operation()
        except Exception as exc:
            if attempt + 1 >= max_attempts or not is_transient(exc):
                raise
            retry_after = retry_after_seconds(exc)
            close = getattr(exc, "close", None)
            if callable(close):
                close()
            delay = retry_after if retry_after is not None else 1.5 * (2**attempt)
            headers = getattr(exc, "headers", None)
            request_id = headers.get("x-request-id", "") if headers else ""
            LOGGER.warning(
                "Temporary AI failure; retrying provider=%s audit=%s attempt=%s/%s status=%s request_id=%s delay=%.2fs",
                provider,
                os.environ.get("GEO_AUDIT_ID", "manual"),
                attempt + 1,
                max_attempts,
                getattr(exc, "code", "network"),
                request_id,
                delay,
            )
            time.sleep(min(60.0, delay) + random.uniform(0.05, 0.35))
    raise RuntimeError("AI request attempts exhausted")


def is_transient(exc: Exception) -> bool:
    if isinstance(exc, HTTPError):
        return exc.code in TRANSIENT_STATUS
    if isinstance(exc, (URLError, TimeoutError, ConnectionError)):
        return True
    response = getattr(exc, "response", None)
    if isinstance(response, dict):
        status = response.get("ResponseMetadata", {}).get("HTTPStatusCode")
        if status in TRANSIENT_STATUS:
            return True
        code = str(response.get("Error", {}).get("Code", "")).lower()
        if any(word in code for word in ("throttl", "timeout", "unavailable")):
            return True
    text = str(exc).lower()
    return any(
        marker in text
        for marker in (
            "rate limit",
            "too many requests",
            "throttl",
            "temporarily unavailable",
            "connection reset",
            "timed out",
            "timeout",
            "error code: 520",
        )
    )


def retry_after_seconds(exc: Exception) -> float | None:
    headers = getattr(exc, "headers", None)
    if headers is None:
        return None
    value = headers.get("Retry-After")
    try:
        return max(0.0, float(value))
    except (TypeError, ValueError):
        return None
