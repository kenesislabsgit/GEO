# Codex Handoff: AI Recommendation Audit MVP

This document is for a new Codex session working on this project from another machine.

It explains what we are building, what has already been implemented, what was learned, and what must be fixed next.

---

## 1. Product We Are Building

We are building an **AI Recommendation Audit Platform**.

The core question the product must answer is:

> When customers ask AI assistants for products like mine, is my company recommended? If not, who is recommended instead, and why?

This is **not** a normal SEO tool.

This is **not** a website best-practice auditor.

This is **not** a tool that promises ranking or guaranteed AI inclusion.

The product must explain AI recommendation behavior using observable evidence.

---

## 2. Correct Product Logic

The correct workflow is:

```text
User website URL
        ↓
Crawl user website
        ↓
Create website snapshot and website evidence
        ↓
Generate company profile
        ↓
Generate neutral buyer/problem prompts
        ↓
Ask AI models those prompts
        ↓
Check whether the user company was recommended
        ↓
Identify competitors recommended instead
        ↓
Analyze recommendation frequency, rank, citations, and source URLs
        ↓
Collect competitor evidence
        ↓
Find recurring patterns among recommended competitors
        ↓
Generate evidence-backed recommendations
        ↓
Generate final report
```

The key point:

> The report must be centered on AI recommendation evidence, not just website comparison.

---

## 3. Critical Lesson From The First Test

The first implementation drifted into this:

```text
Here is how your website compares to competitors.
```

That was wrong.

The correct product should say:

```text
We asked AI models real customer questions.
Your company appeared X times.
These competitors appeared instead.
Here are the repeated patterns and sources behind those recommendations.
Here is what your website is missing compared to those observed patterns.
```

This distinction matters a lot.

---

## 4. Prompt Generation Rule

Customer prompts must **never mention the user company name or domain**.

Bad:

```text
Can Kenesis work with my CCTV cameras?
```

Good:

```text
What AI video analytics tools work with existing CCTV cameras for factory safety?
```

The user company should be invisible during recommendation collection.  
Otherwise the model is biased and the test is invalid.

The prompt generator was updated to produce records like:

```json
{
  "category": "Problem",
  "buying_stage": "Discovery",
  "prompt": "How can I improve safety compliance monitoring in my factory without adding new cameras?"
}
```

---

## 5. Current Code Structure

Main package:

```text
geo_audit/
```

Important files:

```text
geo_audit/cli.py
geo_audit/crawler.py
geo_audit/evidence.py
geo_audit/profile.py
geo_audit/intents.py
geo_audit/recommendations.py
geo_audit/aggregation.py
geo_audit/competitor_evidence.py
geo_audit/comparison.py
geo_audit/audit_recommendations.py
geo_audit/report.py
geo_audit/llm.py
geo_audit/json_tools.py
geo_audit/utils.py
```

Planning and context docs:

```text
PHASE_1.md
PHASE_2.md
IMPLEMENTATION_PLAN.md
CODEX_HANDOFF.md
```

---

## 6. Implemented CLI Commands

Run with:

```bash
python -m geo_audit <command>
```

Available commands:

```bash
python -m geo_audit crawl <url>
python -m geo_audit evidence <website_snapshot.json>
python -m geo_audit profile <website_snapshot.json>
python -m geo_audit competitors <company_profile.json>
python -m geo_audit intents <company_profile.json>
python -m geo_audit collect <customer_prompts.json>
python -m geo_audit aggregate <ai_recommendations_raw.json> --profile <company_profile.json>
python -m geo_audit competitor-evidence <recommendation_patterns.json>
python -m geo_audit compare <website_evidence.json> <competitor_evidence.json>
python -m geo_audit recommend <company_profile.json> <website_evidence.json> <competitor_evidence.json> <comparison.json> --patterns <recommendation_patterns.json>
python -m geo_audit report <company_profile.json> <website_evidence.json> <recommendation_patterns.json> <competitor_evidence.json> <comparison.json> <audit_recommendations.json>
```

---

## 7. Current Data Outputs

Each run saves into:

```text
outputs/<timestamp-domain>/
```

