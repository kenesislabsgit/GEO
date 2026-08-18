from __future__ import annotations

import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from geo_audit.aggregation import (
    aggregate_recommendations,
    build_user_keys,
    is_user_company,
)
from geo_audit.company_merge import (
    MERGE_VOTES,
    collect_name_rows,
    drop_self_contradictions,
    generate_company_aliases,
    unanimous_aliases,
    verify_customer_group,
    verify_groups,
)


def answer(*names: str) -> dict:
    return {
        "prompt": "Which provider?",
        "prompt_category": "Test",
        "model": "m",
        "assistant": "a",
        "recommended_companies": [
            {"company_name": name, "rank": i + 1, "reasoning": f"why {name}"}
            for i, name in enumerate(names)
        ],
    }


class CollectTest(unittest.TestCase):
    def test_spellings_are_distinct_rows_with_counts(self):
        rows = collect_name_rows([answer("Otter.ai", "Trint"), answer("Otter.ai")])
        by_name = {r["name"]: r for r in rows}
        self.assertEqual(by_name["Otter.ai"]["times_recommended"], 2)
        self.assertEqual(by_name["Trint"]["times_recommended"], 1)

    def test_every_distinct_reason_travels_with_the_name(self):
        # Sampling one reason once sent "learns the user's preferences" for
        # Google and hid the three that said "integrated into Google Docs".
        results = [
            {
                "recommended_companies": [
                    {"company_name": "Google", "rank": 1, "reasoning": reason}
                ]
            }
            for reason in ["learns preferences", "integrated into Google Docs"]
        ]
        rows = collect_name_rows(results)
        self.assertEqual(
            rows[0]["reasons"], ["learns preferences", "integrated into Google Docs"]
        )

    def test_a_repeated_reason_is_only_sent_once(self):
        rows = collect_name_rows([answer("Otter.ai"), answer("Otter.ai")])
        self.assertEqual(rows[0]["reasons"], ["why Otter.ai"])

    def test_links_that_identify_nobody_are_dropped(self):
        results = [
            {
                "recommended_companies": [
                    {
                        "company_name": "Google",
                        "reasoning": "r",
                        "source_urls": [
                            # A markdown link squashed into one string.
                            "https://a.com/x](https://a.com/x",
                            # A redirect that hides whose site it is.
                            "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AB",
                            "https://docs.google.com/real",
                        ],
                    }
                ]
            }
        ]
        self.assertEqual(collect_name_rows(results)[0]["urls"], ["https://docs.google.com/real"])


class VerifyTest(unittest.TestCase):
    """The AI groups, code verifies. A group that fails does not merge -
    the recoverable failure - rather than merging wrongly or crashing."""

    KNOWN = {"Otter.ai", "Otter", "Trint", "Nuance", "Wispr Flow"}

    def test_a_good_group_becomes_aliases(self):
        aliases, rejected = verify_groups(
            [{"canonical": "Otter.ai", "variants": ["Otter"]}], self.KNOWN, set()
        )
        self.assertEqual(aliases, {"otter": "Otter.ai"})
        self.assertEqual(rejected, [])

    def test_an_invented_canonical_rejects_the_group(self):
        aliases, rejected = verify_groups(
            [{"canonical": "Otter Inc", "variants": ["Otter"]}], self.KNOWN, set()
        )
        self.assertEqual(aliases, {})
        self.assertEqual(rejected[0]["reason"], "invented canonical name")

    def test_an_invented_variant_is_dropped_but_the_group_survives(self):
        # An unknown variant can never match an answer at count time, so it is
        # inert; throwing away the whole group over it once cost a real audit
        # twelve legitimate Dragon merges.
        aliases, rejected = verify_groups(
            [{"canonical": "Otter.ai", "variants": ["Otter", "Otter Reworded"]}],
            self.KNOWN,
            set(),
        )
        self.assertEqual(aliases, {"otter": "Otter.ai"})
        self.assertEqual(rejected[0]["reason"], "unknown variant dropped")

    def test_a_name_cannot_sit_in_two_groups(self):
        aliases, rejected = verify_groups(
            [
                {"canonical": "Otter.ai", "variants": ["Otter"]},
                {"canonical": "Nuance", "variants": ["Otter"]},
            ],
            self.KNOWN,
            set(),
        )
        self.assertEqual(aliases, {"otter": "Otter.ai"})
        self.assertEqual(rejected[0]["reason"], "name in two groups")

    def test_the_audited_company_is_untouchable(self):
        aliases, rejected = verify_groups(
            [{"canonical": "Otter.ai", "variants": ["Wispr Flow"]}],
            self.KNOWN,
            {"wispr flow"},
        )
        self.assertEqual(aliases, {})
        self.assertEqual(rejected[0]["reason"], "touches the audited company")


