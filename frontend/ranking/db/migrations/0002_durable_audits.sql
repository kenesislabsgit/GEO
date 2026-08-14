-- Durable audit execution, honest history, and the constraints the launch
-- audit demanded. Everything here is additive except:
--   * stale queued/running scans are closed out (they belonged to a dead
--     process model where the web server owned the Python run), and
--   * duplicate tracked prompts are collapsed before the new unique index.

-- ── scan_runs becomes a durable job row ─────────────────────────────────────

alter table scan_runs
  add column queued_at timestamptz,
  add column heartbeat_at timestamptz,
  add column last_error_at timestamptz,
  add column attempts integer not null default 0,
  add column max_attempts integer not null default 2,
  add column claimed_by text,
  add column claimed_at timestamptz,
  add column cancel_requested_at timestamptz,
  -- Machine-readable failure category; error_summary stays the human message.
  add column failure_reason text,
  -- Who asked for this scan: manual | free | scheduled | onboarding | retry |
  -- upgrade | admin_retry. scan_type stays coarse for old readers.
  add column trigger_source text,
  -- Everything the worker needs, frozen at enqueue time. A retry re-reads
  -- this snapshot; it never picks up settings edited after the click.
  add column input_snapshot jsonb,
  -- Same request twice (double click, network retry) returns the same scan.
  add column idempotency_key text,
  add column cost_ceiling_usd numeric,
  add column estimated_cost_usd numeric not null default 0,
  add column worker_version text;

alter table scan_runs drop constraint scan_runs_status_check;
alter table scan_runs add constraint scan_runs_status_check
  check (status in (
    'queued', 'running', 'completed', 'partial', 'failed',
    'cancel_requested', 'cancelled', 'timed_out'
  ));

-- Scans stuck in queued/running belong to the old in-process runner, which
-- died with the web server and left these rows blocking their brands forever.
update scan_runs
set status = 'failed',
    failure_reason = 'orphaned_pre_worker',
    error_summary = coalesce(error_summary, 'Run was orphaned before the worker existed.'),
    completed_at = coalesce(completed_at, timezone('utc', now()))
where status in ('queued', 'running');

-- One live audit per brand, enforced by the database rather than a
-- read-then-insert. Concurrent start requests get a unique violation, which
-- the API turns into "join the run already going".
create unique index scan_runs_one_active_per_brand
  on scan_runs (brand_id)
  where status in ('queued', 'running', 'cancel_requested');

create unique index scan_runs_idempotency_idx
  on scan_runs (initiated_by, idempotency_key)
  where idempotency_key is not null;

-- The two hottest scan queries filter on exactly this pair.
create index scan_runs_brand_status_idx on scan_runs (brand_id, status);
-- The worker's claim query: oldest queued first.
create index scan_runs_queue_idx on scan_runs (status, queued_at)
  where status in ('queued', 'running', 'cancel_requested');

-- ── Live progress events, durable ───────────────────────────────────────────
-- Replaces the in-memory ring buffer in lib/audit/progress-events.ts. Any web
-- instance can serve the feed for a run any worker executed.

create table scan_run_events (
  id bigint generated always as identity primary key,
  scan_run_id uuid not null references scan_runs (id) on delete cascade,
  seq integer not null,
  step text not null,
  progress integer not null default 0,
  message text,
  assistant text,
  questions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  unique (scan_run_id, seq)
);

create index scan_run_events_scan_seq_idx on scan_run_events (scan_run_id, seq);

-- ── Scores carry their methodology ──────────────────────────────────────────

alter table score_snapshots
  add column methodology_version text,
  -- The complete component breakdown exactly as the Python engine computed
  -- it (weights included). The frontend renders this; it never recomputes.
  add column breakdown jsonb;

-- Backfill from the scan the snapshot belongs to.
update score_snapshots s
set methodology_version = r.methodology_version
from scan_runs r
where r.id = s.scan_run_id and s.methodology_version is null;

