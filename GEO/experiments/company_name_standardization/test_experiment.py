from __future__ import annotations

import unittest

from .experiment import assemble_lowercase_names, verify_merge_groups


class CompanyNameStandardizationExperimentTests(unittest.TestCase):
    def test_lowercase_grouping_combines_case_only_variants(self) -> None:
        results = [
            {
                "assistant": "one",
                "prompt_index": 1,
                "recommended_companies": [{"company_name": "Jotform"}],
            },
            {
                "assistant": "two",
                "prompt_index": 2,
                "recommended_companies": [{"company_name": "JotForm"}],
            },
        ]

        rows = assemble_lowercase_names(results)

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["normalized_name"], "jotform")
        self.assertEqual(rows[0]["times_recommended"], 2)
        self.assertEqual(rows[0]["display_names"], ["Jotform", "JotForm"])

    def test_merge_verification_never_loses_an_input_name(self) -> None:
        rows = [
            {
                "normalized_name": "jotform",
                "display_names": ["Jotform"],
            },
            {
                "normalized_name": "jotform workflows",
                "display_names": ["Jotform Workflows"],
            },
            {
                "normalized_name": "typeform",
                "display_names": ["Typeform"],
            },
        ]
        groups = [
            {
                "canonical_name": "Jotform",
                "input_names": ["jotform", "jotform workflows"],
                "official_website": "https://jotform.com",
                "reason": "Same vendor.",
            }
        ]

        verified = verify_merge_groups(groups, rows)

        self.assertEqual(verified["alias_map"]["jotform workflows"], "Jotform")
        self.assertEqual(verified["alias_map"]["typeform"], "Typeform")
        self.assertEqual(verified["missing_names_kept_separate"], ["typeform"])


if __name__ == "__main__":
    unittest.main()
