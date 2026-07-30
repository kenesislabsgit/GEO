# Architecture

## Overview

RankedByAI is a Next.js App Router SaaS that:

1. Understands a company website
2. Generates unbiased buyer prompts
3. Queries AI search providers in isolation
4. Analyzes answers with structured validation + deterministic alias matching
5. Scores visibility and stores evidence
6. Serves public reports and premium dashboards

## Module layout

```
app/                 routes + API handlers
components/          UI
lib/ai/providers     OpenAI / Gemini / Perplexity adapters
lib/ai/prompts       prompt generation
lib/ai/schemas       Zod schemas
lib/ai/scoring       pure scoring functions
lib/billing          entitlements + account helpers
lib/db               Supabase clients + repository + local store
lib/jobs             Inngest + scan executor
lib/rate-limit       Upstash / memory limits
lib/security         URL/SSRF + Turnstile
lib/reports          public DTO lock-down
types/               shared types
tests/               unit, integration, e2e
supabase/migrations  SQL + RLS
```

## Scan flow

```
Domain input → normalize/SSRF checks → cache lookup
→ Turnstile + rate limits → website understanding → category confirm
→ create brand/prompts/scan_run → enqueue Inngest (or inline)
→ per prompt × provider query → analyze → score → recommendations
→ public report
```

Provider failures never fail the whole scan; status becomes `partial`.

## Persistence

- Production: Supabase service role on server only; RLS for user sessions
- Local without Supabase: `.data/local-store.json` labelled demo persistence

## Entitlements

All plan checks go through `lib/billing/entitlements.ts` and
`getAccountEntitlements()`. Browser-sent plan claims are never trusted.