class UnanimousTest(unittest.TestCase):
    """Rounds that disagree mark the doubtful groupings. Those are exactly the
    ones a real run got wrong, so hesitation means leave the name alone."""

    def test_a_grouping_every_round_made_is_kept(self):
        vote = {"otter": "Otter.ai"}
        self.assertEqual(unanimous_aliases([vote, vote, vote]), vote)

    def test_a_grouping_one_round_skipped_is_dropped(self):
        self.assertEqual(
            unanimous_aliases([{"otter": "Otter.ai"}, {}, {"otter": "Otter.ai"}]), {}
        )

    def test_rounds_naming_different_groups_agree_on_nothing(self):
        # "Google" landed on Docs Voice Typing one round and Cloud
        # Speech-to-Text the next. Same name, two answers, so neither stands.
        self.assertEqual(
            unanimous_aliases(
                [
                    {"google": "Google Docs Voice Typing"},
                    {"google": "Google Cloud Speech-to-Text"},
                    {"google": "Google Docs Voice Typing"},
                ]
            ),
            {},
        )


class SelfContradictionTest(unittest.TestCase):
    """Run live, the model put Sonix and Soniox in both lists in one reply, and
    the reason it gave for merging them said they were different companies."""

    def test_a_pair_it_called_different_never_merges(self):
        kept, contradictions = drop_self_contradictions(
            [{"canonical": "Sonix", "variants": ["Soniox"]}],
            [{"names": ["Sonix", "Soniox"], "why": "different companies"}],
        )
        self.assertEqual(kept, [])
        self.assertEqual(contradictions[0]["pairs"], [["soniox", "sonix"]])

    def test_one_bad_pair_does_not_cost_the_other_groups(self):
        kept, contradictions = drop_self_contradictions(
            [
                {"canonical": "Sonix", "variants": ["Soniox"]},
                {"canonical": "Otter.ai", "variants": ["Otter"]},
            ],
            [{"names": ["Sonix", "Soniox"]}],
        )
        self.assertEqual([g["canonical"] for g in kept], ["Otter.ai"])
        self.assertEqual(len(contradictions), 1)

    def test_groups_it_never_contradicted_survive(self):
        groups = [{"canonical": "Otter.ai", "variants": ["Otter"]}]
        kept, contradictions = drop_self_contradictions(
            groups, [{"names": ["Sonix", "Soniox"]}]
        )
        self.assertEqual(kept, groups)
        self.assertEqual(contradictions, [])

    def test_a_note_in_the_left_apart_list_still_blocks_the_merge(self):
        # Live, the model wrote a pair into left_apart with a why that said
        # "these are the same product, grouped under customer_group" - using
        # the list as a notes field. Read literally, as it must be, that threw
        # away a correct grouping and put the audited company into its own
        # competitor list. The prompt now says the list means one thing; this
        # records what the code does when it is used for anything else.
        kept, contradictions = drop_self_contradictions(
            [{"canonical": "Tally", "variants": ["Tally.so"]}],
            [{"names": ["Tally", "Tally.so"], "why": "same product, noted here"}],
        )
        self.assertEqual(kept, [])
        self.assertEqual(len(contradictions), 1)

    def test_no_left_apart_list_changes_nothing(self):
        groups = [{"canonical": "Otter.ai", "variants": ["Otter"]}]
        self.assertEqual(drop_self_contradictions(groups, None), (groups, []))


class CustomerGroupTest(unittest.TestCase):
    """The audited company's own spellings are grouped here too, so the
    counting and the export stop each deciding for themselves."""

    KNOWN = {"Wispr Flow", "Wispr", "Flow by Wispr", "Otter.ai"}

    def test_the_customers_own_spellings_point_at_the_customer(self):
        aliases, rejected = verify_customer_group(
            {"variants": ["Wispr", "Flow by Wispr"]}, [], self.KNOWN, "Wispr Flow"
        )
        self.assertEqual(
            aliases, {"wispr": "Wispr Flow", "flow by wispr": "Wispr Flow"}
        )
        self.assertEqual(rejected, [])

    def test_a_name_no_assistant_used_is_dropped(self):
        # A name the model made up would add mentions the company never earned.
        aliases, rejected = verify_customer_group(
            {"variants": ["Wispr Flow Pro"]}, [], self.KNOWN, "Wispr Flow"
        )
        self.assertEqual(aliases, {})
        self.assertEqual(rejected[0]["reason"], "customer name nobody used")

    def test_a_name_it_called_different_never_becomes_the_customer(self):
        aliases, rejected = verify_customer_group(
            {"variants": ["Otter.ai"]},
            [{"names": ["Wispr Flow", "Otter.ai"], "why": "different products"}],
            self.KNOWN,
            "Wispr Flow",
        )
        self.assertEqual(aliases, {})
        self.assertEqual(rejected[0]["reason"], "it also called this a different product")

    def test_no_customer_group_changes_nothing(self):
        self.assertEqual(verify_customer_group(None, [], self.KNOWN, "Wispr Flow"), ({}, []))

    def test_the_counting_and_the_export_agree_on_the_customer(self):
        # The two used to disagree: counting accepted anything starting with
        # the company name, the export accepted only an exact match.
        aliases = {"flow by wispr": "Wispr Flow"}
        keys = build_user_keys("Wispr Flow", None)
        for name in ["Wispr Flow", "Flow by Wispr", "Wispr Flow AI"]:
            self.assertTrue(is_user_company(name, keys, aliases), name)
        self.assertFalse(is_user_company("Otter.ai", keys, aliases))


