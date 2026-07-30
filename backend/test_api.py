import asyncio
import httpx

async def run_test():
    url = "http://localhost:8000/analyze"
    payload = {
        "website_url": "https://kenesis.ai",
        "company_name": "Kenesis"
    }

    print("Sending request to /analyze (this may take a minute)...")

    async with httpx.AsyncClient(timeout=120.0) as client:
        try:
            response = await client.post(url, json=payload)
            response.raise_for_status()
            data = response.json()

            print("\n" + "="*60)
            print(f" AI Visibility & SEO Report for {data.get('company_name')}")
            print("="*60)
            print(f"Website:  {data.get('website_url')}")
            print(f"Industry: {data.get('industry')}")
            print(f"AI Visibility Score: {data.get('visibility_score')} / 100")

            print("\n## 1. How AI Sees Your Industry")
            print("Questions Asked:")
            for q in data.get("generated_questions", []):
                print(f"  - {q}")

            print("\n## 2. Your Direct AI Competitors (Who is stealing your traffic)")
            for comp in data.get("competitor_insights", []):
                print(f"\n### {comp.get('name')} ({comp.get('website')})")

                # Always show error reason if content is blank
                if comp.get('crawl_error'):
                    print(f"  [SKIPPED REASON]: {comp.get('crawl_error')}")
                    continue

                print(f"  What they do: {comp.get('company_description') or '[EMPTY — no description returned]'}")
                print(f"  Why AI recommends them over you: {comp.get('why_recommended') or '[EMPTY — no analysis returned]'}")
                if comp.get('citations'):
                    print("  Citations / Proof:")
                    for c in comp.get('citations'):
                        print(f"    - {c}")

            print("\n## 3. The Gap Analysis")
            print(data.get("gap_analysis", "[EMPTY]"))

            print("\n## 4. Your Action Plan (Exact Implementation Guide)")
            for i, rec in enumerate(data.get("recommendations", []), 1):
                if isinstance(rec, dict):
                    print(f"\nAction {i}: {rec.get('title')}")
                    print(f"  Why this helps: {rec.get('why_it_helps')}")
                    print(f"  Words/Keywords to use: {rec.get('keywords')}")
                    print(f"  Example data to put on page: {rec.get('example_data')}")
                else:
                    print(f"\nAction {i}: {rec}")

        except Exception as e:
            print(f"Error: {e}")

if __name__ == "__main__":
    asyncio.run(run_test())
