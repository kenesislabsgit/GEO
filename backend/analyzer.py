import os
import json
from typing import List
from openai import AsyncOpenAI
from models import AIQueryResult, CompanyProfile, CompetitorInsight


def _calculate_visibility_score(ai_results: List[AIQueryResult]) -> float:
    if not ai_results:
        return 0.0
    # Only count non-error responses for fair scoring
    valid = [r for r in ai_results if not r.raw_response.startswith("ERROR") and not r.raw_response.startswith("SKIPPED")]
    if not valid:
        return 0.0
    mentioned_count = sum(1 for r in valid if r.company_mentioned)
    return round((mentioned_count / len(valid)) * 100, 1)


def _build_analysis_prompt(
    scraped_data: dict,
    profile: CompanyProfile,
    ai_results: List[AIQueryResult],
    competitor_insights: List[CompetitorInsight],
    visibility_score: float,
) -> str:
    # AI query summary
    query_lines = []
    for r in ai_results:
        if r.raw_response.startswith("ERROR") or r.raw_response.startswith("SKIPPED"):
            status = f"[FAILED: {r.raw_response[:60]}]"
        else:
            status = "MENTIONED" if r.company_mentioned else "NOT MENTIONED"
        query_lines.append(f"  [{r.ai_name}] \"{r.question}\" -> {status}")
    query_summary = "\n".join(query_lines)

    # Competitor insights summary
    comp_lines = []
    for c in competitor_insights:
        if c.crawl_error:
            comp_lines.append(f"\n  Company: {c.name} ({c.website})\n  Error: {c.crawl_error}")
        else:
            comp_lines.append(
                f"\n  Company: {c.name} ({c.website})"
                f"\n  Why AI recommends them: {c.why_recommended}"
                f"\n  Key content on their site: {c.key_content}"
            )
    competitor_summary = "\n".join(comp_lines) if comp_lines else "No competitor websites could be crawled."

    return f"""
You are an expert AI Search Optimization (AIO) consultant. A company wants to understand why they don't appear in AI chatbot responses and what to do about it.

--- COMPANY BEING ANALYZED ---
Name: {profile.company_name}
Industry: {profile.industry}
Description: {profile.description}

--- THEIR WEBSITE CONTENT ---
Title: {scraped_data['title']}
Meta Description: {scraped_data['meta_description']}
Body (excerpt): {scraped_data['body_text'][:1500]}

--- AI VISIBILITY TEST RESULTS ---
Overall Score: {visibility_score}/100
{query_summary}

--- COMPETITOR WEBSITES THAT DID APPEAR IN AI RESPONSES ---
(These companies were mentioned by AI when asked questions this company should be answering)
{competitor_summary}

--- YOUR TASK ---
Using all the above data (especially the gap between what competitors have on their websites vs what this company has), provide:

1. A sharp 3-4 sentence GAP ANALYSIS: WHY is this company not appearing in AI responses? Reference specific content gaps compared to competitors.

2. Exactly 3 to 5 SPECIFIC, ACTIONABLE RECOMMENDATIONS ranked by impact. Each must:
   - Be grounded in what competitors are doing better (from the data above)
   - Include a 'title' for the action
   - Include 'why_it_helps': specify exactly WHY it helps AI visibility
   - Include 'keywords': words/keywords to use
   - Include 'example_data': Example data to put on the page
   - Be achievable without a developer (content/copy changes preferred)

Respond ONLY as valid JSON matching this schema:
{{
  "gap_analysis": "...",
  "recommendations": [
    {{
      "title": "Build a dedicated '...' sub-page",
      "why_it_helps": "...",
      "keywords": "...",
      "example_data": "..."
    }}
  ]
}}
"""


async def analyze_and_recommend(
    scraped_data: dict,
    profile: CompanyProfile,
    ai_results: List[AIQueryResult],
    competitor_insights: List[CompetitorInsight] = [],
) -> dict:
    """
    Uses OpenAI GPT-4o Mini to generate gap analysis and recommendations.
    Now uses competitor crawl data to make recommendations more specific and grounded.
    """
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise ValueError("OPENAI_API_KEY is not set. Cannot run analysis.")

    visibility_score = _calculate_visibility_score(ai_results)
    client = AsyncOpenAI(api_key=api_key)
    prompt = _build_analysis_prompt(scraped_data, profile, ai_results, competitor_insights, visibility_score)

    response = await client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": "You are an expert AI Search Optimization consultant. Return only valid JSON."},
            {"role": "user", "content": prompt}
        ],
        response_format={"type": "json_object"},
        max_tokens=2000,
        temperature=0.4,
    )

    raw_text = response.choices[0].message.content.strip()

    try:
        data = json.loads(raw_text)
    except json.JSONDecodeError:
        return {
            "visibility_score": visibility_score,
            "gap_analysis": "Analysis could not be parsed. Raw: " + raw_text[:400],
            "recommendations": [],
        }

    return {
        "visibility_score": visibility_score,
        "gap_analysis": data.get("gap_analysis", ""),
        "recommendations": data.get("recommendations", []),
    }
