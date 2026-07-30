"""
TEST: Competitor extractor only — uses SAVED mock data, costs ~$0.001 (1 small GPT call).
Tests that company names are correctly extracted from AI responses.

Usage:
    python tests/test_extractor.py
    python tests/test_extractor.py --no-api   (regex only, ZERO cost)
"""
import sys
import asyncio
import json
import time
from pathlib import Path
from dotenv import load_dotenv

sys.path.insert(0, "..")
load_dotenv("../.env")

from models import AIQueryResult
from competitor_analyzer import _extract_bold_candidates, extract_competitors_with_ai

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "mock_ai_responses.json"


def load_mock_results() -> tuple[list[AIQueryResult], str]:
    """Load saved AI responses from fixture file — no API call needed."""
    with open(FIXTURE_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)

    company_name = data["company_name"]
    results = []
    for r in data["ai_results"]:
        results.append(AIQueryResult(
            ai_name=r["ai_name"],
            question=r["question"],
            raw_response=r["raw_response"],
            company_mentioned=False,
        ))
    return results, company_name


async def main():
    no_api = "--no-api" in sys.argv

    print(f"\n{'='*60}")
    print(f"COMPETITOR EXTRACTOR TEST")
    print(f"{'='*60}")
    print(f"Using fixture: {FIXTURE_PATH}")
    print(f"Mode: {'REGEX ONLY (zero cost)' if no_api else 'REGEX + 1 GPT call (~$0.001)'}\n")

    ai_results, company_name = load_mock_results()
    print(f"Loaded {len(ai_results)} mock AI responses for company: '{company_name}'\n")

    # Phase 1: Regex extraction (FREE)
    start = time.time()
    candidates = _extract_bold_candidates(ai_results)
    regex_time = time.time() - start

    print(f"{'='*40}")
    print(f"PHASE 1: Regex Extraction ({regex_time*1000:.0f}ms, zero cost)")
    print(f"{'='*40}")
    print(f"Found {len(candidates)} bold candidates:")
    for i, c in enumerate(candidates, 1):
        print(f"  {i:2}. {c}")

    if no_api:
        print("\n[--no-api mode] Stopping here. Run without --no-api to validate with GPT.")
        return

    # Phase 2: GPT validation (1 small call)
    print(f"\n{'='*40}")
    print(f"PHASE 2: GPT Validation (1 call, ~$0.001)")
    print(f"{'='*40}")
    start = time.time()
    competitors = await extract_competitors_with_ai(ai_results, company_name)
    gpt_time = time.time() - start

    print(f"\nValidated in {gpt_time:.2f}s")
    print(f"Real companies found: {len(competitors)}\n")

    for i, c in enumerate(competitors, 1):
        print(f"  {i:2}. {c['name']:<30} {c.get('website', 'no website')}")

    print(f"\nSUMMARY: Regex found {len(candidates)} candidates -> GPT kept {len(competitors)} real companies")


if __name__ == "__main__":
    asyncio.run(main())
