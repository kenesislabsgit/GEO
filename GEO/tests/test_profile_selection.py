from __future__ import annotations

import json
import os
import unittest
from unittest.mock import MagicMock, patch

from geo_audit.llm import call_chat_completion
from geo_audit.profile import (
    compact_snapshot_for_llm,
    normalize_company_profile,
    select_profile_page_ids,
)


def snapshot_with_pages(count: int) -> dict:
    return {
        "domain": "example.com",
        "pages": [
            {
                "url": "https://example.com/" if index == 1 else f"https://example.com/{index}",
                "title": f"Page {index}",
                "meta_description": f"Description {index}",
                "headings": {"h1": [f"Heading {index}"]},
                "main_text": f"Content {index}",
            }
            for index in range(1, count + 1)
        ],
    }


class ProfilePageSelectionTests(unittest.TestCase):
    def test_unused_saved_profile_fields_are_removed(self) -> None:
        profile = normalize_company_profile(
            {
                "pricing_model": "Monthly",
                "core_messaging": ["Fast"],
                "customer_segments": ["Teams"],
                "market_signals": {"India": ["currency"]},
            },
            {"pages": []},
        )
        for field in (
            "pricing_model",
            "core_messaging",
            "customer_segments",
            "market_signals",
        ):
            self.assertNotIn(field, profile)

    def test_small_sites_skip_the_selection_call(self) -> None:
        with patch("geo_audit.profile.call_chat_completion") as call:
            selected, payload, error = select_profile_page_ids(snapshot_with_pages(5))
        self.assertEqual(selected, [f"page-{index:03d}" for index in range(1, 6)])
        self.assertIsNone(payload)
        self.assertIsNone(error)
        call.assert_not_called()

    def test_selector_keeps_homepage_and_stable_page_ids(self) -> None:
        reply = json.dumps(
            {"page_ids": ["page-006", "page-004", "page-003", "page-002"]}
        )
        with patch("geo_audit.profile.call_chat_completion", return_value=reply):
            selected, _payload, error = select_profile_page_ids(snapshot_with_pages(8))
        self.assertEqual(
            selected,
            ["page-001", "page-006", "page-004", "page-003", "page-002"],
        )
        self.assertIsNone(error)

        compact = compact_snapshot_for_llm(
            snapshot_with_pages(8), selected_page_ids=selected
        )
        self.assertEqual(
            [page["page_id"] for page in compact["pages"]],
            ["page-001", "page-002", "page-003", "page-004", "page-006"],
        )

    def test_plain_completion_sends_one_request(self) -> None:
        response = MagicMock()
        response.read.return_value = json.dumps(
            {"choices": [{"message": {"content": "done"}}]}
        ).encode("utf-8")
        response.__enter__.return_value = response
        response.__exit__.return_value = False

        with patch.dict(os.environ, {"OPENAI_API_KEY": "test"}, clear=False):
            with patch("geo_audit.llm.urlopen", return_value=response) as open_call:
                answer = call_chat_completion({"messages": []})
        self.assertEqual(answer, "done")
        open_call.assert_called_once()


if __name__ == "__main__":
    unittest.main()
