from pydantic import BaseModel, HttpUrl
from typing import Optional, List


class AnalyzeRequest(BaseModel):
    website_url: str
    company_name: Optional[str] = None
    search_keywords: Optional[str] = None  # Optional: user-supplied keywords


class CompanyProfile(BaseModel):
    company_name: str
    industry: str
    description: str
    generated_questions: List[str]


class AIQueryResult(BaseModel):
    ai_name: str                  # "Gemini", "ChatGPT", "Claude"
    question: str
    raw_response: str
    company_mentioned: bool
    mentioned_competitors: List[str] = []  # Populated by competitor_analyzer, not interrogator


class CompetitorInsight(BaseModel):
    name: str
    website: str
    title: str = ""
    company_description: str = ""  # What this company actually does
    key_content: str      # What content on their site explains their AI visibility
    why_recommended: str  # Why AI recommends them
    citations: List[str] = []     # Links/citations if available
    crawl_error: str = "" # If crawling failed


class ActionableRecommendation(BaseModel):
    title: str
    why_it_helps: str
    keywords: str
    example_data: str


class AnalysisReport(BaseModel):
    website_url: str
    company_name: str
    profile: CompanyProfile
    ai_results: List[AIQueryResult]
    overall_visibility_score: float
    competitor_insights: List[CompetitorInsight]
    gap_analysis: str
    recommendations: List[ActionableRecommendation]
