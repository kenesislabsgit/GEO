# AI Recommendation Audit MVP

This MVP is being built step by step from `IMPLEMENTATION_PLAN.md`.

## Current Step

Steps 1 through 9 are started:

- deterministic website crawling
- deterministic website evidence
- LLM-backed company profile
- LLM-backed probable competitor seeds
- LLM-backed customer intent prompts
- OpenAI recommendation collection
- recommendation pattern aggregation
- competitor evidence collection
- user vs competitor comparison
- evidence-backed recommendations
- final Markdown report

## Run Step 1

```bash
python -m geo_audit crawl https://example.com
```

This saves:

```text
outputs/<timestamp-domain>/website_snapshot.json
```

The snapshot includes page titles, meta descriptions, headings, schema / JSON-LD, navigation links, internal links, useful image alt text, and main text.

## Run Step 2a

```bash
python -m geo_audit evidence outputs/<run-folder>/website_snapshot.json
```

This saves:

```text
outputs/<run-folder>/website_evidence.json
```

The evidence file is the deterministic comparison layer used later against competitors.

## Run Step 2b

Set an API key first:

```bash
set LLM_API_KEY=your_api_key
```

Then run:

```bash
python -m geo_audit profile outputs/<run-folder>/website_snapshot.json
```

This saves:

```text
outputs/<run-folder>/company_profile.json
```

If no API key is set, the tool saves:

```text
outputs/<run-folder>/company_profile_prompt.json
```

## Run Step 3

```bash
python -m geo_audit intents outputs/<run-folder>/company_profile.json
```

This saves:

```text
outputs/<run-folder>/customer_prompts.json
```

If no API key is set, the tool saves:

```text
outputs/<run-folder>/customer_prompts_prompt.json
```

## Run Step 4

```bash
python -m geo_audit collect outputs/<run-folder>/customer_prompts.json --limit 5
```

This saves:

```text
outputs/<run-folder>/ai_recommendations_raw.json
```

Use `--limit` while testing to control cost.

For a small multi-model test, run 5 prompts against each assistant:

```bash
python -m geo_audit collect outputs/<run-folder>/customer_prompts.json --assistants openai claude gemini --limit-per-assistant 5
```

For the current production-style test mix, use OpenAI web grounding plus AWS
Bedrock-hosted models:

```bash
python -m geo_audit collect outputs/<run-folder>/customer_prompts.json --assistants openai_search bedrock_claude bedrock_llama bedrock_mistral --limit-per-assistant 5
```

This collects up to 20 total responses. Configure keys as needed:

```text
OPENAI_API_KEY or LLM_API_KEY
ANTHROPIC_API_KEY or CLAUDE_API_KEY
GEMINI_API_KEY or GOOGLE_API_KEY
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
AWS_SESSION_TOKEN optional
AWS_REGION or AWS_DEFAULT_REGION
AGENTCORE_GATEWAY_URL optional, enables AWS AgentCore Web Search for Pro research
GATEWAY_URL accepted as an alias for AGENTCORE_GATEWAY_URL
AGENTCORE_REGION=us-east-1 required by the AgentCore Web Search connector
AGENTCORE_WEB_SEARCH_TOOL_NAME optional; otherwise discovered with MCP tools/list
AGENTCORE_GATEWAY_BEARER_TOKEN optional; omit to use AWS IAM SigV4 authentication
FIRECRAWL_API_KEY optional; enables selective competitor evidence recovery
FIRECRAWL_MAX_CREDITS_PER_AUDIT optional; defaults to 50
FIRECRAWL_MAX_REQUESTS_PER_AUDIT optional; defaults to 40
FIRECRAWL_MAX_COMPETITORS_PER_AUDIT optional; defaults to 5
FIRECRAWL_MAX_PAGES_PER_COMPETITOR optional; defaults to 4
FIRECRAWL_MAX_FINAL_EVIDENCE_PAGES optional; defaults to 6
```

Install the backend dependencies:

```bash
pip install -r requirements.txt
```

Web-presence research uses DuckDuckGo through `ddgs` first. If a query fails or
returns no usable results and `AGENTCORE_GATEWAY_URL` is configured, that query
is retried through AgentCore. Provider failures are retained in
`web_presence.json` and written as JSON lines to `web_search_errors.log` in the
audit run folder.

The Gateway must be an MCP Gateway in `us-east-1` with a connector target whose
`connectorId` is `web-search`. Its service role needs
`bedrock-agentcore:InvokeWebSearch` for
`arn:aws:bedrock-agentcore:us-east-1:aws:tool/web-search.v1`. The AWS identity
running this application needs `bedrock-agentcore:InvokeGateway` for that
Gateway ARN. Gateway creation is an AWS account setup task; the audit does not
create or modify cloud resources at runtime.

