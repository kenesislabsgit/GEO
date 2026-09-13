from __future__ import annotations

import json
import os
import unittest
from unittest.mock import Mock, patch

from geo_audit.llm import call_gemini_generate_content


class _Response:
    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def read(self) -> bytes:
        return json.dumps(
            {
                "candidates": [
                    {"content": {"parts": [{"text": "Gemini access works"}]}}
                ]
            }
        ).encode("utf-8")


class GeminiVertexAuthTests(unittest.TestCase):
    @patch("geo_audit.llm.load_dotenv")
    @patch("geo_audit.llm.run_ai_call", side_effect=lambda _p, _b, send: send())
    @patch("geo_audit.llm.urlopen")
    @patch("google.auth.default")
    def test_vertex_uses_adc_and_vertex_endpoint(
        self,
        auth_default: Mock,
        urlopen: Mock,
        _run_ai_call: Mock,
        _load_dotenv: Mock,
    ) -> None:
        credentials = Mock()
        credentials.token = "temporary-access-token"
        auth_default.return_value = (credentials, "detected-project")
        urlopen.return_value = _Response()

        with patch.dict(
            os.environ,
            {
                "GOOGLE_GENAI_USE_VERTEXAI": "True",
                "GOOGLE_CLOUD_PROJECT": "groovy-gearbox-506811-p6",
                "GOOGLE_CLOUD_LOCATION": "global",
                "GEMINI_API_KEY": "",
                "GOOGLE_API_KEY": "",
            },
            clear=False,
        ):
            text, _metadata = call_gemini_generate_content(
                {"contents": [{"parts": [{"text": "test"}]}]},
                model="gemini-2.5-flash",
            )

        self.assertEqual(text, "Gemini access works")
        request = urlopen.call_args.args[0]
        self.assertIn("aiplatform.googleapis.com/v1/projects/", request.full_url)
        self.assertIn("locations/global", request.full_url)
        self.assertEqual(
            request.get_header("Authorization"),
            "Bearer temporary-access-token",
        )
        credentials.before_request.assert_called_once()

    @patch("geo_audit.llm.load_dotenv")
    @patch("geo_audit.llm.run_ai_call", side_effect=lambda _p, _b, send: send())
    @patch("geo_audit.llm.urlopen")
    def test_existing_api_key_path_still_works(
        self,
        urlopen: Mock,
        _run_ai_call: Mock,
        _load_dotenv: Mock,
    ) -> None:
        urlopen.return_value = _Response()

        with patch.dict(
            os.environ,
            {
                "GEMINI_API_KEY": "existing-key",
                "GOOGLE_GENAI_USE_VERTEXAI": "False",
            },
            clear=False,
        ):
            text, _metadata = call_gemini_generate_content(
                {"contents": [{"parts": [{"text": "test"}]}]},
                model="gemini-2.5-flash",
            )

        self.assertEqual(text, "Gemini access works")
        request = urlopen.call_args.args[0]
        self.assertIn("generativelanguage.googleapis.com", request.full_url)
        self.assertEqual(request.get_header("X-goog-api-key"), "existing-key")


if __name__ == "__main__":
    unittest.main()
