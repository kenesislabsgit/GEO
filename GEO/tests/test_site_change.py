from __future__ import annotations

import unittest

from geo_audit.site_change import compare_website_snapshots, normalize_meaningful_text


def snapshot(*pages: tuple[str, str]) -> dict:
    return {
        "pages": [
            {
                "url": url,
                "title": "Company",
                "meta_description": "Product page",
                "headings": {"h1": ["Main product"]},
                "main_text": text,
            }
            for url, text in pages
        ]
    }


class SiteChangeTests(unittest.TestCase):
    def test_case_spacing_and_punctuation_are_cosmetic(self):
        old = snapshot(("https://example.com/", "Fast, Secure Product for Teams." * 30))
        new = snapshot(("https://EXAMPLE.com", " fast secure PRODUCT for teams " * 30))
        result = compare_website_snapshots(old, new)
        self.assertEqual(result["decision"], "reuse")
        self.assertEqual(result["content_change"], 0.0)

    def test_substantial_new_page_rebuilds(self):
        old = snapshot(("https://example.com/", "Stable home page content " * 40))
        new = snapshot(
            ("https://example.com/", "Stable home page content " * 40),
            ("https://example.com/platform", "New platform capability evidence " * 40),
        )
        result = compare_website_snapshots(old, new)
        self.assertEqual(result["decision"], "rebuild")
        self.assertTrue(result["substantive_added_pages"])

    def test_major_content_rewrite_rebuilds(self):
        old = snapshot(("https://example.com/", "Factory safety camera analytics " * 40))
        new = snapshot(("https://example.com/", "Restaurant payroll and table booking " * 40))
        result = compare_website_snapshots(old, new)
        self.assertEqual(result["decision"], "rebuild")

    def test_small_wording_change_reuses(self):
        body = "AI software helps industrial teams detect safety risks " * 50
        old = snapshot(("https://example.com/", body))
        new = snapshot(("https://example.com/", body + "Book a demonstration today."))
        result = compare_website_snapshots(old, new)
        self.assertEqual(result["decision"], "reuse")

    def test_numbers_are_not_removed(self):
        self.assertNotEqual(
            normalize_meaningful_text("Supports 10 cameras"),
            normalize_meaningful_text("Supports 100 cameras"),
        )

    def test_missing_fresh_data_rebuilds(self):
        result = compare_website_snapshots(
            snapshot(("https://example.com/", "Useful content " * 100)),
            {"pages": []},
        )
        self.assertEqual(result["decision"], "rebuild")
        self.assertEqual(result["confidence"], "low")


if __name__ == "__main__":
    unittest.main()
