from __future__ import annotations

import unittest

from .candidate_merge import (
    build_candidate_groups,
    build_final_counts,
    candidate_anchor,
)


class CandidateMergeTests(unittest.TestCase):
    def test_complete_brand_word_creates_candidate(self) -> None:
        self.assertEqual(
            candidate_anchor("formstack", "formstack forms"),
            "formstack",
        )

    def test_partial_lookalike_does_not_create_candidate(self) -> None:
        self.assertEqual(candidate_anchor("usertesting", "usertest pro"), "")

    def test_generic_company_word_does_not_create_candidate(self) -> None:
        self.assertEqual(candidate_anchor("company a", "company b"), "")

    def test_plain_parent_brand_connects_product_name(self) -> None:
        self.assertEqual(
            candidate_anchor("nuance", "dragon anywhere nuance"),
            "nuance",
        )

    def test_candidate_groups_keep_partial_lookalikes_apart(self) -> None:
        rows = [
            {"normalized_name": "formstack", "times_recommended": 5},
            {"normalized_name": "formstack forms", "times_recommended": 1},
            {"normalized_name": "usertesting", "times_recommended": 4},
            {"normalized_name": "usertest pro", "times_recommended": 1},
        ]

        groups = build_candidate_groups(rows)

        self.assertEqual(len(groups), 1)
        self.assertEqual(
            groups[0]["input_names"],
            ["formstack", "formstack forms"],
        )

    def test_medium_confidence_web_decision_does_not_change_counts(self) -> None:
        rows = [
            {
                "normalized_name": "voicepad",
                "display_names": ["VoicePad"],
                "times_recommended": 1,
            },
            {
                "normalized_name": "voicepad ai",
                "display_names": ["VoicePad AI"],
                "times_recommended": 1,
            },
        ]
        groups = build_candidate_groups(rows)
        decision = {
            "candidate_id": groups[0]["candidate_id"],
            "should_merge": True,
            "canonical_company": "VoicePad",
            "input_names": ["voicepad", "voicepad ai"],
            "confidence": "medium",
            "needs_web_search": False,
            "reason": "Not fully verified.",
        }

        final = build_final_counts(rows, groups, [], [decision])

        self.assertEqual(len(final["final_counts"]), 2)
        self.assertEqual(final["applied_merge_decisions"], [])


if __name__ == "__main__":
    unittest.main()
