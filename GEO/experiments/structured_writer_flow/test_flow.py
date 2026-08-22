from __future__ import annotations

import unittest

from .flow import StructuredWriterFlow
from . import prompts


class StructuredWriterFlowTests(unittest.TestCase):
    def setUp(self) -> None:
        self.flow = object.__new__(StructuredWriterFlow)

    def test_prompts_are_generic(self) -> None:
        combined = " ".join(
            value for name, value in vars(prompts).items() if name.endswith("_PROMPT")
        ).lower()
        for audit_specific_name in ("linear", "jira", "typeform", "atlassian"):
            self.assertNotIn(audit_specific_name, combined)

    def test_bundle_requires_both_opened_pages(self) -> None:
        pages = {
            "p-1": {"company_name": "Rival", "text": "Useful competitor proof with enough real words for this exact quote."},
            "p-2": {"company_name": "Customer", "text": "Useful audited company proof with enough real words for this exact quote."},
        }
        judgment = {
            "valid": True,
            "competitor_page_id": "p-1",
            "audited_page_id": "p-2",
            "competitor_quote": "Useful competitor proof with enough real words for this exact quote.",
            "audited_company_quote": "Useful audited company proof with enough real words for this exact quote.",
            "competitor_proof": "The competitor page explains this buyer capability.",
            "audited_company_proof": "The audited page does not explain that capability.",
            "proven_gap": "The buyer need is clearer on the competitor page.",
            "specific_action": "Update the relevant audited page with verifiable details.",
            "confidence": "high",
        }
        valid, errors = self.flow._validate_bundle(
            judgment,
            {"competitor_page_ids": ["p-1"], "audited_page_ids": []},
            pages,
            "Customer",
        )
        self.assertFalse(valid)
        self.assertIn("audited-company page was not opened for this bundle", errors)

    def test_bundle_accepts_a_valid_two_sided_comparison(self) -> None:
        pages = {
            "p-1": {"company_name": "Rival", "text": "Useful competitor proof with enough real words for this exact quote."},
            "p-2": {"company_name": "Customer", "text": "Useful audited company proof with enough real words for this exact quote."},
        }
        judgment = {
            "valid": True,
            "competitor_page_id": "p-1",
            "audited_page_id": "p-2",
            "competitor_quote": "Useful competitor proof with enough real words for this exact quote.",
            "audited_company_quote": "Useful audited company proof with enough real words for this exact quote.",
            "competitor_proof": "The competitor page explains this buyer capability.",
            "audited_company_proof": "The audited page does not explain that capability.",
            "proven_gap": "The buyer need is clearer on the competitor page.",
            "specific_action": "Update the relevant audited page with verifiable details.",
            "confidence": "high",
        }
        valid, errors = self.flow._validate_bundle(
            judgment,
            {"competitor_page_ids": ["p-1"], "audited_page_ids": ["p-2"]},
            pages,
            "Customer",
        )
        self.assertTrue(valid, errors)

    def test_exact_quote_corrects_a_wrong_opened_page_id(self) -> None:
        pages = {
            "p-1": {"company_name": "Rival", "text": "Useful competitor proof with enough real words for this exact quote."},
            "p-2": {"company_name": "Customer", "text": "An unrelated audited page with enough words to remain readable."},
            "p-3": {"company_name": "Customer", "text": "Useful audited company proof with enough real words for this exact quote."},
        }
        judgment = {
            "valid": True,
            "competitor_page_id": "p-1",
            "audited_page_id": "p-2",
            "competitor_quote": "Useful competitor proof with enough real words for this exact quote.",
            "audited_company_quote": "Useful audited company proof with enough real words for this exact quote.",
            "competitor_proof": "The competitor page explains this buyer capability.",
            "audited_company_proof": "The audited page explains the current related capability.",
            "proven_gap": "The buyer need is clearer on the competitor page.",
            "specific_action": "Update the relevant audited page with verifiable details.",
            "confidence": "high",
        }
        valid, errors = self.flow._validate_bundle(
            judgment,
            {"competitor_page_ids": ["p-1"], "audited_page_ids": ["p-2", "p-3"]},
            pages,
            "Customer",
        )
        self.assertTrue(valid, errors)
        self.assertEqual(judgment["audited_page_id"], "p-3")

    def test_final_writer_cannot_change_evidence_ids(self) -> None:
        selected = [{"bundle_id": f"bundle-{index}"} for index in range(5)]
        bundles = {
            item["bundle_id"]: {
                "competitor_page_id": f"c-{index}",
                "audited_page_id": f"a-{index}",
                "improvement_domain": f"domain-{index}",
            }
            for index, item in enumerate(selected)
        }
        recommendations = [
            {
                "bundle_id": item["bundle_id"],
                "competitor_page_id": f"c-{index}",
                "audited_page_id": f"a-{index}",
                "improvement_domain": f"domain-{index}",
                "suggested_change": f"Distinct change {index}",
            }
            for index, item in enumerate(selected)
        ]
        recommendations[2]["competitor_page_id"] = "wrong"
        errors = self.flow._validate_final(
            {"recommendations": recommendations}, selected, bundles
        )
        self.assertTrue(any("competitor page ID changed" in error for error in errors))


if __name__ == "__main__":
    unittest.main()
