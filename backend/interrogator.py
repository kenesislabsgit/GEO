import os
import asyncio
import json
import re
from typing import List
import google.genai as genai
from openai import AsyncOpenAI
import anthropic
from models import AIQueryResult


def _is_company_mentioned(response_text: str, company_name: str) -> bool:
    return company_name.lower() in response_text.lower()


# ─────────────────────────────────────────────
# Individual AI Query Functions
# ─────────────────────────────────────────────

async def _query_gemini(question: str, company_name: str) -> AIQueryResult:
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        return AIQueryResult(
            ai_name="Gemini",
            question=question,
            raw_response="SKIPPED: GEMINI_API_KEY not set.",
            company_mentioned=False,
        )
    try:
        client = genai.Client(api_key=api_key)
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=question,
            config={"tools": [{"google_search": {}}]}
        )
        text = response.text.strip()
        return AIQueryResult(
            ai_name="Gemini",
            question=question,
            raw_response=text,
            company_mentioned=_is_company_mentioned(text, company_name),
        )
    except Exception as e:
        return AIQueryResult(
            ai_name="Gemini",
            question=question,
            raw_response=f"ERROR: {str(e)}",
            company_mentioned=False,
        )


async def _query_chatgpt(question: str, company_name: str) -> AIQueryResult:
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return AIQueryResult(
            ai_name="ChatGPT",
            question=question,
            raw_response="SKIPPED: OPENAI_API_KEY not set.",
            company_mentioned=False,
        )
    try:
        client = AsyncOpenAI(api_key=api_key)
        
        response = await client.chat.completions.create(
            model="gpt-4o-search-preview",  # Uses live web search
            messages=[{"role": "user", "content": question}],
            max_tokens=1500,
        )
        text = response.choices[0].message.content.strip()
        return AIQueryResult(
            ai_name="ChatGPT",
            question=question,
            raw_response=text,
            company_mentioned=_is_company_mentioned(text, company_name),
        )
    except Exception as e:
        return AIQueryResult(
            ai_name="ChatGPT",
            question=question,
            raw_response=f"ERROR: {str(e)}",
            company_mentioned=False,
        )


async def _query_claude(question: str, company_name: str) -> AIQueryResult:
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        return AIQueryResult(
            ai_name="Claude",
            question=question,
            raw_response="SKIPPED: ANTHROPIC_API_KEY not set.",
            company_mentioned=False,
        )
    try:
        def _call():
            client = anthropic.Anthropic(api_key=api_key)
            message = client.messages.create(
                model="claude-haiku-4-5",
                max_tokens=1500,
                messages=[{"role": "user", "content": question}],
            )
            return message.content[0].text.strip()

        loop = asyncio.get_event_loop()
        text = await loop.run_in_executor(None, _call)
        return AIQueryResult(
            ai_name="Claude",
            question=question,
            raw_response=text,
            company_mentioned=_is_company_mentioned(text, company_name),
        )
    except Exception as e:
        return AIQueryResult(
            ai_name="Claude",
            question=question,
            raw_response=f"ERROR: {str(e)}",
            company_mentioned=False,
        )


# ─────────────────────────────────────────────
# Batch interrogator — all AIs in parallel
# ─────────────────────────────────────────────

async def interrogate_all_ais(questions: List[str], company_name: str) -> List[AIQueryResult]:
    """
    For each question, simultaneously queries Gemini, ChatGPT, and Claude.
    Competitor extraction is no longer done here — it's handled by competitor_analyzer.py
    using AI-based extraction instead of broken regex.
    """
    tasks = []
    for question in questions:
        tasks.append(_query_gemini(question, company_name))
        tasks.append(_query_chatgpt(question, company_name))
        tasks.append(_query_claude(question, company_name))

    results = await asyncio.gather(*tasks)
    return list(results)


async def interrogate_streaming(questions: List[str], company_name: str):
    """
    Same as above but yields results one-by-one as each AI query completes.
    Used by the SSE streaming endpoint for live progress updates.
    """
    tasks = {
        asyncio.create_task(_query_gemini(q, company_name)): ("Gemini", q)
        for q in questions
    }
    tasks.update({
        asyncio.create_task(_query_chatgpt(q, company_name)): ("ChatGPT", q)
        for q in questions
    })
    tasks.update({
        asyncio.create_task(_query_claude(q, company_name)): ("Claude", q)
        for q in questions
    })

    pending = set(tasks.keys())
    while pending:
        done, pending = await asyncio.wait(pending, return_when=asyncio.FIRST_COMPLETED)
        for task in done:
            result = task.result()
            yield result
