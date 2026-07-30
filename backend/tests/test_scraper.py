"""
TEST: Scraper only — zero API calls, zero token cost.
Tests that the web scraper can fetch and parse a website.

Usage:
    python tests/test_scraper.py https://briefcam.com
    python tests/test_scraper.py https://voxel.ai
    python tests/test_scraper.py https://kenesis.ai
"""
import sys
import asyncio
import json
import time

# Add parent directory to path
sys.path.insert(0, "..")

from competitor_analyzer import scrape_website_robust


async def main():
    url = sys.argv[1] if len(sys.argv) > 1 else "https://briefcam.com"

    print(f"\n{'='*60}")
    print(f"SCRAPER TEST")
    print(f"{'='*60}")
    print(f"Target URL: {url}\n")

    start = time.time()
    result = await scrape_website_robust(url)
    elapsed = time.time() - start

    print(f"Time taken : {elapsed:.2f}s")
    print(f"Success    : {result.get('scrape_ok', False)}")

    if result.get("scrape_ok"):
        print(f"\nTitle      : {result['title']}")
        print(f"Meta Desc  : {result['meta_description'][:120]}...")
        print(f"Headings   : {len(result['headings'])} found")
        print(f"Body chars : {len(result['body_text'])}")
        print(f"\nTop 10 Headings:")
        for h in result["headings"][:10]:
            print(f"  {h}")
        print(f"\nBody Preview (first 400 chars):")
        print(f"  {result['body_text'][:400]}")
    else:
        print(f"\nFAILED: {result.get('error', 'Unknown error')}")
        print("Try a different URL or check network connectivity.")


if __name__ == "__main__":
    asyncio.run(main())
