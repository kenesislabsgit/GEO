import os
import json
from openai import AsyncOpenAI
from models import CompanyProfile


def _build_profiler_prompt(scraped_data: dict, user_company_name: str | None, user_keywords: str | None) -> str:
    heading_text = "\n".join(scraped_data.get("headings", []))
    return f"""
You are a B2B market research analyst. Based on the following website content, complete these tasks:

1. Determine the COMPANY NAME (use the provided hint if given, otherwise infer from the website).
2. Determine the INDUSTRY — be hyper-specific about BOTH the technology AND the deployment model
   (e.g. "on-premise AI computer vision for industrial PPE compliance" not just "AI safety software").
3. Write a 2-3 sentence DESCRIPTION of what the company does and how.
4. Generate exactly 5 BUYER SEARCH QUESTIONS.

━━━ MANDATORY RULES FOR QUESTIONS ━━━

RULE 1 — Every question MUST start with ONE of these exact phrases:
  "Which companies", "Which vendors", "Which platforms", "Which specific vendors",
  "Can you recommend specific vendors", "What are the leading companies", "What are the top vendors"

RULE 2 — Every question MUST be phrased so the ONLY valid answer is a LIST OF COMPANY/VENDOR NAMES.
  If an AI can answer it with a how-to guide or a feature list, the question is WRONG.

RULE 3 — Every question MUST include the SPECIFIC technology/product AND specific deployment
  constraint/use-case of this company. Generic cloud platforms (AWS, Azure, Google Cloud)
  must NOT be a valid answer to any of these questions.

RULE 4 — FORBIDDEN starting words: "How", "What is", "Why", "When", "What are the best features",
  "What are the top tools", "What should I look for"
  Questions starting with these words produce essays, not company names.

GOOD examples — copy this exact style:
  "Which companies provide on-premise AI video analytics for real-time PPE detection using existing CCTV cameras in manufacturing plants?"
  "Which vendors sell computer vision safety compliance software that detects hard hat and vest violations without cloud connectivity?"
  "Can you recommend specific vendors offering AI-powered worker safety monitoring deployable on existing CCTV infrastructure in factories?"
  "What are the leading companies providing real-time forklift-pedestrian collision detection using AI video analytics on existing cameras?"
  "Which platforms specialize in automated PPE compliance monitoring using on-premise edge AI in industrial facilities?"

BAD examples — NEVER generate these:
  "What are the best tools for real-time hazard detection?" — too generic, AWS/Azure are valid answers
  "How can I automate safety compliance checks?" — gets a how-to guide, not company names
  "What features should I look for in an AI safety tool?" — gets a feature list, not company names
  "What are the top tools for video analytics?" — too broad

--- WEBSITE DATA ---
Page Title: {scraped_data['title']}
Meta Description: {scraped_data['meta_description']}
Headings:
{heading_text}
Body Text (excerpt):
{scraped_data['body_text'][:2000]}

--- USER HINTS (may be empty) ---
Company Name Hint: {user_company_name or 'Not provided'}
Keyword Hint: {user_keywords or 'Not provided'}

Respond ONLY in this exact JSON format with no extra commentary:
{{
  "company_name": "...",
  "industry": "...",
  "description": "...",
  "generated_questions": [
    "Which companies ...",
    "Which vendors ...",
    "Can you recommend specific vendors ...",
    "What are the leading companies ...",
    "Which platforms ..."
  ]
}}
"""


async def profile_company(scraped_data: dict, company_name: str | None = None, keywords: str | None = None) -> CompanyProfile:
    """
    Uses OpenAI GPT-4o Mini to understand what the company does and generate 5 test search questions.
    OpenAI is used here to avoid Gemini rate limits on the profiling step.
    Questions are now specifically designed to elicit company recommendations from AIs.
    """
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise ValueError("OPENAI_API_KEY environment variable is not set.")

    client = AsyncOpenAI(api_key=api_key)
    prompt = _build_profiler_prompt(scraped_data, company_name, keywords)

    response = await client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {
                "role": "system",
                "content": "You are a business intelligence analyst. Always respond with valid JSON only, no markdown."
            },
            {
                "role": "user",
                "content": prompt
            }
        ],
        response_format={"type": "json_object"},
        max_tokens=1000,
        temperature=0.1,
    )

    raw_text = response.choices[0].message.content.strip()

    try:
        data = json.loads(raw_text)
    except json.JSONDecodeError:
        raise ValueError(f"OpenAI returned invalid JSON during profiling. Raw: {raw_text[:300]}")

    return CompanyProfile(
        company_name=data.get("company_name", company_name or "Unknown Company"),
        industry=data.get("industry", "Unknown Industry"),
        description=data.get("description", ""),
        generated_questions=data.get("generated_questions", []),
    )