-- ── Monitoring settings become a real table ─────────────────────────────────
-- They lived as app_settings rows keyed 'brand_monitoring:<brandId>', which
-- cascade-deleted with nothing and could not be joined by the scheduler.

create table brand_monitoring (
  brand_id uuid primary key references brands (id) on delete cascade,
  enabled boolean not null default true,
  frequency text not null default 'weekly' check (frequency in ('daily', 'weekly')),
  -- 0 = Monday .. 6 = Sunday; used only for weekly.
  day_of_week integer not null default 0 check (day_of_week between 0 and 6),
  hour_local integer not null default 9 check (hour_local between 0 and 23),
  timezone text not null default 'UTC',
  providers jsonb not null default '[]'::jsonb,
  country text,
  language text,
  alerts jsonb not null default '{}'::jsonb,
  last_scheduled_at timestamptz,
  updated_at timestamptz not null default timezone('utc', now())
);

create trigger brand_monitoring_updated_at
before update on brand_monitoring
for each row execute function set_updated_at();

insert into brand_monitoring (brand_id, frequency, providers, country, language, alerts)
select
  (substring(key from 'brand_monitoring:(.*)'))::uuid,
  coalesce(value->>'monitoringFrequency', 'weekly'),
  coalesce(value->'providers', '[]'::jsonb),
  value->>'country',
  value->>'language',
  coalesce(value->'alerts', '{}'::jsonb)
from app_settings
where key like 'brand_monitoring:%'
  and exists (
    select 1 from brands b
    where b.id = (substring(key from 'brand_monitoring:(.*)'))::uuid
  )
on conflict (brand_id) do nothing;

delete from app_settings where key like 'brand_monitoring:%';

-- ── Domain ownership verification ───────────────────────────────────────────
-- Claiming a company report now requires proof. Until a row here is
-- 'verified', ownership does not transfer.

create table domain_verifications (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references "user" (id) on delete cascade,
  domain text not null,
  brand_id uuid references brands (id) on delete cascade,
  method text not null check (method in ('dns_txt', 'well_known')),
  token text not null,
  status text not null default 'pending'
    check (status in ('pending', 'verified', 'failed', 'expired')),
  attempts integer not null default 0,
  last_checked_at timestamptz,
  verified_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now())
);

create index domain_verifications_user_idx on domain_verifications (user_id, domain);
create unique index domain_verifications_pending_idx
  on domain_verifications (user_id, domain)
  where status = 'pending';

-- ── Prompt hygiene ──────────────────────────────────────────────────────────
-- Collapse duplicates (same brand, same text after trim/case-fold), keeping
-- the oldest row, then stop new ones at the database.

delete from tracked_prompts t
using tracked_prompts keep
where t.brand_id = keep.brand_id
  and lower(btrim(t.prompt)) = lower(btrim(keep.prompt))
  and t.created_at > keep.created_at;

create unique index tracked_prompts_brand_prompt_idx
  on tracked_prompts (brand_id, lower(btrim(prompt)));

-- ── Alert dedupe and evidence ───────────────────────────────────────────────

alter table alerts
  add column dedupe_key text,
  add column scan_run_id uuid references scan_runs (id) on delete set null;

create unique index alerts_dedupe_idx
  on alerts (user_id, dedupe_key)
  where dedupe_key is not null;

-- ── Usage reservations ──────────────────────────────────────────────────────
-- A scan reserves its provider checks when it is created and settles them on
-- completion. One reservation and one settlement per scan, enforced here.

create unique index usage_ledger_scan_operation_idx
  on usage_ledger (scan_run_id, operation)
  where scan_run_id is not null
    and operation in ('reserve_checks', 'settle_checks');

-- ── Webhook bookkeeping and admin audit trail ───────────────────────────────

alter table webhook_events
  add column status text not null default 'processed'
    check (status in ('processed', 'failed', 'skipped')),
  add column error text;

create table admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  admin_email text not null,
  action text not null,
  target text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index admin_audit_log_created_idx on admin_audit_log (created_at desc);
