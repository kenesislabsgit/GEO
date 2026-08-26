-- Monitoring must repeat one fixed question set so changes between runs are
-- comparable. Store the question text because audit history is immutable and
-- users may edit their monitoring copy without changing the old audit.
alter table brand_monitoring
  add column if not exists monitoring_questions jsonb not null default '[]'::jsonb;

-- Give existing schedules a safe starting set from their newest finished
-- audit. Users can replace these five questions from the monitoring page.
update brand_monitoring bm
set monitoring_questions = (
  select jsonb_agg(recent.prompt order by recent.position)
  from (
    select sq.prompt, sq.position
    from scan_questions sq
    where sq.scan_run_id = (
      select s.id
      from scan_runs s
      where s.brand_id = bm.brand_id
        and s.status in ('completed', 'partial')
      order by s.created_at desc
      limit 1
    )
    order by sq.position
    limit 5
  ) recent
)
where jsonb_array_length(bm.monitoring_questions) = 0
  and 5 = (
    select count(*)
    from (
      select 1
      from scan_questions sq
      where sq.scan_run_id = (
        select s.id
        from scan_runs s
        where s.brand_id = bm.brand_id
          and s.status in ('completed', 'partial')
        order by s.created_at desc
        limit 1
      )
      limit 5
    ) five_questions
  );
