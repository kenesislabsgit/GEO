"""
TEST: Full competitor pipeline (extract + crawl + compare) using saved mock data.
Costs: 1 GPT call for extraction + 1 GPT call per crawled competitor for comparison.
Total cost: ~$0.01-0.05 depending on how many sites crawl successfully.

Skips the expensive AI interrogation step entirely (uses mock data).

Usage:
    python tests/test_competitor_pipeline.py
    python tests/test_competitor_pipeline.py --extract-only   # just extraction, no crawl
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
from competitor_analyzer import extract_competitors_with_ai, analyze_all_competitors

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "mock_ai_responses.json"

# Mock user site data (from kenesis.ai scrape — reuse to avoid scraping again)
MOCK_USER_SCRAPED = {
    "url": "https://kenesis.ai",
    "title": "Kenesis - AI Video Analytics for Industrial Safety",
    "meta_description": "Kenesis transforms existing CCTV systems into real-time safety monitoring using AI.",
    "headings": ["[H1] AI-Powered Industrial Safety", "[H2] PPE Detection", "[H2] Zone Intelligence"],
    "body_text": "Kenesis provides AI-driven video analytics solutions that enhance industrial safety by transforming existing CCTV systems into real-time safety monitoring tools. Their technology detects PPE violations, unauthorized zone access, and potential hazards, all while operating on-premise without the need for cloud services.",
    "scrape_ok": True,
}


def load_mock_results() -> tuple[list[AIQueryResult], dict]:
    with open(FIXTURE_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
    results = [
        AIQueryResult(
            ai_name=r["ai_name"],
            question=r["question"],
            raw_response=r["raw_response"],
            company_mentioned=False,
        )
        for r in data["ai_results"]
    ]
    return results, data


async def main():
    extract_only = "--extract-only" in sys.argv

    print(f"\n{'='*60}")
    print(f"FULL COMPETITOR PIPELINE TEST")
    print(f"{'='*60}")
    print(f"Mode: {'EXTRACT ONLY' if extract_only else 'EXTRACT + CRAWL + COMPARE'}\n")

    ai_results, data = load_mock_results()
    company_name = data["company_name"]
    questions = [r["question"] for r in data["ai_results"][:5]]

    if extract_only:
        # Phase 1 only: extraction
        print("Running extraction only (1 GPT call)...")
        start = time.time()
        competitors = await extract_competitors_with_ai(ai_results, company_name)
        elapsed = time.time() - start

        print(f"\nExtraction done in {elapsed:.2f}s")
        print(f"Companies found: {len(competitors)}\n")
        for i, c in enumerate(competitors, 1):
            print(f"  {i:2}. {c['name']:<30} {c.get('website', 'no url')}")
        return

    # Full pipeline: extract + crawl + compare
    print(f"Running full pipeline for company: '{company_name}'")
    print(f"Questions: {len(questions)}")
    print(f"This will cost ~$0.01-0.05 in API calls\n")

    start = time.time()
    profile_data = {
        "company_name": company_name,
        "industry": "AI-powered industrial safety monitoring",
    }

    insights = await analyze_all_competitors(
        ai_results=ai_results,
        company_name=company_name,
        industry="AI-powered industrial safety monitoring",
        user_scraped=MOCK_USER_SCRAPED,
        profile_data=profile_data,
        questions=questions,
    )
    elapsed = time.time() - start

    print(f"\n{'='*60}")
    print(f"RESULTS ({elapsed:.1f}s total)")
    print(f"{'='*60}")
    print(f"Competitor insights: {len(insights)}\n")

    for insight in insights:
        print(f"{'─'*50}")
        print(f"Company : {insight.name}")
        print(f"Website : {insight.website}")
        if insight.crawl_error:
            print(f"Status  : FAILED — {insight.crawl_error}")
        else:
            print(f"Title   : {insight.title}")
            print(f"\nKey Content:")
            print(f"  {insight.key_content}")
            print(f"\nWhy Recommended:")
            print(f"  {insight.why_recommended}")
        print()


if __name__ == "__main__":
    asyncio.run(main())