class SearchToolTest(unittest.TestCase):
    """The grouping agent can look things up itself. Soniox and Sonix are two
    companies one letter apart and every round merged them without hesitating,
    so waiting for the model to report doubt was never going to work - what
    separates them is a fact from outside the audit."""

    ROWS = [answer("Sonix", "Soniox"), answer("Otter.ai", "Otter")]

    def run_merge(self, replies, search):
        with patch(
            "geo_audit.company_merge.call_chat_message", side_effect=replies
        ):
            return generate_company_aliases(
                self.ROWS,
                "Wispr Flow",
                ["Wispr Flow"],
                search_client=SimpleNamespace(search=search),
            )

    @staticmethod
    def asks_to_search(query):
        return {
            "content": None,
            "tool_calls": [
                {
                    "id": "call_1",
                    "type": "function",
                    "function": {
                        "name": "search_the_web",
                        "arguments": json.dumps({"query": query}),
                    },
                }
            ],
        }

    @staticmethod
    def answers(groups):
        return {"content": json.dumps({"groups": groups})}

    def test_the_agent_can_search_before_it_groups(self):
        # The question "are these two the same product" belongs to the pair,
        # not to either name, so only the agent can think to ask it.
        asked = []

        def search(query, max_results=4):
            asked.append(query)
            return {"results": [{"url": "https://sonix.ai", "title": "Sonix"}]}

        merge = [{"canonical": "Otter.ai", "variants": ["Otter"]}]
        replies = []
        for _round in range(MERGE_VOTES):
            replies.append(self.asks_to_search("Sonix or Soniox same product"))
            replies.append(self.answers(merge))
        aliases, artifact, error = self.run_merge(replies, search)

        self.assertIsNone(error)
        self.assertEqual(aliases, {"otter": "Otter.ai"})
        self.assertEqual(asked.count("Sonix or Soniox same product"), MERGE_VOTES)
        self.assertEqual(
            [item["query"] for item in artifact["rounds"][0]["searches_it_ran"]],
            ["Sonix or Soniox same product"],
        )

    def test_a_failed_search_does_not_stop_the_audit(self):
        def search(query, max_results=4):
            raise RuntimeError("search is down")

        replies = []
        for _round in range(MERGE_VOTES):
            replies.append(self.asks_to_search("anything"))
            replies.append(self.answers([]))
        aliases, artifact, error = self.run_merge(replies, search)

        self.assertIsNone(error)
        self.assertEqual(aliases, {})
        self.assertEqual(
            artifact["rounds"][0]["searches_it_ran"][0]["error"], "search is down"
        )

    def test_no_model_key_with_a_search_client_leaves_counts_as_they_are(self):
        from geo_audit.llm import LLMNotConfigured

        with patch(
            "geo_audit.company_merge.call_chat_message",
            side_effect=LLMNotConfigured("no key"),
        ):
            aliases, _artifact, error = generate_company_aliases(
                self.ROWS,
                "Wispr Flow",
                search_client=SimpleNamespace(
                    search=lambda q, max_results=4: {"results": []}
                ),
            )
        self.assertEqual(aliases, {})
        self.assertEqual(error, "no key")

    def test_without_a_search_client_the_merge_still_runs(self):
        with patch(
            "geo_audit.company_merge.call_chat_completion",
            return_value=json.dumps(
                {"groups": [{"canonical": "Otter.ai", "variants": ["Otter"]}]}
            ),
        ):
            aliases, _artifact, error = generate_company_aliases(
                self.ROWS, "Wispr Flow"
            )
        self.assertIsNone(error)
        self.assertEqual(aliases, {"otter": "Otter.ai"})



