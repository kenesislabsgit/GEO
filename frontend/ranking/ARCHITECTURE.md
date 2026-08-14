# Architecture

## The shape

```
Browser ── Next.js app (stateless) ──┐
                                     ├── PostgreSQL  (the only durable state)
Worker fleet (separate deploy) ──────┘
   └─ spawns `python -m geo_audit run …` per claimed scan
```

Everything durable is a Postgres row. The web tier validates, authorizes,
enqueues, and reads; it holds no scan state in memory and never spawns
Python. Workers claim jobs with `FOR UPDATE SKIP LOCKED`, heartbeat while
the engine runs, stream progress into `scan_run_events`, and import the
engine's `audit_export.json` in **one transaction**. Any web instance can
serve any scan's progress; a web deploy mid-audit changes nothing.

## Module layout

```
app/                    routes + API handlers
worker/                 the audit worker: queue loop, scheduler, alerts,
                        retention, billing reconciliation, health server
lib/scans/queue.ts      enqueue/claim/heartbeat/cancel/retry/reap + events
lib/audit/import-export transactional import of the engine's export
lib/billing             entitlements, enforcement, Dodo plumbing
lib/claims              domain-ownership verification (DNS TXT / well-known)
lib/db                  pg pool + withTransaction (AsyncLocalStorage) + SQL
lib/security            URL validation, SSRF-safe fetch, IP hashing
lib/rate-limit          Upstash when configured, else Postgres fixed windows
db/migrations           SQL migrations (scripts/migrate.mjs applies them)
../../GEO/geo_audit     the Python audit engine (crawl → questions →
                        providers → scoring → export), with netguard.py
                        SSRF protection and costs.py spend ceiling
```

## Scan lifecycle

```
queued ──claim──▶ running ──▶ completed | partial
   │                 │  ├──▶ failed (attempts exhausted) ──retry──▶ queued
   │                 │  └──▶ timed_out (heartbeat silence, reaper)
   └──cancel──▶ cancelled ◀──cancel_requested (worker kills engine)
```

Creation is atomic: a partial unique index allows one active scan per brand,
an idempotency key makes request retries join the existing scan, and the
provider-check reservation is written in the same transaction (settled
against actual usage on completion). A retry replays the scan's stored
`input_snapshot` — never settings edited after the click.

## Scheduling and alerts

The worker owns scheduling (no external cron service): every 5 minutes it
checks `brand_monitoring` (frequency, local day/hour, timezone, providers,
locale), rotates deterministically through the brand's tracked questions so
a month of runs fits the plan's check allowance, and enqueues through the
same path as a manual audit. After every finished scan the worker diffs
score, competitors, and cited sources against the previous snapshot and
raises deduplicated alerts (emailed only after the provider confirms).

## Entitlements

`authorizeAudit` + `enqueueScan` are the door: plan checks, provider and
question clamps, brand limits (including audit-created brands), and monthly
allowance reservation happen server-side in one transaction. UI hiding is
presentation, never enforcement.

## Security

- Crawling: `GEO/geo_audit/netguard.py` guards every fetch of a URL the
  pipeline did not choose (audited site, redirects, cited URLs): public
  addresses only, re-checked per redirect hop, size and time caps. Worker
  egress rules are the infrastructure backstop.
- Web outbound: `lib/security/safe-fetch.ts` for domain-verification checks.
- Claiming a report requires domain proof (DNS TXT or well-known file).
- Security headers (CSP, HSTS, etc.) in `next.config.ts`; admin routes
  require `ADMIN_EMAILS`; billing webhooks are signature-verified and
  idempotent.
