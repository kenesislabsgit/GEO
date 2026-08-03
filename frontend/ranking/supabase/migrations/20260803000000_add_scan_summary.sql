-- Where the audit leaves this company, in three or four sentences.
--
-- The dashboard's "executive verdict" was a threshold on the mention rate:
-- above 60% read "Frequently recommended", above zero "Sometimes
-- recommended", otherwise "Not currently recommended". Every other block on
-- the page is a count or a ranking, so nothing on screen said what any of it
-- meant. The recommendation step already sees every finding at once and now
-- writes that paragraph in the same call, at no extra cost or latency.
--
-- Nullable on purpose: audits recorded before this column existed keep working
-- and simply have nothing to show here.
alter table public.scan_runs
  add column if not exists summary text;
