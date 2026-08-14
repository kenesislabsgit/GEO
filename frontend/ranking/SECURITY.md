# Security model

What actually protects what, with file references. If a claim here has no
file behind it, treat the document as wrong and fix one of the two.

## Authentication and authorization

- Better Auth is the only login (email/password + Google); sessions live in
  Postgres. `proxy.ts` is a cheap presence gate; real authorization is
  `getSessionUser()` plus ownership checks inside every route and page.
- Admin: `ADMIN_EMAILS` allowlist enforced server-side in `lib/admin/guard.ts`
  for the page and every admin API. No list = no admins, all environments.
  Sensitive actions require explicit confirmation and land in
  `admin_audit_log`.
- Claiming a report requires domain-ownership proof (DNS TXT or well-known
  file, `lib/claims/verification.ts`); ownership transfers atomically and
  respects brand limits.

## Billing

- No simulation exists. Missing Dodo config → checkout/portal return 503;
  production refuses to boot without keys (`lib/env.ts`).
- Webhooks: Standard-Webhooks HMAC verification with timestamp tolerance,
  unique-event idempotency, failed events retained for reprocessing
  (`app/api/billing/webhook/route.ts`). Checkout email comes from the
  session, never the request body. Daily reconciliation against Dodo runs in
  the worker.

## SSRF and crawling

- The Python engine fetches only through `GEO/geo_audit/netguard.py`:
  http/https, default ports, no URL credentials, every resolved address
  must be public, re-validated on every redirect hop, capped bodies and
  redirect counts. Applies to the audited site, competitor sites, and every
  URL an AI answer cites. Tests: `GEO/tests/test_netguard.py`.
- Web-tier outbound (domain verification) uses
  `lib/security/safe-fetch.ts` with the same rules and no redirects.
- Run workers behind egress rules blocking internal ranges as the second
  layer.

## Abuse limits

- Distributed rate limits (Upstash when configured, else Postgres —
  never process memory): audit starts per user/IP/day, claim attempts,
  retries, exports (`lib/rate-limit/index.ts`).
- Audit creation is atomic with a one-active-scan-per-brand unique index,
  idempotency keys, and in-transaction usage reservation
  (`lib/scans/queue.ts`) — concurrency cannot exceed a plan.
- IPs in abuse records are salted hashes; `IP_HASH_SALT` is required in
  production (`lib/security/hash.ts`). Free-scan rows age out on a
  retention schedule.
- Per-scan spend ceilings are enforced inside the engine
  (`GEO/geo_audit/costs.py`).

## Headers and data exposure

- CSP (frame-ancestors 'none'), HSTS, nosniff, referrer and permissions
  policies on every response (`next.config.ts`).
- Private reports reveal nothing on any surface — page, metadata, and the
  Open Graph image all check visibility.
- Engine stderr and stack traces go to worker logs, never to users; scan
  errors shown to users are sanitized (`worker/run-audit.ts`).
- The worker passes Python an allowlisted environment only — the app's
  database and billing secrets never reach the engine process.

## Reporting

Email security findings to the address on the contact page. Please do not
test against other users' data.
