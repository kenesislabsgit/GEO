"""Network guard for every fetch of a URL the pipeline did not choose itself.

The audited website, its redirects, competitor sites, and every URL an AI
answer cites are hostile input. This module is the one place that decides
whether such a URL may be fetched:

  - http/https only, no credentials, default ports only
  - the hostname must resolve, and every resolved address must be public —
    loopback, RFC1918, link-local (cloud metadata), CGNAT, multicast,
    reserved and documentation ranges are refused, IPv4 and IPv6
  - DNS is re-resolved and re-checked on every redirect hop
  - redirects are followed manually and capped
  - responses are read in chunks against a byte ceiling

A worker should still run behind egress rules that block internal ranges —
that infrastructure layer is the backstop for DNS answers that change
between our check and the connect.
"""

from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlparse, urljoin
from urllib.request import HTTPRedirectHandler, Request, build_opener


class BlockedUrlError(ValueError):
    """The URL points somewhere this pipeline must never fetch."""


MAX_REDIRECTS = 5
DEFAULT_MAX_BYTES = 3 * 1024 * 1024
USER_AGENT = "RankedByAI-Audit/1.0"


def _is_public_address(value: str) -> bool:
    try:
        address = ipaddress.ip_address(value)
    except ValueError:
        return False
    if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped:
        address = address.ipv4_mapped
    return not (
        address.is_private
        or address.is_loopback
        or address.is_link_local
        or address.is_multicast
        or address.is_reserved
        or address.is_unspecified
        or (isinstance(address, ipaddress.IPv4Address)
            and address in ipaddress.ip_network("100.64.0.0/10"))
    ) and address.is_global


def assert_url_allowed(url: str) -> None:
    """Raise BlockedUrlError unless this exact URL is safe to fetch now."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise BlockedUrlError(f"Scheme not allowed: {parsed.scheme or '(none)'}")
    if parsed.username or parsed.password:
        raise BlockedUrlError("Credentials in URLs are not allowed.")
    host = parsed.hostname
    if not host:
        raise BlockedUrlError("URL has no host.")
    port = parsed.port
    if port is not None and port not in (80, 443):
        raise BlockedUrlError(f"Port not allowed: {port}")

    # A literal IP is judged directly; a hostname is resolved and every
    # answer must be public. One private A record fails the whole host —
    # that is what defeats half-and-half rebinding setups.
    try:
        ipaddress.ip_address(host)
        literal = True
    except ValueError:
        literal = False
    if literal:
        if not _is_public_address(host):
            raise BlockedUrlError("Address is not publicly routable.")
        return
    try:
        infos = socket.getaddrinfo(host, port or 80, proto=socket.IPPROTO_TCP)
    except OSError as error:
        raise BlockedUrlError(f"Host does not resolve: {host}") from error
    if not infos:
        raise BlockedUrlError(f"Host does not resolve: {host}")
    for info in infos:
        if not _is_public_address(str(info[4][0])):
            raise BlockedUrlError("Host resolves to a non-public address.")


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: N802
        return None


_opener = build_opener(_NoRedirect)


def open_url_guarded(
    url: str,
    *,
    timeout: int = 15,
    max_bytes: int = DEFAULT_MAX_BYTES,
    headers: dict[str, str] | None = None,
):
    """Fetch a hostile URL: validate every hop, cap the body.

    Returns (final_url, headers, body_bytes). Raises BlockedUrlError for
    anything the guard refuses and OSError/HTTPError for network failures.
    """
    current = url
    for _ in range(MAX_REDIRECTS + 1):
        assert_url_allowed(current)
        request = Request(
            current,
            headers={"User-Agent": USER_AGENT, **(headers or {})},
        )
        try:
            response = _opener.open(request, timeout=timeout)
        except Exception as error:  # HTTPError for 3xx lands here too
            status = getattr(error, "code", None)
            if status in (301, 302, 303, 307, 308):
                location = getattr(error, "headers", {}).get("Location")
                if not location:
                    raise BlockedUrlError("Redirect without a destination.")
                current = urljoin(current, location)
                continue
            raise
        try:
            chunks: list[bytes] = []
            received = 0
            while True:
                chunk = response.read(65536)
                if not chunk:
                    break
                received += len(chunk)
                if received > max_bytes:
                    raise BlockedUrlError("Response body exceeds the size limit.")
                chunks.append(chunk)
            return response.geturl(), dict(response.headers), b"".join(chunks)
        finally:
            response.close()
    raise BlockedUrlError("Too many redirects.")
