"""Golden fixtures for the scorecard.

These pin the exact numbers the scoring package produces for fixed inputs.
If a change moves any of them, that change is a methodology change: bump
methodology_version in aggregation.py and update these goldens in the same
commit — never silently.

Run: PYTHONPATH=<repo>/GEO python tests/test_scoring_golden.py
"""

from __future__ import annotations

import unittest

from geo_audit.scoring import (
    POSITION_VALUES,
    SCORE_WEIGHTS,
    build_scorecard,
    position_value,
)


def raw_result(sources: bool = True) -> dict:
    return {
        "provider_source_urls": ["https://example.com/page"] if sources else [],
        "recommendations": [{"company_name": "Someone"}],
    }


def patterns(
    user_mentions: int,
    ranks: list[int],
    competitors: dict[str, int] | None = None,
) -> dict:
    return {
        "user_recommendation_summary": {"user_mentions": user_mentions},
        "prompt_statistics": {
            "prompt_outcomes": [{"user_rank": rank} for rank in ranks],
        },
        "competitors": [
            {"company_name": name, "mention_frequency": count}
            for name, count in (competitors or {}).items()
        ],
        "source_analysis": {},
    }


class WeightsAndCurveGoldens(unittest.TestCase):
    def test_weights_are_the_published_formula(self) -> None:
        self.assertEqual(
            SCORE_WEIGHTS,
            {
                "mention": 0.65,
                "position": 0.3,
                "citation": 0.0,
                "source_quality": 0.0,
                "data_confidence": 0.05,
            },
        )

    def test_rank_curve(self) -> None:
        self.assertEqual(POSITION_VALUES, {1: 100, 2: 80, 3: 65, 4: 50, 5: 35})
        self.assertEqual(position_value(1), 100)
        self.assertEqual(position_value(5), 35)
        self.assertEqual(position_value(6), 10)
        self.assertEqual(position_value(12), 10)
        self.assertEqual(position_value(0), 0)


class ScorecardGoldens(unittest.TestCase):
    """Same inputs, same numbers, forever — or a version bump."""

    def scorecard(self, raw_results, pattern_data):
        return build_scorecard(raw_results, pattern_data, {"competitors": []})

    def test_never_mentioned(self) -> None:
        raw = [raw_result(sources=False) for _ in range(4)]
        card = self.scorecard(raw, patterns(0, []))
        self.assertEqual(card["mention_score"], 0)
        self.assertEqual(card["position_score"], 0)
        self.assertEqual(card["citation_score"], 0)
        self.assertEqual(card["mention_rate"], 0)
        self.assertIsNone(card["average_position"])

    def test_always_first(self) -> None:
        raw = [raw_result() for _ in range(4)]
        card = self.scorecard(raw, patterns(4, [1, 1, 1, 1]))
        self.assertEqual(card["mention_score"], 100.0)
        self.assertEqual(card["position_score"], 100.0)
        self.assertEqual(card["citation_score"], 100)
        self.assertEqual(card["mention_rate"], 1.0)
        self.assertEqual(card["average_position"], 1.0)
        self.assertAlmostEqual(
            card["overall_score"],
            round(
                100 * 0.65 + 100 * 0.30 + card["data_confidence_score"] * 0.05,
                1,
            ),
            places=1,
        )

    def test_half_mentioned_positions_decay(self) -> None:
        raw = [raw_result(), raw_result(), raw_result(sources=False), raw_result(sources=False)]
        card = self.scorecard(raw, patterns(2, [1, 3]))
        self.assertEqual(card["mention_score"], 50.0)
        # (100 + 65) / 4 responses — coverage-weighted placement.
        self.assertEqual(card["position_score"], 41.2)
        self.assertEqual(card["mention_rate"], 0.5)
        self.assertEqual(card["average_position"], 2.0)

    def test_share_of_voice(self) -> None:
        raw = [raw_result(), raw_result()]
        card = self.scorecard(raw, patterns(2, [2, 2], {"Rival": 6}))
        self.assertAlmostEqual(card["share_of_voice"], round(2 / 8, 4))

    def test_competitor_rows_capped_and_shaped(self) -> None:
        many = {f"Rival {i}": 20 - i for i in range(20)}
        card = self.scorecard([raw_result()], patterns(1, [1], many))
        self.assertEqual(len(card["competitor_scores"]), 15)
        row = card["competitor_scores"][0]
        self.assertIn("name", row)
        self.assertIn("mentions", row)
        self.assertIn("mentions_by_assistant", row)

    def test_deterministic(self) -> None:
        raw = [raw_result(), raw_result(), raw_result(sources=False)]
        first = self.scorecard(raw, patterns(2, [1, 4], {"Rival": 1}))
        second = self.scorecard(raw, patterns(2, [1, 4], {"Rival": 1}))
        self.assertEqual(first, second)

    def test_score_explanation_describes_scope_without_changing_formula(self) -> None:
        card = self.scorecard([raw_result(sources=False)], patterns(0, []))
        self.assertIn("sampled AI buyer answers", card["score_explanation"]["scope"])
        component_names = {
            item["name"] for item in card["score_explanation"]["components"]
        }
        self.assertEqual(
            component_names,
            {"mention", "position", "citation", "source_quality", "data_confidence"},
        )


if __name__ == "__main__":
    unittest.main()
