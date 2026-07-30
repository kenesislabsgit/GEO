import os
import re
import json
import asyncio
import httpx
from urllib.parse import urlparse
from bs4 import BeautifulSoup
from openai import AsyncOpenAI
from models import AIQueryResult, CompetitorInsight


# ─────────────────────────────────────────────────────────────────────
# Robust Scraper (with user-agent rotation + retry + ssl fallback)
# ─────────────────────────────────────────────────────────────────────

USER_AGENTS = [
    # Chrome Windows
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    # Chrome Mac
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    # Firefox Linux
    "Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0",
    # Safari Mac
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15",
]

COMMON_HEADERS = {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
}


async def scrape_website_robust(url: str) -> dict:
    """
    Robust scraper with user-agent rotation and retry logic.
    Tries up to 4 different user-agents before giving up.
    Falls back to ssl=False as a last resort for self-signed cert sites.
    """
    import re as _re

    last_error = "Unknown error"

    for i, ua in enumerate(USER_AGENTS):
        headers = {**COMMON_HEADERS, "User-Agent": ua}
        ssl_verify = True if i < 3 else False  # Last attempt: skip SSL verify

        try:
            async with httpx.AsyncClient(
                follow_redirects=True,
                timeout=8.0,   # 8s per attempt max — don't let dead sites stall the pipeline
                verify=ssl_verify
            ) as client:
                response = await client.get(url, headers=headers)

                if response.status_code == 200:
                    html = response.text
                    soup = BeautifulSoup(html, "html.parser")

                    title = soup.title.string.strip() if soup.title else "No title"
                    meta_desc = ""
                    meta_tag = soup.find("meta", attrs={"name": "description"})
                    if meta_tag and meta_tag.get("content"):
                        meta_desc = meta_tag["content"].strip()

                    headings = []
                    for tag in soup.find_all(["h1", "h2", "h3"]):
                        text = tag.get_text(strip=True)
                        if text:
                            headings.append(f"[{tag.name.upper()}] {text}")

                    for noise in soup(["script", "style", "nav", "footer", "header", "aside", "form", "noscript"]):
                        noise.decompose()

                    raw_text = soup.get_text(separator=" ", strip=True)
                    clean_text = _re.sub(r"\s+", " ", raw_text).strip()[:6000]

                    return {
                        "url": url,
                        "title": title,
                        "meta_description": meta_desc,
                        "headings": headings[:25],
                        "body_text": clean_text,
                        "scrape_ok": True,
                    }

                elif response.status_code in [403, 429, 503]:
                    last_error = f"HTTP {response.status_code} — blocked by site (tried UA {i+1}/{len(USER_AGENTS)})"
                    await asyncio.sleep(0.5)  # Short pause then try next UA
                    continue
                else:
                    last_error = f"HTTP {response.status_code}"
                    break

        except httpx.ConnectError:
            last_error = f"Connection refused — site may be down or blocking crawlers"
            continue
        except httpx.TimeoutException:
            last_error = f"Timeout after 25s"
            continue
        except Exception as e:
            last_error = str(e)
            continue

    # All attempts failed — return a minimal failed result (don't crash the pipeline)
    return {
        "url": url,
        "title": "",
        "meta_description": "",
        "headings": [],
        "body_text": "",
        "scrape_ok": False,
        "error": last_error,
    }


# ─────────────────────────────────────────────────────────────────────
# Smart Competitor Extraction (regex + 1 GPT call)
# ─────────────────────────────────────────────────────────────────────

