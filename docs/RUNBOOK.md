# Operations runbook

What to do when something breaks, in the order you'll need it.

## Queue is backed up (scans stuck in `queued`)

1. `curl :8787/healthz` on each worker host. No answer → the worker is down;
   restart it (`npm run worker`). Jobs are untouched — queued rows wait.
2. `/admin` shows queued/running/stale counts. Stale > 0 means a worker died
   mid-run; the reaper requeues those within `SCAN_HEARTBEAT_TIMEOUT_SECONDS`
   (default 180s) automatically.
3. Persistent backlog → raise `WORKER_CONCURRENCY` or add a worker process.

## AI calls are waiting or retrying

Worker health shows active and waiting calls separately for each provider.
Raise `MAX_ACTIVE_AUDITS` only while provider RPM/TPM capacity remains. A 429
means configured limits exceed the account's real capacity; temporary 5xx
responses retry three times. Multiple workers must share the same ElastiCache
Valkey connection or their limits will not be global.

## A scan is stuck `running`

Wait one heartbeat timeout — the reaper requeues or times it out on its own.
If it truly never resolves, cancel from `/admin` (Scan controls → Cancel)
and retry. Never edit `scan_runs` rows by hand while a worker is up.

## Provider outage (one AI provider failing every call)

1. `/admin` → Operational controls → Disabled providers → add the provider id
   (e.g. `gemini`). New scans skip it immediately; running scans finish as
   `partial`.
2. Re-enable when the provider recovers. Affected users can hit Retry — it
   replays the same stored inputs.

## Billing webhooks failing

`/admin` → "Billing webhook failures" lists failed events with reasons. The
event row stays recorded with status `failed`, so Dodo's retry reprocesses
it once the cause (usually DB connectivity or a bad product-id mapping) is
fixed. The worker also reconciles subscription statuses against Dodo daily,
so a missed webhook heals within a day.

## Emails not arriving

Alert emails set `emailed_at` only on confirmed acceptance; check worker
logs for `alert_email_failed`. Verify `RESEND_API_KEY` and that `EMAIL_FROM`
uses a verified domain in Resend. Verification/reset mail failures surface
in the web logs the same way.

## Database incident

The web tier fails closed (500s, `/api/health` → 503) and workers stop
claiming; nothing is lost. After restore: workers resume automatically; the
reaper cleans up scans that died mid-run. Run `npm run db:migrate:check`
before declaring recovery done.

## Runaway spend

- Per-scan ceiling: `SCAN_COST_CEILING_USD` (enforced inside the engine —
  exceeding it stops new provider calls, marks the scan partial).
- Global stop: `/admin` → maintenance mode blocks all new audits.
- Per-account: monthly check allowances are reserved at enqueue, so a user
  cannot exceed their plan even with concurrent requests.

## Maintenance mode

`/admin` → Operational controls. Blocks manual and scheduled enqueues with a
clear message; running scans finish. Logged to the admin audit log.

## Rotating a leaked provider key

Provider keys live in `GEO/.env` on worker hosts. Rotate at the provider,
update the file, restart workers. Web tier is unaffected (it holds no
provider keys).
