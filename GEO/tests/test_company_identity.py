from __future__ import annotations

import unittest

from geo_audit.aggregation import (
    aggregate_recommendations,
    canonical_company_key,
    is_user_company,
)
from geo_audit.export import build_query_results


def answer(assistant: str, prompt: str, companies: list[tuple[str, int]]) -> dict:
    return {
        "assistant": assistant,
        "model": "test-model",
        "prompt": prompt,
        "recommended_companies": [
            {"company_name": name, "rank": rank} for name, rank in companies
        ],
    }


class CanonicalCompanyKeyTests(unittest.TestCase):
    def test_name_variants_share_one_key(self) -> None:
        keys = {
            canonical_company_key(name)
            for name in (
                "Kenesis",
                "Kenesis Labs",
                "Kenesis AI",
                "Kenesis Inc.",
                "kenesis.ai",
                "KENESIS  LABS",
            )
        }
        self.assertEqual(keys, {"kenesis"})

    def test_only_whole_trailing_words_are_dropped(self) -> None:
        # "AI" is part of the name here, not a suffix word after it.
        self.assertEqual(canonical_company_key("OpenAI"), "openai")

    def test_distinct_companies_stay_distinct(self) -> None:
        self.assertNotEqual(
            canonical_company_key("Amazon"),
            canonical_company_key("Amazon Web Services"),
        )
        self.assertNotEqual(
            canonical_company_key("Apple"),
            canonical_company_key("Apple Music"),
        )

    def test_a_company_actually_called_labs_keeps_its_name(self) -> None:
        self.assertEqual(canonical_company_key("Labs"), "labs")


class UserCompanyMatchTests(unittest.TestCase):
    def test_sub_product_counts_as_the_audited_company(self) -> None:
        self.assertTrue(is_user_company("Stripe Connect", {"stripe"}))

    def test_shorter_variant_counts_as_the_audited_company(self) -> None:
        # The profile says "Kenesis Labs"; the assistant wrote "Kenesis".
        self.assertTrue(is_user_company("Kenesis", {"kenesis labs"}))

    def test_unrelated_company_does_not_match(self) -> None:
        self.assertFalse(is_user_company("Adyen", {"stripe"}))


class CompetitorMergeTests(unittest.TestCase):
    def test_one_company_written_three_ways_is_one_competitor(self) -> None:
        raw = [
            answer("a", "q1", [("Kenesis Labs", 1), ("Adyen", 2)]),
            answer("b", "q1", [("Kenesis", 1)]),
            answer("c", "q2", [("kenesis.ai", 2)]),
        ]
        patterns = aggregate_recommendations(
            raw, user_company="Adyen", user_aliases=["Adyen"]
        )
        competitors = patterns["competitors"]
        self.assertEqual(len(competitors), 1)
        self.assertEqual(competitors[0]["mention_frequency"], 3)
        self.assertEqual(
            competitors[0]["name_variants"], ["Kenesis", "Kenesis Labs", "kenesis.ai"]
        )

    def test_display_name_is_the_form_the_assistants_used_most(self) -> None:
        raw = [
            answer("a", "q1", [("Kenesis Labs", 1)]),
            answer("b", "q2", [("Kenesis Labs", 1)]),
            answer("c", "q3", [("Kenesis", 1)]),
        ]
        patterns = aggregate_recommendations(
            raw, user_company="Adyen", user_aliases=["Adyen"]
        )
        self.assertEqual(patterns["competitors"][0]["company_name"], "Kenesis Labs")


class BrandMatchInQueryResultsTests(unittest.TestCase):
    """The stored answer rows must use the same rule as the score, or the
    dashboard says 'not mentioned' for an answer the score counted."""

    def test_sub_product_mention_is_stored_with_its_rank(self) -> None:
        raw = [answer("a", "q1", [("Stripe Connect", 1), ("Adyen", 2)])]
        rows = build_query_results(raw, "Stripe", {})
        self.assertTrue(rows[0]["brand_mentioned"])
        self.assertEqual(rows[0]["brand_position"], 1)

    def test_name_variant_mention_is_stored_with_its_rank(self) -> None:
        raw = [answer("a", "q1", [("Kenesis", 3)])]
        rows = build_query_results(raw, "Kenesis Labs", {})
        self.assertTrue(rows[0]["brand_mentioned"])
        self.assertEqual(rows[0]["brand_position"], 3)

    def test_score_and_stored_rows_agree_on_the_mention_count(self) -> None:
        raw = [
            answer("a", "q1", [("Kenesis Labs", 1)]),
            answer("b", "q2", [("Adyen", 1)]),
        ]
        patterns = aggregate_recommendations(
            raw, user_company="Kenesis", user_aliases=["Kenesis"]
        )
        stored = build_query_results(raw, "Kenesis", {})
        self.assertEqual(
            patterns["user_recommendation_summary"]["user_mentions"],
            sum(1 for row in stored if row["brand_mentioned"]),
        )


if __name__ == "__main__":
    unittest.main()
