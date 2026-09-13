import json
import threading
import unittest
from unittest.mock import patch

from geo_audit.recommendations import collect_multi_model_recommendations


class NewAssistants(unittest.TestCase):
    def response(self, provider, system, prompt, **kwargs):
        index = json.loads(prompt)["questions"][0]["prompt_index"]
        return json.dumps({"answers": [{
            "prompt_index": index, "answer_text": "Loom is a good choice for video messages.",
            "recommended_companies": [{"company_name": "Loom", "rank": 1,
                "reasoning": "Video messages", "evidence_quote": "Loom is a good choice",
                "explicitly_recommended": True}],
            "overall_reasoning": "Relevant", "unknowns": [],
        }]}), {"model": provider, "usage": {"total_tokens": 70},
               "citations": ["https://loom.com/", "https://loom.com/", "not-a-url"],
               "search_results": [{"url": "https://example.com/uncited"}]}

    def test_parallel_structured_answers_preserve_citations_without_analyzer(self):
        barrier = threading.Barrier(2)
        def answer(*args, **kwargs):
            barrier.wait(timeout=5)
            return self.response(*args, **kwargs)
        with patch("geo_audit.recommendations.call_openai_compatible", side_effect=answer), patch(
            "geo_audit.recommendations.analyze_provider_answer_batch",
            side_effect=AssertionError("Valid answers must not need another AI call"),
        ):
            results, _, errors = collect_multi_model_recommendations(
                ["Which video messaging tools are best?"], assistants=["perplexity", "grok"],
            )
        self.assertEqual(errors, [])
        self.assertEqual(len(results), 2)
        for result in results:
            self.assertEqual(result["recommended_companies"][0]["company_name"], "Loom")
            self.assertEqual(result["provider_source_urls"], ["https://loom.com/"])
            self.assertEqual(result["provider_batch"]["usage"]["total_tokens"], 70)

    def test_one_provider_failure_does_not_remove_other_answer(self):
        def answer(provider, *args, **kwargs):
            if provider == "grok":
                raise RuntimeError("credits unavailable")
            return self.response(provider, *args, **kwargs)
        with patch("geo_audit.recommendations.call_openai_compatible", side_effect=answer):
            results, _, errors = collect_multi_model_recommendations(
                ["Best video tools?"], assistants=["perplexity", "grok"],
            )
        self.assertEqual([r["assistant"] for r in results], ["perplexity"])
        self.assertEqual(errors[0]["assistant"], "grok")


if __name__ == "__main__":
    unittest.main()
