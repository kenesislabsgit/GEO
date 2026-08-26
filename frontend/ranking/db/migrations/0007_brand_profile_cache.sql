-- A weekly monitoring run needs the last trusted profile on every worker.
-- Database storage keeps it available across ECS tasks and deployments;
-- local output folders are not shared or durable in production.
create table if not exists brand_profile_cache (
  brand_id uuid primary key references brands (id) on delete cascade,
  website_snapshot jsonb not null,
  website_evidence jsonb not null,
  company_profile jsonb not null,
  change_analysis jsonb,
  source_scan_run_id uuid references scan_runs (id) on delete set null,
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists brand_profile_cache_updated_idx
  on brand_profile_cache (updated_at desc);
