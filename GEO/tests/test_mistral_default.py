from __future__ import annotations

import json
import unittest
from unittest.mock import patch

from geo_audit.llm import DEFAULT_BEDROCK_MODELS
from geo_audit.recommendations import collect_multi_model_recommendations


class MistralDefaultTests(unittest.TestCase):
    def test_paid_audit_uses_current_cost_efficient_mistral(self) -> None:
        self.assertEqual(
            DEFAULT_BEDROCK_MODELS["bedrock_mistral"],
            "mistral.mistral-large-3-675b-instruct",
        )

    def test_hidden_company_names_are_corrected_before_counting(self) -> None:
        hidden = {
            "answers": [
                {
                    "prompt_index": 1,
                    "answer_text": "These options are strong choices.",
                    "recommended_companies": [
                        {
                            "company_name": "Acme",
                            "rank": 1,
                            "reasoning": "Strong fit.",
                            "evidence_quote": "Acme is a strong choice.",
                            "explicitly_recommended": True,
                        }
                    ],
                    "overall_reasoning": "Strong fit.",
                    "unknowns": [],
                }
            ]
        }
        corrected = {
            "answers": [
                {
                    **hidden["answers"][0],
                    "answer_text": "Acme is a strong choice.",
                }
            ]
        }
        prompts = [
            {
                "prompt": "Which vendor should I consider?",
                "category": "Vendor",
                "buying_stage": "Discovery",
            }
        ]
        with patch(
            "geo_audit.recommendations.call_bedrock_converse",
            side_effect=[
                (json.dumps(hidden), {"model": "mistral-large-3"}),
                (json.dumps(corrected), {"model": "mistral-large-3"}),
            ],
        ) as bedrock_call:
            results, _payloads, errors = collect_multi_model_recommendations(
                prompts,
                assistants=["bedrock_mistral"],
                limit_per_assistant=1,
            )

        self.assertEqual(errors, [])
        self.assertEqual(bedrock_call.call_count, 2)
        self.assertEqual(results[0]["recommended_companies"][0]["company_name"], "Acme")
        self.assertTrue(results[0]["provider_batch"]["question_count"])


if __name__ == "__main__":
    unittest.main()
