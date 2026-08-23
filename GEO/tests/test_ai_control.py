from __future__ import annotations

import os
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

from geo_audit.ai_control import estimated_tokens, is_transient, run_ai_call


class AiControlTests(unittest.TestCase):
    def setUp(self) -> None:
        self.old_controller = os.environ.pop("AI_CONTROLLER_URL", None)

    def tearDown(self) -> None:
        if self.old_controller is not None:
            os.environ["AI_CONTROLLER_URL"] = self.old_controller

    @patch("geo_audit.ai_control.time.sleep", lambda _seconds: None)
    def test_retries_temporary_provider_error(self) -> None:
        calls = 0

        def operation() -> str:
            nonlocal calls
            calls += 1
            if calls == 1:
                raise HTTPError("https://example.test", 520, "temporary", {}, None)
            return "ok"

        self.assertEqual(run_ai_call("openai", {"input": "test"}, operation), "ok")
        self.assertEqual(calls, 2)

    def test_does_not_retry_bad_request(self) -> None:
        calls = 0

        def operation() -> str:
            nonlocal calls
            calls += 1
            raise HTTPError("https://example.test", 400, "bad request", {}, None)

        with self.assertRaises(HTTPError) as raised:
            run_ai_call("openai", {}, operation)
        self.assertEqual(raised.exception.code, 400)
        self.assertEqual(calls, 1)

    def test_token_estimate_includes_output_allowance(self) -> None:
        estimate = estimated_tokens({"input": "x" * 400, "max_output_tokens": 100})
        self.assertGreaterEqual(estimate, 200)

    def test_timeout_and_rate_limit_are_temporary(self) -> None:
        self.assertTrue(is_transient(TimeoutError("slow")))
        self.assertTrue(
            is_transient(HTTPError("https://example.test", 429, "limit", {}, None))
        )


if __name__ == "__main__":
    unittest.main()