Important generated files:

```text
website_snapshot.json
website_evidence.json
company_profile.json
probable_competitors.json
customer_prompts.json
ai_recommendations_raw.json
recommendation_patterns.json
competitor_evidence.json
comparison.json
audit_recommendations.json
final_report.md
```

---

## 8. Environment Setup

The project currently uses OpenAI only.

Expected environment variable:

```text
OPENAI_API_KEY
```

or:

```text
LLM_API_KEY
```

The code also loads `.env` from the project root.

Optional:

```text
LLM_MODEL
LLM_API_BASE
```

Default model currently:

```text
gpt-4.1-mini
```

---

## 9. What Was Tested

Test website:

```text
https://kenesis.ai
```

Run folder:

```text
outputs/20260720-225558-kenesis.ai/
```

The corrected test used **30 neutral customer prompts**.

Important result:

```text
Kenesis was recommended 0/30 times.
```

Top OpenAI-recommended competitors:

```text
1. Honeywell - 13 mentions
2. BriefCam - 8 mentions
3. IBM - 7 mentions
4. Siemens - 7 mentions
5. Avigilon - 4 mentions
```

This result is now aligned with the actual product goal.

---

## 10. Important Limitation: Manual Competitor Website Mapping

The current system can identify recommended competitor names.

But it does **not yet automatically discover official competitor websites**.

For the Kenesis test, this file was manually created:

```text
outputs/20260720-225558-kenesis.ai/competitor_sites.json
```

It mapped competitor names to websites:

```json
{
  "Honeywell": "https://www.honeywell.com/en-us/industries/industrial-safety",
  "BriefCam": "https://www.briefcam.com/",
  "IBM": "https://www.ibm.com/cloud/edge-computing",
  "Siemens": "https://www.siemens.com/global/en/products/automation.html",
  "Avigilon (a Motorola Solutions company)": "https://www.avigilon.com/"
}
```

This is not acceptable for the final MVP.

Next Codex should implement automatic official website discovery.

---

## 11. Important Limitation: OpenAI Only

The product vision requires:

```text
ChatGPT
Claude
Gemini
```

Current implementation only uses OpenAI.

Claude and Gemini are not implemented yet.

The final aggregation should eventually show:

```text
Competitor: Honeywell

OpenAI: 13/30
Claude: x/30
Gemini: x/30
Total: x/90
Average rank: x
```

Do not call the product complete until multi-model collection works.

---

## 12. What The Final Report Must Emphasize

The report must lead with AI recommendation evidence:

```text
Was the user company recommended?
How often?
In which prompt categories?
Which prompts did it lose?
Who appeared instead?
Which competitors appeared repeatedly?
What sources did AI cite?
What patterns do those competitors share?
What evidence is missing from the user website?
What should be changed first?
Why does that change matter?
```

The report must not lead with a generic website audit.

Website audit is supporting evidence, not the main product.

---

## 13. Recommendation Quality Standard

Every recommendation must contain:

```text
Observation
Evidence
Suggested Change
Expected Impact
Confidence
```

The recommendation must connect to at least one of:

```text
AI recommendation frequency
Prompt where user was not recommended
Cited source pattern
Recurring competitor pattern
Competitor website evidence
```

Bad recommendation:

```text
Create a FAQ page.
```

Good recommendation:

```text
Observation:
The user website has no FAQ.

Evidence:
Several recommended competitors answer deployment, integration, privacy, and support questions in FAQ or documentation pages. These competitors appeared repeatedly across decision-making and feature prompts.

Suggested Change:
Add an FAQ covering deployment, existing infrastructure compatibility, data handling, offline operation, hardware requirements, and support.

Expected Impact:
Improves answerability and evidence quality for questions that AI systems currently answer using competitor content.

Confidence:
Medium
```

---

## 14. Language Rules

Never say:

```text
This will make ChatGPT recommend you.
This will increase your ranking.
This guarantees AI visibility.
This will increase the likelihood of being recommended.
```

Say instead:

```text
This improves clarity.
This improves machine readability.
This aligns the website with patterns observed among repeatedly recommended competitors.
This gives AI systems more explicit evidence to understand the company.
```

