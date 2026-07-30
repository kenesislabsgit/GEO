import sys
sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

import json
import asyncio
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv
import uvicorn

from models import AnalyzeRequest
from scraper import scrape_website
from profiler import profile_company
from interrogator import interrogate_all_ais, interrogate_streaming
from analyzer import analyze_and_recommend
from competitor_analyzer import analyze_all_competitors

load_dotenv()

app = FastAPI(
    title="AI SEO Optimizer API",
    description="Checks if your company appears in AI search results and tells you how to fix it.",
    version="1.1.0-mvp",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Utility ─────────────────────────────────────────────────────────

def sse(event: str, data: dict) -> str:
    """Format a Server-Sent Event message."""
    payload = json.dumps({"event": event, **data}, ensure_ascii=False)
    return f"data: {payload}\n\n"


# ── Health Check ─────────────────────────────────────────────────────

@app.get("/health")
async def health_check():
    return {"status": "ok", "message": "AI SEO Optimizer API is running."}


# ── Standard (non-streaming) endpoint ────────────────────────────────

@app.post("/analyze")
async def analyze_company(request: AnalyzeRequest):
    """
    Full analysis pipeline. Returns one big JSON at the end.
    Use /analyze/stream for live step-by-step progress instead.
    """
    try:
        print(f"[1/5] Scraping: {request.website_url}")
        scraped = await scrape_website(str(request.website_url))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    try:
        print(f"[2/5] Profiling company...")
        profile = await profile_company(scraped, request.company_name, request.search_keywords)
        print(f"      -> {profile.company_name} | {profile.industry}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Company profiling failed: {str(e)}")

    try:
        print(f"[3/5] Querying Gemini, ChatGPT, Claude...")
        ai_results = await interrogate_all_ais(profile.generated_questions, profile.company_name)
        mentioned = sum(1 for r in ai_results if r.company_mentioned)
        print(f"      -> {mentioned}/{len(ai_results)} responses mentioned the company")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI interrogation failed: {str(e)}")

    try:
        print(f"[4/5] Extracting competitors and crawling their websites...")
        competitor_insights = await analyze_all_competitors(
            ai_results,
            profile.company_name,
            profile.industry,
            user_scraped=scraped,
            profile_data={"company_name": profile.company_name, "industry": profile.industry},
            questions=profile.generated_questions,
        )
        print(f"      -> Crawled {len(competitor_insights)} competitor sites")
    except Exception as e:
        print(f"      [WARNING] Competitor analysis failed: {e}")
        competitor_insights = []

    try:
        print(f"[5/5] Generating gap analysis and recommendations...")
        analysis = await analyze_and_recommend(scraped, profile, ai_results, competitor_insights)
        print(f"      -> Visibility score: {analysis['visibility_score']}/100")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")

    return {
        "website_url": request.website_url,
        "company_name": profile.company_name,
        "industry": profile.industry,
        "description": profile.description,
        "generated_questions": profile.generated_questions,
        "visibility_score": analysis["visibility_score"],
        "ai_results": [r.model_dump() for r in ai_results],
        "competitor_insights": [c.model_dump() for c in competitor_insights],
        "gap_analysis": analysis["gap_analysis"],
        "recommendations": analysis["recommendations"],
    }


# ── Streaming (SSE) endpoint ─────────────────────────────────────────

@app.post("/analyze/stream")
async def analyze_stream(request: AnalyzeRequest):
    """
    Same pipeline as /analyze but streams results step-by-step using Server-Sent Events.
    Each step emits a 'data: {...}' line as soon as it completes.

    To use with curl:
        curl -N -X POST http://localhost:8000/analyze/stream \\
          -H "Content-Type: application/json" \\
          -d '{"website_url": "https://yoursite.com"}'
    """

    async def event_generator():
        # ── Step 1: Scrape ──────────────────────────────────────────
        yield sse("step_start", {"step": 1, "name": "scraping", "message": f"Fetching website: {request.website_url}"})
        try:
            scraped = await scrape_website(str(request.website_url))
            yield sse("step_done", {
                "step": 1,
                "name": "scraping",
                "data": {
                    "title": scraped["title"],
                    "meta_description": scraped["meta_description"],
                    "headings_count": len(scraped["headings"]),
                    "body_length": len(scraped["body_text"]),
                }
            })
        except Exception as e:
            yield sse("error", {"step": 1, "name": "scraping", "message": str(e)})
            return

        # ── Step 2: Profile ─────────────────────────────────────────
        yield sse("step_start", {"step": 2, "name": "profiling", "message": "Understanding company and generating test questions..."})
        try:
            profile = await profile_company(scraped, request.company_name, request.search_keywords)
            yield sse("step_done", {
                "step": 2,
                "name": "profiling",
                "data": {
                    "company_name": profile.company_name,
                    "industry": profile.industry,
                    "description": profile.description,
                    "generated_questions": profile.generated_questions,
                }
            })
        except Exception as e:
            yield sse("error", {"step": 2, "name": "profiling", "message": str(e)})
            return

        # ── Step 3: Interrogate AIs (stream each result as it arrives) ──
        total_queries = len(profile.generated_questions) * 3
        yield sse("step_start", {
            "step": 3,
            "name": "interrogating",
            "message": f"Asking {total_queries} questions across Gemini, ChatGPT, and Claude...",
            "total": total_queries
        })

        ai_results = []
        completed = 0
        async for result in interrogate_streaming(profile.generated_questions, profile.company_name):
            ai_results.append(result)
            completed += 1
            yield sse("ai_result", {
                "step": 3,
                "completed": completed,
                "total": total_queries,
                "result": result.model_dump()
            })

        mentioned = sum(1 for r in ai_results if r.company_mentioned)
        yield sse("step_done", {
            "step": 3,
            "name": "interrogating",
            "data": {
                "total_queries": total_queries,
                "company_mentioned_count": mentioned,
                "visibility_so_far": f"{mentioned}/{total_queries}"
            }
        })

        # ── Step 4: Competitor extraction + crawling ─────────────────
        yield sse("step_start", {"step": 4, "name": "competitor_analysis", "message": "Extracting competitor names from AI responses and crawling their websites..."})
        try:
            competitor_insights = await analyze_all_competitors(
                ai_results,
                profile.company_name,
                profile.industry,
                user_scraped=scraped,
                profile_data={"company_name": profile.company_name, "industry": profile.industry},
                questions=profile.generated_questions,
            )
            yield sse("step_done", {
                "step": 4,
                "name": "competitor_analysis",
                "data": {
                    "competitors_found": len(competitor_insights),
                    "competitors": [c.model_dump() for c in competitor_insights],
                }
            })
        except Exception as e:
            yield sse("warning", {"step": 4, "name": "competitor_analysis", "message": f"Competitor analysis failed: {str(e)}"})
            competitor_insights = []

        # ── Step 5: Final analysis ───────────────────────────────────
        yield sse("step_start", {"step": 5, "name": "analysis", "message": "Generating gap analysis and recommendations..."})
        try:
            analysis = await analyze_and_recommend(scraped, profile, ai_results, competitor_insights)
            yield sse("step_done", {
                "step": 5,
                "name": "analysis",
                "data": {
                    "visibility_score": analysis["visibility_score"],
                    "gap_analysis": analysis["gap_analysis"],
                    "recommendations": analysis["recommendations"],
                }
            })
        except Exception as e:
            yield sse("error", {"step": 5, "name": "analysis", "message": str(e)})
            return

        # ── Final complete event ─────────────────────────────────────
        yield sse("complete", {
            "website_url": request.website_url,
            "company_name": profile.company_name,
            "industry": profile.industry,
            "description": profile.description,
            "generated_questions": profile.generated_questions,
            "visibility_score": analysis["visibility_score"],
            "ai_results": [r.model_dump() for r in ai_results],
            "competitor_insights": [c.model_dump() for c in competitor_insights],
            "gap_analysis": analysis["gap_analysis"],
            "recommendations": analysis["recommendations"],
        })

    return StreamingResponse(event_generator(), media_type="text/event-stream")


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
