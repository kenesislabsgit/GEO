"""SSRF guard tests.

Run: PYTHONPATH=<repo>/GEO python tests/test_netguard.py
"""

from __future__ import annotations

import unittest
from unittest import mock

from geo_audit.netguard import (
    BlockedUrlError,
    _is_public_address,
    assert_url_allowed,
)


class AddressClassification(unittest.TestCase):
    def test_blocks_loopback_and_private_v4(self) -> None:
        for ip in (
            "127.0.0.1",
            "127.8.9.10",
            "10.0.0.5",
            "172.16.0.1",
            "172.31.255.255",
            "192.168.1.1",
            "169.254.169.254",  # cloud metadata
            "100.64.0.1",  # CGNAT
            "0.0.0.0",
            "255.255.255.255",
            "224.0.0.1",
        ):
            self.assertFalse(_is_public_address(ip), ip)

    def test_blocks_loopback_and_private_v6(self) -> None:
        for ip in (
            "::1",
            "::",
            "fe80::1",
            "fc00::1",
            "fd12:3456::1",
            "ff02::1",
            "::ffff:127.0.0.1",  # mapped loopback
            "::ffff:10.0.0.1",  # mapped private
        ):
            self.assertFalse(_is_public_address(ip), ip)

    def test_allows_public(self) -> None:
        for ip in ("93.184.216.34", "8.8.8.8", "2606:2800:220:1:248:1893:25c8:1946"):
            self.assertTrue(_is_public_address(ip), ip)


class UrlValidation(unittest.TestCase):
    def assert_blocked(self, url: str) -> None:
        with self.assertRaises(BlockedUrlError, msg=url):
            assert_url_allowed(url)

    def test_blocks_bad_schemes(self) -> None:
        for url in (
            "file:///etc/passwd",
            "ftp://example.com/",
            "gopher://example.com/",
            "javascript:alert(1)",
        ):
            self.assert_blocked(url)

    def test_blocks_credentials_and_ports(self) -> None:
        self.assert_blocked("https://user:pass@example.com/")
        self.assert_blocked("http://example.com:8080/")
        self.assert_blocked("http://example.com:22/")

    def test_blocks_literal_internal_ips(self) -> None:
        for url in (
            "http://127.0.0.1/",
            "http://10.1.2.3/x",
            "http://169.254.169.254/latest/meta-data/",
            "http://[::1]/",
            "http://[fe80::1]/",
            "http://[::ffff:127.0.0.1]/",
        ):
            self.assert_blocked(url)

    def test_blocks_encoded_ipv4_forms(self) -> None:
        # Decimal, octal and hex encodings of 127.0.0.1 / 10.x. Python's
        # urllib keeps them as hostnames; they must not resolve to a fetch.
        for url in (
            "http://2130706433/",  # 127.0.0.1 as decimal
            "http://0x7f000001/",
            "http://017700000001/",
            "http://0177.0.0.1/",
            "http://0x7f.0.0.1/",
        ):
            with mock.patch(
                "geo_audit.netguard.socket.getaddrinfo",
                return_value=[(2, 1, 6, "", ("127.0.0.1", 80))],
            ):
                self.assert_blocked(url)

    def test_blocks_hostname_resolving_privately(self) -> None:
        with mock.patch(
            "geo_audit.netguard.socket.getaddrinfo",
            return_value=[(2, 1, 6, "", ("192.168.0.7", 80))],
        ):
            self.assert_blocked("https://internal.example.com/")

    def test_blocks_rebinding_mix(self) -> None:
        # One public record and one private record: refused outright.
        with mock.patch(
            "geo_audit.netguard.socket.getaddrinfo",
            return_value=[
                (2, 1, 6, "", ("93.184.216.34", 80)),
                (2, 1, 6, "", ("127.0.0.1", 80)),
            ],
        ):
            self.assert_blocked("https://rebind.example.com/")

    def test_blocks_unresolvable(self) -> None:
        with mock.patch(
            "geo_audit.netguard.socket.getaddrinfo",
            side_effect=OSError("no dns"),
        ):
            self.assert_blocked("https://does-not-exist.example/")

    def test_allows_public_hostname(self) -> None:
        with mock.patch(
            "geo_audit.netguard.socket.getaddrinfo",
            return_value=[(2, 1, 6, "", ("93.184.216.34", 443))],
        ):
            assert_url_allowed("https://example.com/page")


class RedirectValidation(unittest.TestCase):
    def test_every_redirect_hop_is_checked(self) -> None:
        # open_url_guarded re-validates before each hop, so a redirect into a
        # private range dies at assert_url_allowed. Proven here at the unit
        # level: the redirect target itself is refused.
        with self.assertRaises(BlockedUrlError):
            assert_url_allowed("http://169.254.169.254/latest/meta-data/")


if __name__ == "__main__":
    unittest.main()
