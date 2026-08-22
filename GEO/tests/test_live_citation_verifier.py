from __future__ import annotations

import unittest
from unittest.mock import patch

from geo_audit.recommendations import LiveCitationVerifier


class LiveCitationVerifierTests(unittest.TestCase):
    def test_checks_each_unique_url_once_and_applies_results(self) -> None:
        rows = [
            {
                "assistant": "search",
                "prompt_index": 1,
                "provider_source_urls": ["https://a.test/page"],
                "provider_citation_origin": "native_openai_annotation",
            },
            {
                "assistant": "search",
                "prompt_index": 2,
                "provider_source_urls": ["https://a.test/page"],
                "provider_citation_origin": "native_openai_annotation",
            },
        ]

        with patch(
            "geo_audit.recommendations.verify_source_url",
            return_value={
                "url": "https://a.test/page",
                "resolved_url": "https://a.test/page",
                "verified": True,
            },
        ) as check:
            verifier = LiveCitationVerifier(concurrency=2)
            verifier.submit(rows[:1])
            verifier.submit(rows[1:])
            verified = verifier.finish(rows)

        check.assert_called_once()
        self.assertEqual(
            verified[0]["provider_source_urls"], ["https://a.test/page"]
        )
        self.assertEqual(
            verified[0]["provider_citation_origin"],
            "native_openai_annotation_verified",
        )
        self.assertTrue(
            verified[1]["provider_citation_verification"][0]["verified"]
        )


if __name__ == "__main__":
    unittest.main()
