from __future__ import annotations

import json
import unittest
from unittest.mock import patch

from geo_audit.free_recommendations import generate_free_recommendation


PROFILE = {"company_name": "Acme", "company_name_variants": ["Acme Inc"]}
SNAPSHOT = {
    "normalized_url": "https://acme.example",
    "pages": [
        {
            "url": "https://acme.example/workflows",
            "title": "Acme workflows",
            "text": "Acme supports approval steps for every publishing workflow.",
        }
    ],
}
RAW = [
    {
        "assistant": "openai_search",
        "prompt_index": 0,
        "prompt": "Which tool explains publishing approvals?",
        "recommended_companies": [
            {
                "company_name": "Rival",
                "rank": 1,
                "reasoning": "It documents approvals.",
                "source_urls": ["https://rival.example/approvals"],
            }
        ],
    }
]


class FreeRecommendationTests(unittest.TestCase):
    @patch("geo_audit.free_recommendations.parse_page")
    @patch("geo_audit.free_recommendations.fetch_html")
    @patch("geo_audit.free_recommendations.call_chat_completion")
    def test_builds_one_action_with_both_verified_pages(
        self, call, fetch, parse
    ) -> None:
        fetch.return_value = (b"page", 200, "https://rival.example/approvals")
        parse.return_value = {
            "title": "Rival approvals",
            "main_text": "Rival shows reviewers and approval routing on one page.",
        }
        call.return_value = json.dumps(
            {
                "status": "action",
                "title": "Connect approval proof",
                "observation": "Rival explains the workflow in one place.",
                "action": "Connect Acme's existing approval-step proof on the workflows page.",
                "expected_impact": "Makes the workflow easier to verify.",
                "buyer_candidate_id": "candidate-01",
                "audited_page_id": "audited-01",
                "competitor_page_id": "competitor-01",
                "confidence": "High",
                "audited_support_quote": "Acme supports approval steps",
                "competitor_support_quote": "Rival shows reviewers and approval routing",
                "no_action_reason": "",
            }
        )

        recommendations, _payload, diagnostics, error = generate_free_recommendation(
            PROFILE, SNAPSHOT, RAW
        )

        self.assertIsNone(error)
        self.assertEqual(len(recommendations), 1)
        self.assertEqual(len(recommendations[0]["supporting_evidence"]), 2)
        self.assertEqual(
            recommendations[0]["evidence_validation"]["accepted_refs"],
            ["competitor-01", "audited-01"],
        )
        self.assertTrue(diagnostics["quotes_valid"])

    @patch("geo_audit.free_recommendations.parse_page")
    @patch("geo_audit.free_recommendations.fetch_html")
    @patch("geo_audit.free_recommendations.call_chat_completion")
    def test_drops_an_action_with_an_invented_quote(self, call, fetch, parse) -> None:
        fetch.return_value = (b"page", 200, "https://rival.example/approvals")
        parse.return_value = {
            "title": "Rival approvals",
            "main_text": "Rival shows reviewers and approval routing on one page.",
        }
        call.return_value = json.dumps(
            {
                "status": "action",
                "title": "Unsafe action",
                "observation": "Comparison",
                "action": "Add a feature.",
                "expected_impact": "Unknown",
                "buyer_candidate_id": "candidate-01",
                "audited_page_id": "audited-01",
                "competitor_page_id": "competitor-01",
                "confidence": "High",
                "audited_support_quote": "Acme has enterprise SSO",
                "competitor_support_quote": "Rival shows reviewers",
                "no_action_reason": "",
            }
        )

        recommendations, _payload, diagnostics, error = generate_free_recommendation(
            PROFILE, SNAPSHOT, RAW
        )

        self.assertEqual(recommendations, [])
        self.assertFalse(diagnostics["quotes_valid"])
        self.assertIn("quotes", str(error))


if __name__ == "__main__":
    unittest.main()
