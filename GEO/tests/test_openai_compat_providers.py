"""The OpenAI-compatible provider layer.

Run: PYTHONPATH=<repo>/GEO python tests/test_openai_compat_providers.py
"""

from __future__ import annotations

import json
import unittest
from unittest import mock

from geo_audit.costs import PER_CALL_USD
from geo_audit.llm import (
    LLMNotConfigured,
    OPENAI_COMPAT_PROVIDERS,
    call_openai_compatible,
    openai_compatible_assistants,
)
from geo_audit.recommendations import supported_assistants


class Registry(unittest.TestCase):
    def test_all_seven_are_supported_assistants(self) -> None:
        expected = {"perplexity", "grok", "deepseek", "kimi", "groq", "minimax", "sarvam"}
        self.assertEqual(openai_compatible_assistants(), expected)
        self.assertTrue(expected.issubset(supported_assistants()))

    def test_every_provider_has_a_cost_estimate(self) -> None:
        for provider in openai_compatible_assistants():
            self.assertIn(provider, PER_CALL_USD, provider)

    def test_registry_shape(self) -> None:
        for provider, config in OPENAI_COMPAT_PROVIDERS.items():
            self.assertTrue(config["key_envs"], provider)
            self.assertTrue(config["base"].startswith("https://"), provider)
            self.assertTrue(config["model"], provider)


class Calls(unittest.TestCase):
    def test_missing_key_raises_not_configured(self) -> None:
        with mock.patch.dict("os.environ", {}, clear=True):
            with mock.patch("geo_audit.llm.load_dotenv"):
                for provider in openai_compatible_assistants():
                    with self.assertRaises(LLMNotConfigured, msg=provider):
                        call_openai_compatible(provider, "system", "question")

    def test_successful_call_parses_openai_shape(self) -> None:
        body = json.dumps(
            {
                "model": "sonar",
                "choices": [{"message": {"content": "Here are five options."}}],
                "usage": {"total_tokens": 42},
            }
        ).encode("utf-8")

        class FakeResponse:
            def read(self) -> bytes:
                return body

            def __enter__(self):
                return self

            def __exit__(self, *args: object) -> None:
                return None

        captured: dict[str, object] = {}

        def fake_urlopen(request, timeout=0):
            captured["url"] = request.full_url
            captured["auth"] = request.headers.get("Authorization")
            captured["payload"] = json.loads(request.data.decode("utf-8"))
            return FakeResponse()

        with mock.patch.dict(
            "os.environ", {"PERPLEXITY_API_KEY": "pk-test"}, clear=True
        ):
            with mock.patch("geo_audit.llm.load_dotenv"):
                with mock.patch("geo_audit.llm.urlopen", fake_urlopen):
                    content, metadata = call_openai_compatible(
                        "perplexity", "be neutral", "best crm?"
                    )

        self.assertEqual(content, "Here are five options.")
        self.assertEqual(metadata["model"], "sonar")
        self.assertEqual(
            captured["url"], "https://api.perplexity.ai/chat/completions"
        )
        self.assertEqual(captured["auth"], "Bearer pk-test")
        payload = captured["payload"]
        self.assertEqual(payload["messages"][0]["role"], "system")
        self.assertEqual(payload["messages"][1]["content"], "best crm?")


if __name__ == "__main__":
    unittest.main()
