from __future__ import annotations

from pathlib import Path
import unittest

from .flow import VerifiedGapFlow


class VerifiedGapFlowTests(unittest.TestCase):
    def setUp(self) -> None:
        self.flow = VerifiedGapFlow(Path("."), Path(".test-tmp") / "verified-gap-tests")

    def test_passages_have_stable_ids_and_exact_text(self) -> None:
        page = {"page_id": "p-1", "text": " ".join(f"word{n}" for n in range(240))}
        passages = self.flow._passages(page)
        self.assertEqual(passages[0]["passage_id"], "p-1:s001")
        self.assertIn(passages[0]["text"], page["text"])

    def test_supported_gap_rejects_wrong_company_page(self) -> None:
        pages = {
            "p-c": {"page_id": "p-c", "company_name": "Wrong Company", "text": "usable competitor content here"},
            "p-a": {"page_id": "p-a", "company_name": "Linear", "text": "usable audited content here"},
        }
        passages = {
            "p-c:s001": {"passage_id": "p-c:s001", "page_id": "p-c", "text": "usable competitor content here"},
            "p-a:s001": {"passage_id": "p-a:s001", "page_id": "p-a", "text": "usable audited content here"},
        }
        result = {
            "status": "SUPPORTED_GAP", "question_id": "q-1", "winner_company": "Asana",
            "competitor_page_id": "p-c", "competitor_passage_ids": ["p-c:s001"],
            "audited_page_id": "p-a", "audited_passage_ids": ["p-a:s001"],
            "competitor_proof": "This is enough competitor proof text.",
            "audited_company_proof": "This is enough audited company proof.",
            "direct_difference": "The competitor is more explicit about this need.",
            "buyer_need_connection": "The question directly asks about this buyer need.",
            "confidence": "high",
        }
        errors = self.flow._validate_research(
            result,
            {"question_id": "q-1", "winner_company": "Asana"},
            {"competitor_page_ids": ["p-c"], "audited_page_ids": ["p-a"]},
            pages,
            passages,
            "Linear",
        )
        self.assertIn("competitor page belongs to another company", errors)

    def test_rejected_research_needs_no_fake_evidence(self) -> None:
        errors = self.flow._validate_research(
            {"status": "INSUFFICIENT_DATA"}, {}, {}, {}, {}, "Linear"
        )
        self.assertEqual(errors, [])

    def test_research_schema_limits_ids_to_supplied_passages(self) -> None:
        schema = self.flow._research_schema_for(
            {"competitor_page_ids": ["p-c"], "audited_page_ids": ["p-a"]},
            {
                "opened_page_passages": [
                    {"page_id": "p-c", "passages": [{"passage_id": "p-c:s001"}]},
                    {"page_id": "p-a", "passages": [{"passage_id": "p-a:s001"}]},
                ]
            },
        )
        props = schema["properties"]
        self.assertEqual(props["competitor_page_id"]["enum"], ["p-c"])
        self.assertEqual(
            props["audited_passage_ids"]["items"]["enum"], ["p-a:s001"]
        )


if __name__ == "__main__":
    unittest.main()
