-- Arcanoris schema — plain PostgreSQL.
--
-- This replaces the files in supabase/migrations. What changed when we left
-- Supabase:
--
--   1. Accounts belong to Better Auth. It creates and owns its own tables in
--      this same database ("user", "session", "account", "verification" —
--      created by `npx @better-auth/cli migrate`, never by hand here). Every
--      column that used to point at Supabase's auth.users now points at
--      "user". Better Auth ids are text, so those columns are text, not uuid.
--
--   2. Row level security is gone. All 17 policies expressed "the owner may
--      read this", but every server query already ran as the service role,
--      which bypasses RLS entirely. The checks that actually protected data
--      were always the ones in lib/db/repository.ts and the route handlers.
--
--   3. Which AI models exist is data, not schema. The old provider checks
--      allowed three names while the code writes seven; every insert of a
--      real audit would have failed. No provider list lives here.
--
-- Run order: Better Auth's migrate first (it creates "user"), then this file.

create extension if not exists "pgcrypto";

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

-- ── Brands and their audits ─────────────────────────────────────────────────

create table brands (
  id uuid primary key default gen_random_uuid(),
  owner_id text references "user" (id) on delete set null,
  name text not null,
  canonical_domain text not null,
  slug text not null unique,
  logo_url text,
  description text,
  category text,
  target_audience text,
  aliases jsonb not null default '[]'::jsonb,
  default_country text not null default 'US',
  default_language text not null default 'en',
  visibility text not null default 'public' check (visibility in ('public', 'private')),
  claimed_at timestamptz,
  metadata_confidence jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

-- One record per website per account. The domain is deliberately not unique on
-- its own: several people may audit the same website, and whoever got there
-- first must not own it for everyone else. Anonymous audits have a null
-- owner_id and so escape this index entirely — two visitors auditing the same
-- site at the same moment each get their own row.
create unique index brands_owner_domain_idx
  on brands (owner_id, canonical_domain)
  where owner_id is not null;

-- Public report links resolve by domain, so that lookup still needs an index.
create index brands_canonical_domain_lookup_idx on brands (canonical_domain);
create index brands_owner_id_idx on brands (owner_id);

create table competitors (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands (id) on delete cascade,
  name text not null,
  domain text,
  aliases jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index competitors_brand_id_idx on competitors (brand_id);

create table tracked_prompts (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands (id) on delete cascade,
  prompt text not null,
  prompt_type text not null,
  buyer_stage text not null,
  country text not null default 'US',
  language text not null default 'en',
  active boolean not null default true,
  is_custom boolean not null default false,
  rationale text,
  created_at timestamptz not null default timezone('utc', now())
);

create index tracked_prompts_brand_id_idx on tracked_prompts (brand_id);
create index tracked_prompts_active_idx on tracked_prompts (brand_id, active);

create table scan_runs (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands (id) on delete cascade,
  initiated_by text references "user" (id) on delete set null,
  scan_type text not null check (scan_type in ('free', 'manual', 'scheduled')),
  status text not null check (status in ('queued', 'running', 'completed', 'partial', 'failed', 'cancelled')),
  provider_ids jsonb not null default '[]'::jsonb,
  total_queries integer not null default 0,
  completed_queries integer not null default 0,
  started_at timestamptz,
  completed_at timestamptz,
  error_summary text,
  methodology_version text not null,
  demo_mode boolean not null default false,
  cancelled_at timestamptz,
  country text,
  language text,
  -- Where a running audit has got to: the runner's own step name and a 0-100
  -- number. Lets a reloaded page ask "where is it?" instead of holding a wire
  -- open for four minutes. The customer wording for each step lives in
  -- lib/audit/progress-copy.ts, never here.
  step text,
  progress integer not null default 0,
  -- Where the audit leaves this company, in three or four sentences. The
  -- dashboard's verdict used to be a threshold on the mention rate, so nothing
  -- on screen said what any of the numbers meant. Nullable: audits recorded
  -- before this existed simply have nothing to show here.
  summary text,
  created_at timestamptz not null default timezone('utc', now())
);

create index scan_runs_brand_id_idx on scan_runs (brand_id);
create index scan_runs_status_idx on scan_runs (status);
create index scan_runs_created_at_idx on scan_runs (created_at desc);

create table query_results (
  id uuid primary key default gen_random_uuid(),
  scan_run_id uuid not null references scan_runs (id) on delete cascade,
  tracked_prompt_id uuid references tracked_prompts (id) on delete set null,
  -- Free text on purpose: the code decides which models exist, not the schema.
  provider text not null,
  model text not null,
  raw_answer text not null default '',
  answer_summary text,
  brand_mentioned boolean not null default false,
  brand_position integer,
  brand_sentiment text check (brand_sentiment in ('positive', 'neutral', 'negative', 'mixed') or brand_sentiment is null),
  confidence numeric,
  recommended_brands jsonb not null default '[]'::jsonb,
  citations jsonb not null default '[]'::jsonb,
  sources jsonb not null default '[]'::jsonb,
  claims jsonb not null default '[]'::jsonb,
  latency_ms integer,
  usage_metadata jsonb not null default '{}'::jsonb,
  estimated_cost numeric,
  error text,
  is_demo boolean not null default false,
  created_at timestamptz not null default timezone('utc', now())
);

create index query_results_scan_run_id_idx on query_results (scan_run_id);
create index query_results_provider_idx on query_results (provider);

create table score_snapshots (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands (id) on delete cascade,
  scan_run_id uuid not null references scan_runs (id) on delete cascade,
  overall_score numeric not null,
  mention_score numeric not null,
  position_score numeric not null,
  citation_score numeric not null,
  sentiment_score numeric not null,
  mention_rate numeric not null,
  average_position numeric,
  share_of_voice numeric not null default 0,
  competitor_scores jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index score_snapshots_brand_id_idx on score_snapshots (brand_id, created_at desc);
create unique index score_snapshots_scan_run_id_idx on score_snapshots (scan_run_id);

create table recommendations (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands (id) on delete cascade,
  scan_run_id uuid not null references scan_runs (id) on delete cascade,
  title text not null,
  explanation text not null,
  evidence jsonb not null default '[]'::jsonb,
  action_type text not null,
  priority integer not null default 3,
  estimated_impact text,
  affected_prompts jsonb not null default '[]'::jsonb,
  suggested_content_brief jsonb,
  status text not null default 'open' check (status in ('open', 'in_progress', 'completed', 'dismissed')),
  created_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz
);

create index recommendations_brand_id_idx on recommendations (brand_id);

-- ── Billing ─────────────────────────────────────────────────────────────────

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references "user" (id) on delete cascade,
  provider text not null default 'dodo',
  provider_customer_id text,
  provider_subscription_id text unique,
  plan text not null check (plan in ('founder', 'growth', 'agency')),
  status text not null check (status in ('active', 'trialing', 'canceled', 'past_due', 'inactive', 'paused')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index subscriptions_user_id_idx on subscriptions (user_id);

create table usage_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id text references "user" (id) on delete set null,
  brand_id uuid references brands (id) on delete set null,
  scan_run_id uuid references scan_runs (id) on delete set null,
  provider text,
  operation text not null,
  units integer not null default 1,
  estimated_cost numeric not null default 0,
  billing_period text not null,
  created_at timestamptz not null default timezone('utc', now())
);

create index usage_ledger_user_period_idx on usage_ledger (user_id, billing_period);
create index usage_ledger_brand_period_idx on usage_ledger (brand_id, billing_period);

-- A payment provider retries a webhook until we acknowledge it, so the same
-- event arrives more than once. The unique constraint is what makes processing
-- one twice a no-op rather than a duplicate upgrade.
create table webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_id text not null,
  event_type text not null,
  payload jsonb not null,
  processed_at timestamptz not null default timezone('utc', now()),
  unique (provider, event_id)
);

-- ── Everything else ─────────────────────────────────────────────────────────

create table free_scan_requests (
  id uuid primary key default gen_random_uuid(),
  domain text not null,
  normalized_domain text not null,
  ip_hash text,
  scan_run_id uuid references scan_runs (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now())
);

create index free_scan_requests_domain_created_idx on free_scan_requests (normalized_domain, created_at desc);
create index free_scan_requests_ip_created_idx on free_scan_requests (ip_hash, created_at desc);

create table alerts (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references "user" (id) on delete cascade,
  brand_id uuid references brands (id) on delete cascade,
  type text not null,
  title text not null,
  body text not null,
  metadata jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  emailed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

create index alerts_user_id_idx on alerts (user_id, created_at desc);

create table app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default timezone('utc', now())
);

insert into app_settings (key, value)
values
  ('providers_disabled', '[]'::jsonb),
  ('maintenance_mode', 'false'::jsonb);

-- ── Triggers ────────────────────────────────────────────────────────────────

create trigger brands_updated_at
before update on brands
for each row execute function set_updated_at();

create trigger subscriptions_updated_at
before update on subscriptions
for each row execute function set_updated_at();