---

## 15. Current Code Fixes Already Done

The following fixes were already made:

- customer prompts no longer mention company name/domain
- prompts now include category and buying stage
- recommendation collection preserves prompt category
- aggregator tracks user-company mentions
- aggregator produces prompt win/loss analysis
- aggregator produces prompt category stats
- comparison produces recurring competitor patterns
- recommendations receive `recommendation_patterns.json`
- report prompt leads with AI recommendation evidence
- report writer strips unnecessary markdown code fences
- OpenAI JSON response mode is used for recommendation collection
- malformed recommendation responses no longer crash the full collection run

---

## 16. Next Engineering Priorities

### Priority 1: Automatic Competitor Website Discovery

Current blocker:

```text
competitor_sites.json is manual.
```

Need:

```text
competitor name → official website URL
```

Possible approach:

- use cited source URLs first
- prefer official domains
- use deterministic domain scoring
- if needed, add an LLM validation step
- store confidence and evidence

Output should be:

```json
{
  "company_name": "BriefCam",
  "official_website": "https://www.briefcam.com/",
  "confidence": "High",
  "evidence": ["source URLs or reasoning"]
}
```

### Priority 2: Claude Integration

Add Anthropic API support.

The raw result structure must stay the same as OpenAI:

```json
{
  "prompt": "",
  "prompt_category": "",
  "buying_stage": "",
  "model": "",
  "assistant": "claude",
  "recommended_companies": []
}
```

### Priority 3: Gemini Integration

Add Gemini API support using the same normalized result structure.

### Priority 4: Multi-Model Aggregation

Aggregation should report:

```text
mentions by model
average rank by model
total mentions across all models
prompt categories where user loses
source frequency by competitor
```

### Priority 5: Better Source/Citation Analysis

Current source analysis is basic.

Need:

```text
source URL → domain → source type → competitor → count
```

Example:

```json
{
  "competitor": "IBM",
  "sources": [
    {
      "domain": "ibm.com",
      "type": "official_site",
      "count": 8
    },
    {
      "domain": "g2.com",
      "type": "review_platform",
      "count": 3
    }
  ]
}
```

### Priority 6: Better Pattern Analysis

The system should calculate:

```text
5/5 top competitors have feature pages
4/5 have use case pages
3/5 have documentation
2/5 have case studies
```

Then recommendations should come directly from these patterns.

---

## 17. Do Not Overfit Prompts

When improving prompts, do not hard-code Kenesis examples.

Prompts should explain the behavior generally.

Do not write prompts that only work for industrial CCTV.

The system must work for any company website.

---

## 18. Best Next Task For Codex

Start by implementing:

```text
automatic competitor official website discovery
```

Why:

Without this, the pipeline still needs manual intervention before competitor evidence collection.

After that, implement:

```text
Claude + Gemini recommendation collection
```

Then rerun the Kenesis audit as:

```text
30 prompts × 3 models = 90 responses
```

The final report should show:

```text
Kenesis recommended: x/90
Competitors recommended instead: ...
Per-model breakdown: ...
Top cited sources: ...
Recurring competitor patterns: ...
Evidence-backed recommendations: ...
```

---

## 19. Quick Sanity Checklist

Before trusting a generated report, check:

- Did customer prompts avoid the user company name?
- Did prompts avoid the user domain?
- Did aggregation show user mentions?
- Did top competitors come from AI responses, not seed guesses?
- Did competitor evidence avoid manual mapping if possible?
- Did recommendations cite AI-observed patterns?
- Did report lead with recommendation evidence?
- Did report avoid SEO/ranking promises?
- Did report include prompt stats?
- Did report include why competitors win?

---

## 20. Current Honest Project Status

The project is now technically functional for an OpenAI-only MVP.

It correctly tests whether the user company appears in neutral AI recommendation prompts.

But it is not complete because:

- competitor official website discovery is manual
- Claude is not integrated
- Gemini is not integrated
- source/citation analysis is still basic
- pattern analysis exists but should be strengthened

The most important product correction has already been made:

> The system now measures whether the user company is recommended, instead of just auditing the website.

