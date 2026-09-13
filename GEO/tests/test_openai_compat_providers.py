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
    def test_all_eight_are_supported_assistants(self) -> None:
        expected = {"perplexity", "grok", "deepseek", "kimi", "groq", "minimax", "sarvam", "qwen"}
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
    def test_grok_search_uses_responses_and_preserves_only_native_citations(self):
        body = {"model": "grok-4.3", "status": "completed", "output": [
            {"type": "web_search_call", "action": {"sources": [{"url": "https://example.com/uncited"}]}},
            {"type": "message", "content": [{"type": "output_text", "text": "answer",
              "annotations": [{"type": "url_citation", "url": "https://example.com/proof"}]}]},
        ], "usage": {"total_tokens": 90}}
        response = mock.MagicMock()
        response.__enter__.return_value.read.return_value = json.dumps(body).encode()
        with mock.patch.dict("os.environ", {"GROK_API_KEY": "test"}, clear=True), mock.patch(
            "geo_audit.llm.load_dotenv"
        ), mock.patch("geo_audit.llm.urlopen", return_value=response) as send:
            answer, metadata = call_openai_compatible("grok", "system", "question", json_schema={"type": "object"})
        request = send.call_args.args[0]
        payload = json.loads(request.data)
        self.assertTrue(request.full_url.endswith("/v1/responses"))
        self.assertEqual(payload["tools"], [{"type": "web_search"}])
        self.assertEqual(
            payload["prompt_cache_key"], "geo-audit-v1-grok-buyer-answers"
        )
        self.assertEqual(payload["text"]["format"]["type"], "json_schema")
        self.assertEqual(answer, "answer")
        self.assertEqual(metadata["citations"], ["https://example.com/proof"])
        self.assertEqual(metadata["usage"]["total_tokens"], 90)

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
                "citations": ["https://example.com/evidence"],
                "search_results": [{"url": "https://example.com/evidence", "title": "Evidence"}],
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
                        "perplexity", "be neutral", "best crm?",
                        json_schema={"type": "object", "properties": {}},
                    )

        self.assertEqual(content, "Here are five options.")
        self.assertEqual(metadata["model"], "sonar")
        self.assertEqual(metadata["citations"], ["https://example.com/evidence"])
        self.assertEqual(metadata["search_results"][0]["title"], "Evidence")
        self.assertEqual(
            captured["url"], "https://api.perplexity.ai/chat/completions"
        )
        self.assertEqual(captured["auth"], "Bearer pk-test")
        payload = captured["payload"]
        self.assertEqual(payload["response_format"]["type"], "json_schema")
        self.assertEqual(payload["messages"][0]["role"], "system")
        self.assertEqual(payload["messages"][1]["content"], "best crm?")


if __name__ == "__main__":
    unittest.main()
