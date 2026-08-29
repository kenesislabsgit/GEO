-- Keep every saved answer attached to the frozen question owned by its audit.
-- Brand-level tracked prompts may be replaced by later audits.
alter table query_results
  add column if not exists question_position integer;

-- Recover positions from the frozen input where the original prompt id is
-- still present.
with frozen as (
  select
    s.id as scan_run_id,
    item.ordinality::integer as position,
    item.value ->> 'id' as tracked_prompt_id
  from scan_runs s
  cross join lateral jsonb_array_elements(
    case
      when jsonb_typeof(s.input_snapshot -> 'prompts') = 'array'
        then s.input_snapshot -> 'prompts'
      else '[]'::jsonb
    end
  ) with ordinality as item(value, ordinality)
)
update query_results r
set question_position = frozen.position
from frozen
where r.scan_run_id = frozen.scan_run_id
  and r.tracked_prompt_id::text = frozen.tracked_prompt_id
  and r.question_position is null;

-- Generated questions are not always present in the original input. Match
-- those through the saved prompt text while the prompt row still exists.
update query_results r
set question_position = sq.position
from tracked_prompts p, scan_questions sq
where r.tracked_prompt_id = p.id
  and sq.scan_run_id = r.scan_run_id
  and lower(btrim(sq.prompt)) = lower(btrim(p.prompt))
  and r.question_position is null;

-- Old audits may have lost their tracked prompt row. Answers were inserted in
-- question order for each provider, so recover the remaining position from
-- that stable order.
with question_counts as (
  select scan_run_id, count(*)::integer as count
  from scan_questions
  group by scan_run_id
), ranked as (
  select
    r.id,
    row_number() over (
      partition by r.scan_run_id, r.provider
      order by r.created_at, r.id
    )::integer as ordinal,
    counts.count
  from query_results r
  join question_counts counts on counts.scan_run_id = r.scan_run_id
  where r.question_position is null
)
update query_results r
set question_position = ((ranked.ordinal - 1) % ranked.count) + 1
from ranked
where r.id = ranked.id;

create index if not exists query_results_scan_question_idx
  on query_results (scan_run_id, question_position);