def _extract_bold_candidates(ai_results: list[AIQueryResult]) -> list[str]:
    """
    AI chatbots use **bold** markdown for company names in lists.
    Extracts all bold items then pre-filters section headers and generic terms
    so the GPT validator receives a cleaner, smaller candidate list.
    """
    # Last words that indicate a section header or generic category, NOT a company name
    HEADER_ENDINGS = {
        'leaders', 'detection', 'monitoring', 'analytics', 'considerations',
        'overview', 'capabilities', 'approaches', 'features', 'benefits',
        'practices', 'limitations', 'guardrails', 'requirements', 'factors',
        'aspects', 'implications', 'tradeoffs', 'tools', 'reporting',
        'training', 'inspection', 'inputs', 'outputs', 'examples',
        'challenges', 'steps', 'guide', 'summary', 'note', 'warning',
    }

    candidates = set()
    for r in ai_results:
        if r.raw_response.startswith("ERROR") or r.raw_response.startswith("SKIPPED"):
            continue
        # Match **Bold Text** or **Bold Text:** patterns
        bold_items = re.findall(r'\*\*([^*\n]{2,60})\*\*', r.raw_response)
        for item in bold_items:
            # Strip trailing colons, spaces, punctuation
            item = item.strip().rstrip(':.,').strip()
            if not item or len(item) < 2:
                continue
            # Skip if too many words to be a company name (section headers tend to be long)
            if len(item.split()) > 6:
                continue
            # Skip if last word is a known section-header word
            last_word = item.split()[-1].lower()
            if last_word in HEADER_ENDINGS:
                continue
            # Skip 'A & B' items where either side ends with a generic term
            if ' & ' in item:
                parts = [p.strip().split()[-1].lower() for p in item.split(' & ')]
                if any(p in HEADER_ENDINGS for p in parts):
                    continue
            candidates.add(item)

    return list(candidates)


def _extract_urls_from_responses(ai_results: list[AIQueryResult]) -> list[str]:
    """
    Gemini (with google_search tool) and ChatGPT (gpt-4o-search-preview) already
    embed real, live, searched URLs inside their raw_response text.
    This pulls ALL of those verified URLs out so we can use them as ground-truth
    citations instead of letting GPT guess/hallucinate them.
    """
    url_pattern = re.compile(r'https?://[^\s\)\]\'">{]{10,}')
    all_urls = []
    for r in ai_results:
        if r.raw_response.startswith("ERROR") or r.raw_response.startswith("SKIPPED"):
            continue
        found = url_pattern.findall(r.raw_response)
        for u in found:
            # Strip trailing punctuation that regex might have caught
            u = u.rstrip('.,;:"\'|')
            try:
                parsed = urlparse(u)
                # Reconstruct just the base URL: scheme://domain.com
                base_url = f"{parsed.scheme}://{parsed.netloc}"
                if len(base_url) > 10:  # basic sanity check
                    all_urls.append(base_url)
            except Exception:
                pass
                
    # Deduplicate while preserving order
    seen = set()
    unique = []
    for u in all_urls:
        if u not in seen:
            seen.add(u)
            unique.append(u)
    return unique


