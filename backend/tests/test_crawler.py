"""
TEST: Crawler robustness only — zero API calls, zero token cost.
Tests the scraper against multiple URLs including known-difficult sites.
Shows which user-agent worked, how long it took, and what was extracted.

Usage:
    python tests/test_crawler.py                   # tests default list
    python tests/test_crawler.py https://voxel.ai  # test one specific URL
"""
import sys
import asyncio
import time

sys.path.insert(0, "..")

from competitor_analyzer import scrape_website_robust

# Default list of sites to test — mix of easy, medium, and known-difficult sites
DEFAULT_URLS = [
    "https://briefcam.com",
    "https://voxel.ai",
    "https://milestone.dk",
    "https://www.genetec.com",
    "https://www.cognex.com",
    "https://ironvision.ai",
    "https://kenesis.ai",
]


async def test_url(url: str) -> dict:
    """Crawl one URL and return results with timing."""
    start = time.time()
    result = await scrape_website_robust(url)
    elapsed = time.time() - start

    return {
        "url": url,
        "ok": result.get("scrape_ok", False),
        "time": elapsed,
        "title": result.get("title", ""),
        "headings": len(result.get("headings", [])),
        "body_chars": len(result.get("body_text", "")),
        "error": result.get("error", ""),
    }


async def main():
    if len(sys.argv) > 1 and sys.argv[1].startswith("http"):
        urls = [sys.argv[1]]
    else:
        urls = DEFAULT_URLS

    print(f"\n{'='*70}")
    print(f"CRAWLER ROBUSTNESS TEST — {len(urls)} URLs")
    print(f"{'='*70}\n")

    # Test all URLs in parallel
    tasks = [test_url(url) for url in urls]
    results = await asyncio.gather(*tasks)

    # Print results table
    print(f"{'URL':<40} {'OK':<6} {'TIME':<8} {'HEADINGS':<10} {'BODY CHARS':<12} {'ERROR'}")
    print("-" * 100)

    ok_count = 0
    for r in results:
        ok = "✅" if r["ok"] else "❌"
        if r["ok"]:
            ok_count += 1
        error_str = r["error"][:35] if r["error"] else ""
        url_short = r["url"][:38]
        print(f"{url_short:<40} {ok:<6} {r['time']:.1f}s    {r['headings']:<10} {r['body_chars']:<12} {error_str}")

    print(f"\nRESULT: {ok_count}/{len(results)} sites crawled successfully")

    # Show content preview for successful crawls
    if len(urls) == 1:
        for r in results:
            if r["ok"]:
                print(f"\nTitle: {r['title']}")


if __name__ == "__main__":
    asyncio.run(main())
