from __future__ import annotations

import json
import unittest
from unittest.mock import patch

from geo_audit.audit_summary import (
    build_audit_summary_payload,
    build_standing_sentence,
    generate_audit_summary,
    ordinal_rank,
    trim_to_sentence,
)


def patterns(mentions: int, responses: int, rank=None) -> dict:
    return {
        "user_recommendation_summary": {
            "responses_analyzed": responses,
            "user_mentions": mentions,
            "user_average_rank": rank,
            "prompts_where_user_was_recommended": [
                {"prompt": "Which providers specialise in process safety?"}
            ][:mentions],
            "prompts_where_user_was_not_recommended": [
                {"prompt": "Which providers automate PPE monitoring?"}
            ],
        },
        "top_competitors": [
            {
                "company_name": "Triya",
                "mention_frequency": 4,
                "sample_reasoning": ["Ships an on-premise edge box."],
            }
        ],
    }


PROFILE = {"company_name": "Kenesis", "category": "AI Video Analytics"}
ACTIONS = [{"suggested_change": "Add a page on real-time PPE monitoring."}]


class StandingSentenceTest(unittest.TestCase):
    """The count is code's to state. The whole point of the separate call is
    that a model can no longer write "recommended in none of the five" for a
    company the pipeline measured as recommended once."""

    def test_a_single_mention_is_never_written_away(self):
        sentence = build_standing_sentence("Kenesis", patterns(1, 5, 1))
        self.assertIn("1 of the 5 answers", sentence)
        self.assertIn("ranked first", sentence)
        self.assertNotIn("none", sentence.lower())

    def test_no_mentions_is_said_plainly(self):
        sentence = build_standing_sentence("Kenesis", patterns(0, 5))
        self.assertIn("not recommended in any of the 5", sentence)

    def test_no_answers_collected_is_not_reported_as_zero_mentions(self):
        sentence = build_standing_sentence("Kenesis", patterns(0, 0))
        self.assertIn("could not be measured", sentence)

    def test_rank_is_dropped_when_it_was_never_measured(self):
        sentence = build_standing_sentence("Kenesis", patterns(2, 5, None))
        self.assertIn("2 of the 5 answers", sentence)
        self.assertNotIn("ranked", sentence)

    def test_a_missing_company_name_still_reads_as_a_sentence(self):
        self.assertTrue(build_standing_sentence("", patterns(1, 5)).startswith("This company"))

    def test_a_whole_place_reads_as_a_word_and_an_average_as_a_number(self):
        self.assertEqual(ordinal_rank(1), "first")
        self.assertEqual(ordinal_rank(3), "third")
        self.assertEqual(ordinal_rank(4), "4th")
        self.assertEqual(ordinal_rank(2.6), "2.6 on average")
        self.assertEqual(ordinal_rank(None), "")
        self.assertEqual(ordinal_rank(0), "")


class PayloadTest(unittest.TestCase):
    """Only what a verdict needs. The recommendation call gets the whole report
    and wrote a verdict that disagreed with it."""

    def test_the_won_question_travels_with_the_losses(self):
        payload = build_audit_summary_payload(PROFILE, patterns(1, 5, 1), ACTIONS)
        data = json.loads(payload["messages"][-1]["content"])
        self.assertEqual(len(data["questions_it_won"]), 1)
        self.assertEqual(len(data["questions_it_lost"]), 1)
        self.assertEqual(data["leading_competitor"]["name"], "Triya")
        self.assertIn("PPE", data["top_suggested_change"])

    def test_the_payload_stays_small(self):
        payload = build_audit_summary_payload(PROFILE, patterns(1, 5, 1), ACTIONS)
        self.assertLess(len(payload["messages"][-1]["content"]), 4000)

    def test_no_competitors_and_no_actions_do_not_raise(self):
        bare = {"user_recommendation_summary": {"responses_analyzed": 5, "user_mentions": 0}}
        payload = build_audit_summary_payload(PROFILE, bare, None)
        data = json.loads(payload["messages"][-1]["content"])
        self.assertIsNone(data["leading_competitor"]["name"])
        self.assertIsNone(data["top_suggested_change"])


class TrimTest(unittest.TestCase):
    """A verdict that stops mid-word reads as a broken page. The previous
    700-character cut on the combined blob ended one report at "natural lan."."""

    def test_it_cuts_at_a_sentence_end(self):
        text = "First sentence here. Second sentence that would overflow the limit."
        self.assertEqual(trim_to_sentence(text, 40), "First sentence here.")

    def test_short_text_is_left_alone(self):
        self.assertEqual(trim_to_sentence("Short enough.", 400), "Short enough.")

    def test_it_keeps_whole_words_when_there_is_no_sentence_end(self):
        self.assertEqual(trim_to_sentence("one two three four five", 14), "one two three")


class GenerateTest(unittest.TestCase):
    def test_the_model_writes_only_what_follows_the_measured_sentence(self):
        with patch(
            "geo_audit.audit_summary.call_chat_completion",
            return_value="Triya is taking the questions. Add a PPE monitoring page.",
        ):
            summary, _payload, error = generate_audit_summary(
                PROFILE, patterns(1, 5, 1), ACTIONS
            )
        self.assertIsNone(error)
        self.assertTrue(summary.startswith("Kenesis was recommended in 1 of the 5 answers"))
        self.assertIn("Add a PPE monitoring page.", summary)

    def test_a_failed_call_still_leaves_a_true_verdict(self):
        from geo_audit.llm import LLMNotConfigured

        with patch(
            "geo_audit.audit_summary.call_chat_completion",
            side_effect=LLMNotConfigured("no key"),
        ):
            summary, _payload, error = generate_audit_summary(
                PROFILE, patterns(1, 5, 1), ACTIONS
            )
        self.assertEqual(error, "no key")
        self.assertIn("1 of the 5 answers", summary)

    def test_quotes_around_the_whole_answer_are_removed(self):
        with patch(
            "geo_audit.audit_summary.call_chat_completion",
            return_value='"Triya leads. Add a page."',
        ):
            summary, _payload, _error = generate_audit_summary(
                PROFILE, patterns(1, 5, 1), ACTIONS
            )
        self.assertNotIn('"', summary)

    def test_the_closing_action_sentence_is_not_trimmed_away(self):
        # The limit existed to catch a runaway, but set too tight it ate the one
        # sentence telling the owner what to do. A real two-sentence answer is
        # about 480 characters.
        answer = (
            "Triya is taking the questions because it explicitly targets manufacturing "
            "PPE monitoring and offers an on-premise edge box for keeping video on site, "
            "which buyers asked for when looking to automate real-time PPE monitoring "
            "using their existing CCTV cameras. "
            "Add a dedicated page describing real-time PPE monitoring with existing CCTV "
            "cameras, including edge deployment, latency, and how violations are reported."
        )
        with patch("geo_audit.audit_summary.call_chat_completion", return_value=answer):
            summary, _payload, _error = generate_audit_summary(
                PROFILE, patterns(1, 5, 1), ACTIONS
            )
        self.assertTrue(summary.rstrip().endswith("violations are reported."))


if __name__ == "__main__":
    unittest.main()