async def extract_competitors_with_ai(
    ai_results: list[AIQueryResult],
    company_name: str,
    industry: str
) -> list[dict]:
    """
    Direct LLM extraction: GPT reads the raw AI responses as a human would,
    and extracts every company/product name that was recommended — no regex,
    no bold-text parsing, no information loss.

    Also feeds in any real URLs already embedded by Gemini/ChatGPT web search
    so GPT can match accurate websites instead of guessing.
    """
    # Collect valid responses
    response_blocks = []
    for r in ai_results:
        if r.raw_response.startswith("ERROR") or r.raw_response.startswith("SKIPPED"):
            continue
        # Truncate each response to keep the prompt manageable but preserve enough context
        response_blocks.append(
            f"[{r.ai_name} — Question: \"{r.question}\"]\n{r.raw_response[:1800]}"
        )

    if not response_blocks:
        print(f"[EXTRACTOR] No valid AI responses to read — cannot extract companies")
        return []

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return []

    # Pull real URLs that Gemini/ChatGPT web search already embedded in their responses
    # These are ground-truth URLs — far more accurate than GPT guessing from a company name
    verified_urls = _extract_urls_from_responses(ai_results)
    url_hint = ""
    if verified_urls:
        url_hint = f"\n\nReal URLs already cited by the AI chatbots (use these to match websites):\n" + "\n".join(verified_urls[:30])

    combined_responses = "\n\n---\n\n".join(response_blocks)

    prompt = f"""You are reading actual responses from AI chatbots (Gemini, ChatGPT, Claude) that were asked questions about finding vendors in this industry: "{industry}"

These chatbots mention and recommend specific companies and products. Your task is to extract ALL of them.

INCLUDE every company or product name that was:
- Explicitly recommended as a solution or vendor
- Listed as an example of a tool or platform
- Named as a market player in this space
- Large or small — size does not matter, include everything

EXCLUDE only:
- "{company_name}" (the user's own company)
- Pure open-source libraries with no commercial company behind them (e.g. TensorFlow, PyTorch, OpenCV, YOLO when mentioned standalone)
- Generic cloud infrastructure (AWS, Azure, Google Cloud) UNLESS a specific named product for this problem was mentioned
- Vague references with no actual company name given

For each company/product you find:
- name: exact name as written in the chatbot response
- website: their official ROOT HOMEPAGE URL (e.g. "https://company.com" NOT a deep article link). Prioritise matching the root domains from the "cited URLs" list below.{url_hint}

Chatbot Responses to read:
{combined_responses[:8000]}

Return ONLY valid JSON:
{{"competitors": [{{"name": "CompanyName", "website": "https://company.com"}}]}}"""

    client = AsyncOpenAI(api_key=api_key)
    try:
        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You extract company names mentioned in text. Be thorough — capture every named vendor. Return valid JSON only."},
                {"role": "user", "content": prompt}
            ],
            response_format={"type": "json_object"},
            max_tokens=1500,
            temperature=0.1,
        )
        data = json.loads(response.choices[0].message.content)
        found = data.get("competitors", [])
        
        # Enforce clean root URLs before returning
        for c in found:
            if c.get("website"):
                try:
                    parsed = urlparse(c["website"])
                    c["website"] = f"{parsed.scheme}://{parsed.netloc}"
                except Exception:
                    pass
                    
        print(f"[EXTRACTOR] LLM read responses and found {len(found)} companies: {[c['name'] for c in found]}")
        return found
    except Exception as e:
        print(f"[EXTRACTOR] LLM extraction failed: {e}")
        return []


# ─────────────────────────────────────────────────────────────────────
# Per-Question Comparison Analysis
# ─────────────────────────────────────────────────────────────────────