Firecrawl is the primary crawler for the audited company. It maps the site and
scrapes up to six diverse homepage, offering, industry, use-case, customer,
pricing, about, or contact pages for profiling. The standard crawler runs only
when Firecrawl is unavailable, fails, or returns incomplete buyer context.
Firecrawl pages remain preferred when fallback pages are merged. The result is
saved to `user_site_firecrawl.json`. Firecrawl is also used for weak
top-competitor sites and to recheck selected final evidence. Requests use the
basic proxy and a seven-day cache. Every attempt, error, and reported credit
count is saved to `firecrawl_usage.json` in the audit output folder.

Set `FIRECRAWL_API_KEY` to enable it. The optional
`FIRECRAWL_USER_PROFILE_MAX_PAGES` setting defaults to `6`.

OpenAI Search and each Bedrock model answer all of their assigned questions in
one structured provider call. Each item contains the natural answer plus
explicitly recommended companies, ranks, reasoning, and supporting source URLs
when web search is available. OpenAI candidate URLs are HTTP-verified before
they are exposed as citations. Other providers retain the batched analysis
fallback when they cannot return the schema directly.

Buyer questions are based on evidence-backed personas, needs, industries,
regions, and decision factors from the company profile. They are restricted to
vendor-discovery intent. Broad how-to questions, questions with no meaningful
profile match, and unsupported pricing assumptions are discarded so the audit
measures which companies are recommended for realistic buyer needs.

A Pro run performs a bounded post-answer web-presence pass for the audited
company and up to three recurring competitors. Queries are generated
deterministically from company, category, use-case, and source type. Returned
pages must load successfully and contain the company name before they are
exported as verified mentions. These mentions are kept separate from native AI
citations and are never described as sources used by the model.

Optional model overrides:

```text
LLM_MODEL / --openai-model
OPENAI_SEARCH_MODEL / --openai-search-model
ANTHROPIC_MODEL / --claude-model
GEMINI_MODEL / --gemini-model
BEDROCK_CLAUDE_MODEL / --bedrock-claude-model
BEDROCK_NOVA_MODEL / --bedrock-nova-model
BEDROCK_LLAMA_MODEL / --bedrock-llama-model
BEDROCK_MISTRAL_MODEL / --bedrock-mistral-model
```

## Run Step 5

```bash
python -m geo_audit aggregate outputs/<run-folder>/ai_recommendations_raw.json
```

For user-company mention tracking, pass the company profile:

```bash
python -m geo_audit aggregate outputs/<run-folder>/ai_recommendations_raw.json --profile outputs/<run-folder>/company_profile.json
```

This saves:

```text
outputs/<run-folder>/recommendation_patterns.json
```

The aggregation summarizes recommendation frequency, rank, model coverage, and
the buyer questions where each company appeared. Source intelligence is handled
separately so model-written URLs cannot affect competitor evidence.

## Run Step 6

During a complete Pro run, the tool tries to discover official competitor
websites from independently verified search results. Manual mappings remain
optional overrides when you already know the correct site:

```json
{
  "Competitor Name": "https://competitor.com"
}
```

Then run:

```bash
python -m geo_audit competitor-evidence outputs/<run-folder>/recommendation_patterns.json --sites competitor_sites.json
```

The standalone command should use `--sites` because it does not perform web
search itself. A complete run uses verified web-presence results, avoids obvious
third-party domains for official-site resolution, and saves discovery evidence
in `competitor_evidence.json`.

This saves:

```text
outputs/<run-folder>/competitor_evidence.json
```

## Run Step 7

```bash
python -m geo_audit compare outputs/<run-folder>/website_evidence.json outputs/<run-folder>/competitor_evidence.json
```

This saves:

```text
outputs/<run-folder>/comparison.json
```

## Run Step 8

```bash
python -m geo_audit recommend outputs/<run-folder>/company_profile.json outputs/<run-folder>/website_evidence.json outputs/<run-folder>/competitor_evidence.json outputs/<run-folder>/comparison.json
```

This saves:

```text
outputs/<run-folder>/audit_recommendations.json
```

## Run Step 9

```bash
python -m geo_audit report outputs/<run-folder>/company_profile.json outputs/<run-folder>/website_evidence.json outputs/<run-folder>/recommendation_patterns.json outputs/<run-folder>/competitor_evidence.json outputs/<run-folder>/comparison.json outputs/<run-folder>/audit_recommendations.json
```

This saves:

```text
outputs/<run-folder>/final_report.md
```

## Quality And Frontend Export

Before trusting a report, generate a quality summary:

```bash
python -m geo_audit quality outputs/<run-folder>/ai_recommendations_raw.json outputs/<run-folder>/recommendation_patterns.json outputs/<run-folder>/competitor_evidence.json outputs/<run-folder>/comparison.json
```

This saves:

```text
outputs/<run-folder>/quality_summary.json
```

Create a dashboard/frontend-ready export:

```bash
python -m geo_audit export outputs/<run-folder>/company_profile.json outputs/<run-folder>/customer_prompts.json outputs/<run-folder>/ai_recommendations_raw.json outputs/<run-folder>/recommendation_patterns.json outputs/<run-folder>/competitor_evidence.json outputs/<run-folder>/comparison.json outputs/<run-folder>/audit_recommendations.json
```

This saves:

```text
outputs/<run-folder>/audit_export.json
```
