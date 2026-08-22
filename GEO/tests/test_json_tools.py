from __future__ import annotations

import unittest

from geo_audit.json_tools import extract_json_object


class JsonToolsTests(unittest.TestCase):
    def test_extract_object_accepts_a_repeated_structured_response(self):
        value = extract_json_object('{"companies": []}\n{"companies": []}')

        self.assertEqual(value, {"companies": []})


if __name__ == "__main__":
    unittest.main()
