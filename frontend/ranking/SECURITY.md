# Security

## Data access

- Supabase RLS on all user-owned tables
- Service role used only in server jobs/webhooks/admin paths
- Public reports use locked DTOs (`lib/reports/public-dto.ts`)
- Private reports / dashboard routes are `noindex`

## SSRF / fetch safety

`lib/security/url.ts` and `lib/ai/website/fetch.ts` enforce:

- https/http only
- no localhost / private IPs / metadata hosts
- timeouts
- response size limits
- content-type checks

## Abuse controls

- Cloudflare Turnstile on free scans (required in production when configured)
- Per-IP and per-domain rate limits (Upstash or memory fallback)
- 30-day free-scan cache
- Idempotency keys for scan starts and webhooks
- Monthly usage ledger + cost ceiling per scan

## Billing

- Signed Dodo webhooks
- Idempotent event storage
- Server-side entitlement enforcement

## Secrets

- Never log API keys or raw model chain-of-thought
- `.env*` excluded from git
- Account export + deletion available in Settings