async def compare_competitor_to_user(
    competitor_scraped: dict,
    user_scraped: dict,
    profile_data: dict,
    questions: list[str],
) -> CompetitorInsight:
    """
    For a crawled competitor, analyze:
    1. What content do they have that answers the test questions?
    2. What specific content gap does this create vs the user's site?
    3. Why does AI recommend them instead?
    """
    name = competitor_scraped.get("name", "Unknown")
    # Sanitize: GPT sometimes returns None for website — always ensure it's a string
    website = competitor_scraped.get("url") or ""

    if not competitor_scraped.get("scrape_ok", False):
        error_reason = competitor_scraped.get("error", "Crawl failed")
        print(f"[ANALYZE] {name}: SKIPPED — crawl failed: {error_reason}")
        return CompetitorInsight(
            name=name,
            website=website,
            key_content="",
            why_recommended="",
            crawl_error=error_reason,
        )

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return CompetitorInsight(
            name=name,
            website=website,
            key_content="Website crawled but analysis skipped — OPENAI_API_KEY missing",
            why_recommended="",
        )

    is_giant = competitor_scraped.get("is_giant", False)
    title_lower = competitor_scraped.get("title", "").lower()
    body_len = len(competitor_scraped.get("body_text", ""))

    print(f"[ANALYZE] {name}: scrape_ok=True, is_giant={is_giant}, body_len={body_len}, title='{competitor_scraped.get('title', '')[:60]}'")

    # 🚨 Anti-Hallucination Gate 🚨
    # If it's a regular site but the scrape returned garbage or a block page, DO NOT ask GPT to analyze it!
    if not is_giant and competitor_scraped.get("scrape_ok", False):
        if "blocked" in title_lower or "access denied" in title_lower or "cloudflare" in title_lower or "captcha" in title_lower or body_len < 300:
            reason = f"Crawl blocked or insufficient content (Body: {body_len} chars, Title: '{competitor_scraped.get('title', '')[:40]}')"
            print(f"[ANALYZE] {name}: SKIPPED by anti-hallucination gate — {reason}")
            return CompetitorInsight(
                name=name,
                website=website,
                key_content="",
                why_recommended="",
                crawl_error=reason
            )

    questions_text = "\n".join([f"  Q{i+1}: {q}" for i, q in enumerate(questions)])

    if is_giant:
        prompt = f"""
You are an AI Search Optimization (AIO) expert comparing two companies to explain why one appears in AI chatbot responses and the other does not.

USER'S COMPANY (does NOT appear in AI responses):
Name: {profile_data.get('company_name', 'Unknown')}
Industry: {profile_data.get('industry', 'Unknown')}
Website Title: {user_scraped.get('title', '')}
Website Content: {user_scraped.get('body_text', '')[:800]}

COMPETITOR (DOES appear in AI responses):
Name: {name}
Website: {website}

Note: {name} is a massive tech company that blocks standard web scrapers. 
Use your extensive training knowledge of {name}'s general content, products, and positioning in this industry to answer the questions.

TEST QUESTIONS (what customers ask AI — competitor gets recommended, user does not):
{questions_text}

Analyze and answer:
1. IS_RELEVANT: Does {name} have a specific, dedicated product/solution for EXACTLY this industry ("{profile_data.get('industry', '')}"), or are they just a generic IT/data platform? Return boolean true or false.
2. COMPANY_DESCRIPTION: Briefly explain what {name} does and why they are legit in this space (1-2 sentences).
3. KEY CONTENT: What specific products, platforms, or general content topics does {name} have in this space that makes AI recommend them?
4. WHY RECOMMENDED: What does {name} do in their positioning that earns AI visibility — and what specific gap does this create compared to the user's site?
5. CITATIONS: Provide 1-2 likely URLs on their site where this information lives.

IMPORTANT: 'key_content' and 'why_recommended' must be PLAIN TEXT PARAGRAPHS. Do NOT use nested objects, arrays, or sub-dictionaries.

Respond ONLY as valid JSON:
{{
  "is_relevant": true,
  "company_description": "Brief description...",
  "key_content": "A plain text paragraph explaining...",
  "why_recommended": "A plain text paragraph explaining...",
  "citations": ["URL 1", "URL 2"]
}}
"""
    else:
        heading_text = "\n".join(competitor_scraped.get("headings", [])[:15])
        prompt = f"""
You are an AI Search Optimization (AIO) expert comparing two websites to explain why one appears in AI chatbot responses and the other does not.

USER'S COMPANY (does NOT appear in AI responses):
Name: {profile_data.get('company_name', 'Unknown')}
Industry: {profile_data.get('industry', 'Unknown')}
Website Title: {user_scraped.get('title', '')}
Website Content: {user_scraped.get('body_text', '')[:800]}

COMPETITOR (DOES appear in AI responses):
Name: {name}
Website: {website}
Title: {competitor_scraped.get('title', '')}
Meta Description: {competitor_scraped.get('meta_description', '')}
Key Headings:
{heading_text}
Body Content: {competitor_scraped.get('body_text', '')[:1500]}

TEST QUESTIONS (what customers ask AI — competitor gets recommended, user does not):
{questions_text}

Analyze and answer:
1. IS_RELEVANT: Based on their scraped content, does {name} actively offer products/solutions for EXACTLY this industry ("{profile_data.get('industry', '')}"), or are they a generic/unrelated company? Return boolean true or false.
2. COMPANY_DESCRIPTION: Based on the content, briefly explain what {name} actually does (1-2 sentences) so the user knows they are legit.
3. KEY CONTENT: What specific content, pages, or topics on {name}'s website explain why AI recommends them for these questions? Be very specific.
4. WHY RECOMMENDED: What does {name} do in their content that earns AI visibility — and what specific gap does this create compared to the user's site?
5. CITATIONS: Provide 1-2 exact or likely URLs based on what was scraped or where you think this is hosted.

IMPORTANT: 'key_content' and 'why_recommended' must be PLAIN TEXT PARAGRAPHS. Do NOT use nested objects, arrays, or sub-dictionaries.

Respond ONLY as valid JSON:
{{
  "is_relevant": true,
  "company_description": "Brief description...",
  "key_content": "A plain text paragraph explaining...",
  "why_recommended": "A plain text paragraph explaining...",
  "citations": ["URL 1", "URL 2"]
}}
"""

    client = AsyncOpenAI(api_key=api_key)
    try:
        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are an AI SEO expert. Return only valid JSON with string values, no nested objects."},
                {"role": "user", "content": prompt}
            ],
            response_format={"type": "json_object"},
            max_tokens=800,
            temperature=0.3,
        )
        data = json.loads(response.choices[0].message.content)

        # Anti-Hallucination Gate 2: The Relevance Check
        # Skip for giants and blocked sites: they already appeared in AI responses,
        # which proves they are relevant. Applying the filter here would be double-penalising them.
        is_giant_or_blocked = competitor_scraped.get("is_giant", False) or competitor_scraped.get("blocked_crawl", False)
        if not data.get("is_relevant", True) and not is_giant_or_blocked:
            print(f"[ANALYZE] {name}: FILTERED by is_relevant=false")
            return CompetitorInsight(
                name=name,
                website=website,
                title=competitor_scraped.get("title", ""),
                company_description="",
                key_content="",
                why_recommended="",
                crawl_error="Filtered: Generic platform or unrelated industry. Not a direct competitor."
            )

        print(f"[ANALYZE] {name}: SUCCESS — analysis complete")

        # GPT sometimes ignores instructions and returns nested dicts/lists instead of strings.
        key_content = data.get("key_content", "")
        why_recommended = data.get("why_recommended", "")

        if isinstance(key_content, (dict, list)):
            key_content = json.dumps(key_content, indent=2)
        if isinstance(why_recommended, (dict, list)):
            why_recommended = json.dumps(why_recommended, indent=2)

        return CompetitorInsight(
            name=name,
            website=website,
            title=competitor_scraped.get("title", ""),
            company_description=data.get("company_description", ""),
            key_content=str(key_content),
            why_recommended=str(why_recommended),
            citations=data.get("citations", []),
        )
    except Exception as e:
        print(f"[COMPARE ERROR] {name}: {str(e)}")
        return CompetitorInsight(
            name=name,
            website=website or "",   # Guard: website may be None if GPT returned null
            title=competitor_scraped.get("title", ""),
            key_content="",
            why_recommended="",
            crawl_error=f"Analysis error: {str(e)}",
        )


