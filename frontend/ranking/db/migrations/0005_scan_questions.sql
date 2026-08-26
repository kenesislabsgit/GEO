-- Keep the exact question set with the audit that asked it. Brand-level
-- prompts can change later; audit history must not.
create table if not exists scan_questions (
  id uuid primary key default gen_random_uuid(),
  scan_run_id uuid not null references scan_runs (id) on delete cascade,
  position integer not null check (position > 0),
  prompt text not null check (length(trim(prompt)) > 0),
  source text not null check (source in ('generated', 'user', 'reused', 'recovered')),
  source_scan_run_id uuid references scan_runs (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (scan_run_id, position)
);

create index if not exists scan_questions_scan_run_id_idx
  on scan_questions (scan_run_id, position);

-- Most repeat audits already froze their supplied questions in the queued
-- input. Recover those so existing audit choices appear immediately.
insert into scan_questions (
  scan_run_id, position, prompt, source, source_scan_run_id
)
select
  s.id,
  item.ordinality::integer,
  trim(item.value ->> 'prompt'),
  'recovered',
  null
from scan_runs s
cross join lateral jsonb_array_elements(
  case
    when jsonb_typeof(s.input_snapshot -> 'prompts') = 'array'
      then s.input_snapshot -> 'prompts'
    else '[]'::jsonb
  end
) with ordinality as item(value, ordinality)
where length(trim(coalesce(item.value ->> 'prompt', ''))) > 0
on conflict (scan_run_id, position) do nothing;

-- Older runs may predate the frozen input. Recover what is still linked to
-- their answers. The new table prevents future prompt edits from affecting it.
with linked as (
  select
    r.scan_run_id,
    p.prompt,
    min(r.created_at) as first_seen
  from query_results r
  join tracked_prompts p on p.id = r.tracked_prompt_id
  where not exists (
    select 1 from scan_questions sq where sq.scan_run_id = r.scan_run_id
  )
  group by r.scan_run_id, p.id, p.prompt
), numbered as (
  select
    scan_run_id,
    row_number() over (partition by scan_run_id order by first_seen, prompt)::integer as position,
    prompt
  from linked
)
insert into scan_questions (
  scan_run_id, position, prompt, source, source_scan_run_id
)
select scan_run_id, position, prompt, 'recovered', null
from numbered
on conflict (scan_run_id, position) do nothing;