class GenerateTest(unittest.TestCase):
    def test_no_model_key_leaves_counts_as_they_are(self):
        from geo_audit.llm import LLMNotConfigured

        with patch(
            "geo_audit.company_merge.call_chat_completion",
            side_effect=LLMNotConfigured("no key"),
        ):
            aliases, _artifact, error = generate_company_aliases(
                [answer("Otter.ai", "Otter")], "Wispr Flow"
            )
        self.assertEqual(aliases, {})
        self.assertEqual(error, "no key")

    def test_a_single_name_makes_no_call_at_all(self):
        with patch("geo_audit.company_merge.call_chat_completion") as call:
            aliases, _artifact, error = generate_company_aliases(
                [answer("Otter.ai")], "Wispr Flow"
            )
        call.assert_not_called()
        self.assertEqual((aliases, error), ({}, None))


class AggregationMergeTest(unittest.TestCase):
    """The point of it all: one competitor, one count, however it was spelt."""

    def test_split_spellings_count_as_one_competitor(self):
        results = [answer("Otter.ai"), answer("Otter"), answer("Otter Voice Notes")]
        merged = aggregate_recommendations(
            results,
            user_company="Wispr Flow",
            company_aliases={"otter": "Otter.ai", "otter voice notes": "Otter.ai"},
        )
        top = merged["top_competitors"]
        self.assertEqual(len(top), 1)
        self.assertEqual(top[0]["company_name"], "Otter.ai")
        self.assertEqual(top[0]["mention_frequency"], 3)

    def test_without_aliases_counting_is_unchanged(self):
        results = [answer("Otter.ai"), answer("Otter")]
        plain = aggregate_recommendations(results, user_company="Wispr Flow")
        self.assertEqual(len(plain["top_competitors"]), 2)

    def test_answers_keep_their_own_spelling(self):
        results = [answer("Otter")]
        merged = aggregate_recommendations(
            results,
            user_company="Wispr Flow",
            company_aliases={"otter": "Otter.ai"},
        )
        losses = merged["user_recommendation_summary"][
            "prompts_where_user_was_not_recommended"
        ]
        self.assertEqual(losses[0]["recommended_instead"], ["Otter"])


class OneLanguageDownstreamTest(unittest.TestCase):
    """The merge renamed one side of several comparisons. These lock in that
    both sides now speak the group name, while readers still see the words the
    assistant actually wrote."""

    ALIASES = {"otter voice notes": "Otter.ai"}

    def losses(self):
        merged = aggregate_recommendations(
            [answer("Otter Voice Notes")],
            user_company="Wispr Flow",
            company_aliases=self.ALIASES,
        )
        return merged["user_recommendation_summary"][
            "prompts_where_user_was_not_recommended"
        ]

    def test_a_winner_carries_both_names(self):
        winner = self.losses()[0]["winners"][0]
        self.assertEqual(winner["company_name"], "Otter Voice Notes")
        self.assertEqual(winner["grouped_name"], "Otter.ai")

    def test_the_map_travels_with_the_numbers(self):
        merged = aggregate_recommendations(
            [answer("Otter Voice Notes")],
            user_company="Wispr Flow",
            company_aliases=self.ALIASES,
        )
        self.assertEqual(merged["company_name_groups"], self.ALIASES)

    def test_evidence_from_a_real_winner_is_kept(self):
        # The improvements page may only cite companies that beat the audited
        # company. Comparing a merged card label against the answer's own
        # spelling threw that proof away.
        from geo_audit.audit_recommendations import (
            keep_evidence_from_the_companies_that_won,
        )

        kept = keep_evidence_from_the_companies_that_won(
            [
                {
                    "affected_prompts": self.losses(),
                    "supporting_evidence": [
                        {"evidence_id": "e1", "company_name": "Otter.ai"}
                    ],
                }
            ]
        )
        self.assertEqual(len(kept[0]["supporting_evidence"]), 1)

    def test_a_bystander_is_still_dropped(self):
        from geo_audit.audit_recommendations import (
            keep_evidence_from_the_companies_that_won,
        )

        kept = keep_evidence_from_the_companies_that_won(
            [
                {
                    "affected_prompts": self.losses(),
                    "supporting_evidence": [
                        {"evidence_id": "e1", "company_name": "Trint"}
                    ],
                }
            ]
        )
        self.assertEqual(kept[0]["supporting_evidence"], [])

    def test_a_page_reaches_the_answer_that_used_another_spelling(self):
        from geo_audit.export import mentions_for_recommendations

        web_presence = {
            "entities": [
                {
                    "entity_type": "competitor",
                    "company_name": "Otter.ai",
                    "verified_mentions": [{"url": "https://example.com/otter"}],
                }
            ]
        }
        mentions = mentions_for_recommendations(
            [{"company_name": "Otter Voice Notes"}], web_presence, self.ALIASES
        )
        self.assertEqual(len(mentions), 1)


if __name__ == "__main__":
    unittest.main()