# ─────────────────────────────────────────────────────────────────────
# Main Pipeline Function
# ─────────────────────────────────────────────────────────────────────

async def analyze_all_competitors(
    ai_results: list[AIQueryResult],
    company_name: str,
    industry: str,
    user_scraped: dict = None,
    profile_data: dict = None,
    questions: list[str] = None,
) -> list[CompetitorInsight]:
    """
    Full pipeline:
    1. Smart extraction (regex + 1 GPT call) — finds ALL companies
    2. Robust parallel crawling with UA rotation — handles blocked sites
    3. Per-question comparison analysis — explains exactly why each competitor ranks
    """
    # Step A: Extract real company names
    competitors = await extract_competitors_with_ai(ai_results, company_name, industry)
    if not competitors:
        print(f"[COMPETITORS] No real companies found.")
        return []

    print(f"[COMPETITORS] Crawling {min(len(competitors), 6)} competitor sites in parallel...")

    # Step B: Crawl all competitor websites in parallel (cap at 6)
    async def crawl_one(comp: dict) -> dict:
        url = comp.get("website", "")
        name = comp["name"]

        # 1. Giant Tech Check: Skip crawling for companies that always block
        giant_tech = [
            "microsoft", "ibm", "amazon", "google", "siemens", "apple", "meta", "oracle", 
            "intel", "cisco", "honeywell", "nvidia", "baidu", "tencent", "alibaba",
            "hikvision", "dahua", "genetec", "milestone", "motorola", "axis", "bosch", "pelco",
            "avigilon", "panasonic", "sony", "hanwha"
        ]
        if any(g in name.lower() for g in giant_tech):
            print(f"[CRAWL] Skipping {name} (Giant tech, using AI knowledge instead)")
            return {
                "name": name,
                "url": url,
                "scrape_ok": True,  # Fake True so it gets analyzed
                "is_giant": True,
                "title": f"{name} (Analysis from AI Knowledge)",
                "headings": [],
                "body_text": ""
            }

        # 2. Normal Crawling for standard competitors
        if not url or not url.startswith("http"):
            return {"name": name, "url": url, "scrape_ok": False, "error": "No valid URL", "is_giant": False, "blocked_crawl": False}

        print(f"[CRAWL] Trying: {url}")
        result = await scrape_website_robust(url)
        result["name"] = name
        result["is_giant"] = False
        result["blocked_crawl"] = False

        if result.get("scrape_ok"):
            print(f"[CRAWL] {name}: OK — body={len(result.get('body_text',''))} chars, title='{result.get('title','')[:50]}'")
        else:
            error = result.get("error", "")
            # If the site actively blocked us (not just down/dead), fall back to LLM knowledge
            is_blocked = any(x in error.lower() for x in ["403", "429", "503", "blocked", "denied", "connection refused"])
            if is_blocked:
                print(f"[CRAWL] {name}: Blocked by site — falling back to LLM knowledge")
                return {
                    "name": name,
                    "url": url,
                    "scrape_ok": True,   # Fake True so it reaches the analysis step
                    "is_giant": True,    # Use the LLM-knowledge prompt path
                    "blocked_crawl": True,
                    "title": f"{name} (LLM knowledge — site blocked crawlers)",
                    "meta_description": "",
                    "headings": [],
                    "body_text": "",
                }
            print(f"[CRAWL] {name}: FAILED — {error}")
        return result

    crawl_tasks = [crawl_one(c) for c in competitors[:6]]
    crawled = await asyncio.gather(*crawl_tasks)

    ok_count = sum(1 for c in crawled if c.get("scrape_ok"))
    print(f"[COMPETITORS] Crawled {ok_count}/{len(crawled)} sites successfully")

    # Step C: Compare each competitor to user's site
    user_scraped = user_scraped or {}
    profile_data = profile_data or {"company_name": company_name, "industry": industry}
    questions = questions or []

    analysis_tasks = [
        compare_competitor_to_user(c, user_scraped, profile_data, questions)
        for c in crawled
    ]
    # return_exceptions=True: one company failure cannot wipe out all others.
    # Exceptions are returned as values and filtered out below.
    raw_results = await asyncio.gather(*analysis_tasks, return_exceptions=True)
    insights = []
    for r in raw_results:
        if isinstance(r, Exception):
            print(f"[COMPETITORS] Skipping one result due to error: {r}")
        else:
            insights.append(r)
    return insights
