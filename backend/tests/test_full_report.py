import asyncio
import json
import sys
from pathlib import Path
from dotenv import load_dotenv

sys.path.insert(0, "..")
load_dotenv("../.env")

from main import scrape_website, profile_company, analyze_all_competitors, analyze_and_recommend
from interrogator import interrogate_all_ais

async def generate_report(url: str, company_name: str = None):
    print(f"🚀 Starting Full End-to-End Analysis for: {url}\n")
    
    # 1. Scrape
    print("[1/5] Scraping website...")
    scraped = await scrape_website(url)
    
    # 2. Profile
    print("[2/5] Profiling company & generating questions...")
    profile = await profile_company(scraped, company_name)
    print(f"      Industry: {profile.industry}")
    print(f"      Questions Generated: {len(profile.generated_questions)}")
    
    # 3. Interrogate
    print("[3/5] Asking AI Search Engines (ChatGPT, Gemini, Claude)...")
    ai_results = await interrogate_all_ais(profile.generated_questions, profile.company_name)
    mentioned = sum(1 for r in ai_results if r.company_mentioned)
    print(f"      Visibility so far: {mentioned}/{len(ai_results)} queries mentioned you.")
    
    # 4. Competitors
    print("[4/5] Extracting & Crawling Competitors (Hybrid approach)...")
    competitor_insights = await analyze_all_competitors(
        ai_results,
        profile.company_name,
        profile.industry,
        user_scraped=scraped,
        profile_data={"company_name": profile.company_name, "industry": profile.industry},
        questions=profile.generated_questions,
    )
    print(f"      Competitors successfully analyzed: {len(competitor_insights)}")
    
    # 5. Final Analysis
    print("[5/5] Generating Gap Analysis & Recommendations...")
    final_analysis = await analyze_and_recommend(scraped, profile, ai_results, competitor_insights)
    
    # Generate Markdown Report
    report = f"""# AI Visibility & SEO Report for {profile.company_name}
**Website:** {url}
**Industry:** {profile.industry}
**AI Visibility Score:** {final_analysis['visibility_score']}/100

---

## 1. What Customers Are Asking AI
We tested the top AI Search Engines (ChatGPT, Gemini, Claude) with these specific questions about your industry:
"""
    for i, q in enumerate(profile.generated_questions, 1):
        report += f"{i}. {q}\n"

    report += f"""
---

## 2. Your Top AI Competitors
These are the companies the AI recommended instead of you, and exactly *why* they rank higher.

"""
    for comp in competitor_insights:
        if comp.crawl_error:
            continue
        report += f"### {comp.name} ({comp.website})\n"
        if comp.company_description:
            report += f"**About Them:** {comp.company_description}\n\n"
        report += f"**What they have that you don't:**\n{comp.key_content}\n\n"
        report += f"**Why AI recommends them:**\n{comp.why_recommended}\n\n"
        if comp.citations:
            report += "**Citations / Found at:**\n"
            for cit in comp.citations:
                report += f"- {cit}\n"
            report += "\n"

    report += f"""---

## 3. The Gap Analysis
*What is missing from your website that prevents AI from recommending you?*

{final_analysis['gap_analysis']}

---

## 4. Your Action Plan (Recommendations)
*Implement these changes on your website to increase your AI Visibility Score in the next 30 days.*

"""
    for i, rec in enumerate(final_analysis['recommendations'], 1):
        # Remove any leading numbers that GPT might have added
        clean_rec = rec.lstrip("0123456789. ")
        report += f"{i}. {clean_rec}\n"

    # Save to file
    out_file = Path("final_report.md")
    out_file.write_text(report, encoding="utf-8")
    
    print("\n✅ DONE! Report saved to: backend/tests/final_report.md")
    print("Open that file to see EXACTLY what your customer will pay for.")

if __name__ == "__main__":
    target_url = sys.argv[1] if len(sys.argv) > 1 else "https://kenesis.ai"
    asyncio.run(generate_report(target_url))
