-- RankedByAI initial schema + RLS

create extension if not exists "pgcrypto";

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.brands (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references public.profiles (id) on delete set null,
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

create unique index brands_canonical_domain_idx on public.brands (canonical_domain);
create index brands_owner_id_idx on public.brands (owner_id);

create table public.competitors (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  name text not null,
  domain text,
  aliases jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index competitors_brand_id_idx on public.competitors (brand_id);

create table public.tracked_prompts (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
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

create index tracked_prompts_brand_id_idx on public.tracked_prompts (brand_id);
create index tracked_prompts_active_idx on public.tracked_prompts (brand_id, active);

create table public.scan_runs (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  initiated_by uuid references public.profiles (id) on delete set null,
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
  created_at timestamptz not null default timezone('utc', now())
);

create index scan_runs_brand_id_idx on public.scan_runs (brand_id);
create index scan_runs_status_idx on public.scan_runs (status);
create index scan_runs_created_at_idx on public.scan_runs (created_at desc);

create table public.query_results (
  id uuid primary key default gen_random_uuid(),
  scan_run_id uuid not null references public.scan_runs (id) on delete cascade,
  tracked_prompt_id uuid references public.tracked_prompts (id) on delete set null,
  provider text not null check (provider in ('openai', 'gemini', 'perplexity')),
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

create index query_results_scan_run_id_idx on public.query_results (scan_run_id);
create index query_results_provider_idx on public.query_results (provider);

create table public.score_snapshots (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  scan_run_id uuid not null references public.scan_runs (id) on delete cascade,
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

create index score_snapshots_brand_id_idx on public.score_snapshots (brand_id, created_at desc);
create unique index score_snapshots_scan_run_id_idx on public.score_snapshots (scan_run_id);

create table public.recommendations (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  scan_run_id uuid not null references public.scan_runs (id) on delete cascade,
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

create index recommendations_brand_id_idx on public.recommendations (brand_id);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
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

create index subscriptions_user_id_idx on public.subscriptions (user_id);

create table public.usage_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete set null,
  brand_id uuid references public.brands (id) on delete set null,
  scan_run_id uuid references public.scan_runs (id) on delete set null,
  provider text check (provider in ('openai', 'gemini', 'perplexity') or provider is null),
  operation text not null,
  units integer not null default 1,
  estimated_cost numeric not null default 0,
  billing_period text not null,
  created_at timestamptz not null default timezone('utc', now())
);

create index usage_ledger_user_period_idx on public.usage_ledger (user_id, billing_period);
create index usage_ledger_brand_period_idx on public.usage_ledger (brand_id, billing_period);

create table public.free_scan_requests (
  id uuid primary key default gen_random_uuid(),
  domain text not null,
  normalized_domain text not null,
  ip_hash text,
  scan_run_id uuid references public.scan_runs (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now())
);

create index free_scan_requests_domain_created_idx on public.free_scan_requests (normalized_domain, created_at desc);
create index free_scan_requests_ip_created_idx on public.free_scan_requests (ip_hash, created_at desc);

create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  brand_id uuid references public.brands (id) on delete cascade,
  type text not null,
  title text not null,
  body text not null,
  metadata jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  emailed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

create index alerts_user_id_idx on public.alerts (user_id, created_at desc);

create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_id text not null,
  event_type text not null,
  payload jsonb not null,
  processed_at timestamptz not null default timezone('utc', now()),
  unique (provider, event_id)
);

create table public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default timezone('utc', now())
);

insert into public.app_settings (key, value)
values
  ('providers_disabled', '[]'::jsonb),
  ('maintenance_mode', 'false'::jsonb);

create trigger profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger brands_updated_at
before update on public.brands
for each row execute function public.set_updated_at();

create trigger subscriptions_updated_at
before update on public.subscriptions
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- RLS
alter table public.profiles enable row level security;
alter table public.brands enable row level security;
alter table public.competitors enable row level security;
alter table public.tracked_prompts enable row level security;
alter table public.scan_runs enable row level security;
alter table public.query_results enable row level security;
alter table public.score_snapshots enable row level security;
alter table public.recommendations enable row level security;
alter table public.subscriptions enable row level security;
alter table public.usage_ledger enable row level security;
alter table public.free_scan_requests enable row level security;
alter table public.alerts enable row level security;
alter table public.webhook_events enable row level security;
alter table public.app_settings enable row level security;

create policy "Users read own profile"
on public.profiles for select
using (auth.uid() = id);

create policy "Users update own profile"
on public.profiles for update
using (auth.uid() = id);

create policy "Public brands are readable"
on public.brands for select
using (visibility = 'public' or owner_id = auth.uid());

create policy "Owners manage brands"
on public.brands for all
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

create policy "Owners manage competitors"
on public.competitors for all
using (
  exists (
    select 1 from public.brands b
    where b.id = competitors.brand_id and b.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.brands b
    where b.id = competitors.brand_id and b.owner_id = auth.uid()
  )
);

create policy "Public competitors for public brands"
on public.competitors for select
using (
  exists (
    select 1 from public.brands b
    where b.id = competitors.brand_id and (b.visibility = 'public' or b.owner_id = auth.uid())
  )
);

create policy "Owners manage prompts"
on public.tracked_prompts for all
using (
  exists (
    select 1 from public.brands b
    where b.id = tracked_prompts.brand_id and b.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.brands b
    where b.id = tracked_prompts.brand_id and b.owner_id = auth.uid()
  )
);

create policy "Public prompts for public brands"
on public.tracked_prompts for select
using (
  exists (
    select 1 from public.brands b
    where b.id = tracked_prompts.brand_id and (b.visibility = 'public' or b.owner_id = auth.uid())
  )
);

create policy "Owners read scan runs"
on public.scan_runs for select
using (
  exists (
    select 1 from public.brands b
    where b.id = scan_runs.brand_id and (b.visibility = 'public' or b.owner_id = auth.uid())
  )
);

create policy "Owners insert scan runs"
on public.scan_runs for insert
with check (
  exists (
    select 1 from public.brands b
    where b.id = scan_runs.brand_id and b.owner_id = auth.uid()
  )
);

create policy "Public score snapshots"
on public.score_snapshots for select
using (
  exists (
    select 1 from public.brands b
    where b.id = score_snapshots.brand_id and (b.visibility = 'public' or b.owner_id = auth.uid())
  )
);

create policy "Owners read query results"
on public.query_results for select
using (
  exists (
    select 1
    from public.scan_runs sr
    join public.brands b on b.id = sr.brand_id
    where sr.id = query_results.scan_run_id
      and (b.visibility = 'public' or b.owner_id = auth.uid())
  )
);

create policy "Owners manage recommendations"
on public.recommendations for all
using (
  exists (
    select 1 from public.brands b
    where b.id = recommendations.brand_id and b.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.brands b
    where b.id = recommendations.brand_id and b.owner_id = auth.uid()
  )
);

create policy "Public recommendations for public brands"
on public.recommendations for select
using (
  exists (
    select 1 from public.brands b
    where b.id = recommendations.brand_id and (b.visibility = 'public' or b.owner_id = auth.uid())
  )
);

create policy "Users manage own subscriptions"
on public.subscriptions for select
using (user_id = auth.uid());

create policy "Users read own usage"
on public.usage_ledger for select
using (user_id = auth.uid());

create policy "Users manage own alerts"
on public.alerts for all
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- free_scan_requests, webhook_events, app_settings: service role only (no public policies)
