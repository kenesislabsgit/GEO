from __future__ import annotations

import json
from pathlib import Path
import unittest

from geo_audit.crawler import same_page_key
from experiments.web_mention_agent.agent import (
    ExperimentState,
    build_experiment_input,
    missing_minimum_external_searches,
    tool_get_company_passages,
    tool_web_search,
    validate_output,
)
from geo_audit.web_mention_agent import (
    build_production_agent_input,
    merge_web_presence_results,
)


class FakeSearchClient:
    provider = "fake"

    def search(self, query: str, max_results: int = 2):
        return []


class RecordingSearchClient:
    provider = "recording"

    def __init__(self):
        self.calls = []

    def search(self, query: str, max_results: int = 2):
        self.calls.append((query, max_results))
        return [
            {"url": f"https://candidate-{index}.test/", "title": "", "snippet": ""}
            for index in range(1, 7)
        ]


class WebMentionAgentExperimentTests(unittest.TestCase):
    SOURCE = Path(__file__).parents[1] / "outputs" / "20260818-224605-typeform.com"

    def test_input_uses_top_five_and_withholds_one_real_link(self):
        payload, private = build_experiment_input(
            self.SOURCE, remove_link_for="UserTesting"
        )
        self.assertEqual(len(payload["companies"]), 6)
        self.assertEqual(
            [row["company_name"] for row in payload["companies"]],
            ["Typeform", "Jotform", "Formstack", "Qualtrics", "SurveyMonkey", "UserTesting"],
        )
        usertesting = next(
            row for row in payload["companies"] if row["company_name"] == "UserTesting"
        )
        self.assertEqual(usertesting["website_url"], "not_yet_found")
        self.assertEqual(private["withheld_original_url"], "https://usertesting.com")
        self.assertEqual(
            set(usertesting["assistant_answer_example"]), {"question", "answer"}
        )

    def test_passage_tool_accepts_only_external_search_urls(self):
        payload, private = build_experiment_input(
            self.SOURCE, remove_link_for="UserTesting"
        )
        state = ExperimentState(
            Path("unused-test-run"), payload, private, FakeSearchClient()
        )
        state.external_urls["company-01"].add(
            same_page_key("https://review.test/typeform")
        )

        def fake_fetch(url: str):
            return (
                "<html><title>Review</title><body>Typeform is an online form platform.</body></html>",
                200,
                url,
            )

        state.fetcher = fake_fetch
        result = tool_get_company_passages(
            state,
            {
                "pages": [
                    {
                        "company_id": "company-01",
                        "company_name": "Typeform",
                        "names_to_find": ["Typeform"],
                        "url": "https://review.test/typeform",
                    },
                    {
                        "company_id": "company-01",
                        "company_name": "Typeform",
                        "names_to_find": ["Typeform"],
                        "url": "https://not-searched.test/typeform",
                    },
                ]
            },
        )
        self.assertEqual(len(result["pages"]), 1)
        self.assertEqual(result["pages"][0]["matched_names"], ["Typeform"])
        self.assertEqual(
            result["rejected_requests"][0]["reason"],
            "url_was_not_returned_by_external_search",
        )

    def test_final_validation_requires_exact_tool_passage(self):
        payload, private = build_experiment_input(
            self.SOURCE, remove_link_for="UserTesting"
        )
        state = ExperimentState(
            Path("unused-test-run"), payload, private, FakeSearchClient()
        )
        key = same_page_key("https://review.test/typeform")
        state.external_urls["company-01"].add(key)
        state.passage_index[("company-01", key)] = {
            "passage-01": "Typeform is an online form platform."
        }
        parsed = {
                "companies": [
                    {
                        "company_name": "Typeform",
                        "verified_web_mentions": [
                            {
                                "url": "https://review.test/typeform",
                                "reason_for_choosing": "Correct company and product.",
                                "supporting_passage_ids": ["passage-01"],
                            },
                            {
                                "url": "https://review.test/invented",
                                "reason_for_choosing": "Invented.",
                                "supporting_passage_ids": ["passage-99"],
                            },
                        ],
                    }
                ]
        }
        validated, report = validate_output(state, parsed)
        self.assertEqual(
            len(validated["companies"][0]["verified_web_mentions"]), 1
        )
        self.assertEqual(len(report["rejected_items"]), 1)

    def test_missing_official_site_is_kept_only_after_search_and_page_read(self):
        payload, private = build_experiment_input(
            self.SOURCE, remove_link_for="UserTesting"
        )
        state = ExperimentState(
            Path("unused-test-run"), payload, private, FakeSearchClient()
        )
        candidate = "https://www.usertesting.com/"
        state.official_candidate_urls["company-06"].add(same_page_key(candidate))
        state.homepage_reads.append(
            {
                "company_id": "company-06",
                "requested_url": candidate,
                "final_url": candidate,
                "status": "ok",
            }
        )
        parsed = {
            "companies": [
                {
                    "company_name": "UserTesting",
                    "official_website_url": candidate,
                    "verified_web_mentions": [],
                }
            ]
        }

        validated, _report = validate_output(state, parsed)
        usertesting = next(
            row
            for row in validated["companies"]
            if row["company_name"] == "UserTesting"
        )
        self.assertEqual(usertesting["official_website_url"], candidate)

    def test_passage_tool_rejects_external_url_redirecting_to_official_site(self):
        payload, private = build_experiment_input(
            self.SOURCE, remove_link_for="UserTesting"
        )
        state = ExperimentState(
            Path("unused-test-run"), payload, private, FakeSearchClient()
        )
        searched_url = "https://forms.example.test/typeform"
        state.external_urls["company-01"].add(same_page_key(searched_url))

        def fake_fetch(url: str):
            return (
                "<html><body>Typeform is an online form platform.</body></html>",
                200,
                "https://www.typeform.com/",
            )

        state.fetcher = fake_fetch
        result = tool_get_company_passages(
            state,
            {
                "pages": [
                    {
                        "company_id": "company-01",
                        "company_name": "Typeform",
                        "names_to_find": ["Typeform"],
                        "url": searched_url,
                    }
                ]
            },
        )
        self.assertEqual(result["pages"][0]["status"], "rejected")
        self.assertEqual(
            result["pages"][0]["reason"],
            "redirected_to_known_official_domain",
        )
        self.assertNotIn(
            ("company-01", same_page_key(searched_url)), state.passage_index
        )

    def test_official_search_uses_only_company_name_and_returns_five_candidates(self):
        payload, private = build_experiment_input(
            self.SOURCE, remove_link_for="UserTesting"
        )
        search = RecordingSearchClient()
        state = ExperimentState(Path("unused-test-run"), payload, private, search)
        result = tool_web_search(
            state,
            {
                "searches": [
                    {
                        "company_id": "company-06",
                        "query": "UserTesting unrelated Slack Zapier participant words",
                        "purpose": "official_website",
                    }
                ]
            },
        )
        self.assertEqual(search.calls, [('"UserTesting" official website', 6)])
        self.assertEqual(len(result["results"][0]["urls"]), 5)

    def test_minimum_search_guard_requires_two_external_searches_per_company(self):
        payload, private = build_experiment_input(
            self.SOURCE, remove_link_for="UserTesting"
        )
        state = ExperimentState(
            Path("unused-test-run"), payload, private, FakeSearchClient()
        )
        self.assertEqual(len(missing_minimum_external_searches(state)), 6)
        for company_id in state.companies:
            state.search_counts[(company_id, "external_mentions")] = 2
        self.assertEqual(missing_minimum_external_searches(state), [])

    def test_production_input_uses_merged_top_five_and_reported_websites(self):
        profile = {
            "company_name": "Acme",
            "domain": "acme.test",
        }
        patterns = {
            "company_name_groups": {"formstack forms": "Formstack"},
            "top_competitors": [
                {"company_name": "Formstack"},
                {"company_name": "Jotform"},
            ],
        }
        results = [
            {
                "assistant": "openai_search",
                "prompt_index": 1,
                "prompt": "Which form platform should I use?",
                "raw_response": "Formstack and Jotform are suitable options.",
                "recommended_companies": [
                    {
                        "company_name": "Formstack Forms",
                        "official_website": "https://www.formstack.com/forms",
                    },
                    {
                        "company_name": "Jotform",
                        "official_website": "https://www.jotform.com/pricing",
                    },
                ],
            }
        ]

        payload = build_production_agent_input(profile, results, patterns)

        self.assertEqual(
            [row["company_name"] for row in payload["companies"]],
            ["Acme", "Formstack", "Jotform"],
        )
        self.assertEqual(payload["companies"][0]["website_url"], "https://acme.test")
        self.assertEqual(
            payload["companies"][1]["website_url"], "https://www.formstack.com"
        )
        self.assertEqual(
            payload["companies"][2]["website_url"], "https://www.jotform.com"
        )

    def test_production_input_accepts_the_crawled_audited_website(self):
        payload = build_production_agent_input(
            {"company_name": "Fillout"},
            [],
            {"top_competitors": []},
            audited_website_url="https://www.fillout.com/pricing",
        )

        self.assertEqual(
            payload["companies"][0]["website_url"], "https://www.fillout.com"
        )

    def test_audited_company_can_be_researched_before_competitors_are_known(self):
        payload = build_production_agent_input(
            {"company_name": "Fillout"},
            [],
            {},
            max_competitors=0,
            audited_website_url="https://www.fillout.com",
        )

        self.assertEqual(len(payload["companies"]), 1)
        self.assertEqual(payload["companies"][0]["role"], "audited_company")

    def test_parallel_web_results_preserve_all_entities_and_counts(self):
        audited = {
            "status": "complete",
            "provider": "fake",
            "entities": [{"company_name": "Acme", "verified_mentions": [1]}],
            "search_errors": [],
            "agent_diagnostics_dir": "audit",
            "summary": {
                "entities_checked": 1,
                "queries_run": 2,
                "verified_mentions": 1,
                "integration_seconds": 10,
            },
        }
        competitors = {
            "status": "complete",
            "provider": "fake",
            "entities": [{"company_name": "Rival", "verified_mentions": [2, 3]}],
            "search_errors": [],
            "agent_diagnostics_dir": "competitors",
            "summary": {
                "entities_checked": 1,
                "queries_run": 2,
                "verified_mentions": 2,
                "integration_seconds": 20,
            },
        }

        result = merge_web_presence_results(audited, competitors)

        self.assertEqual(len(result["entities"]), 2)
        self.assertEqual(result["summary"]["verified_mentions"], 3)
        self.assertEqual(result["summary"]["branch_seconds"], [10.0, 20.0])


if __name__ == "__main__":
    unittest.main()
