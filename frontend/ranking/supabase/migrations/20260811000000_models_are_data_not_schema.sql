-- Two fixes, both found by comparing a real audit against this schema.

-- 1. The database was policing which AI models exist.
--
-- query_results.provider and usage_ledger.provider allowed exactly three
-- names: openai, gemini, perplexity. Every audit since has written four other
-- names — openai_search, bedrock_claude, bedrock_llama, bedrock_mistral — and
-- a checked run stored 80 answers under those names. Against this schema all
-- 80 inserts would have been rejected and the audit lost after it had been
-- paid for and run.
--
-- The rule is dropped rather than extended. Which models we ask is a product
-- decision that changes often, and adding one already needs code that knows
-- how to call it and read its reply; a list here adds a migration to that work
-- and buys nothing, because the code has its own list and the database cannot
-- tell a real new model from a typo anyway. Names are free text from here.
alter table public.query_results
  drop constraint if exists query_results_provider_check;

alter table public.usage_ledger
  drop constraint if exists usage_ledger_provider_check;

-- 2. Where an audit has got to, so it does not have to hold a connection open.
--
-- The runner reports its progress down the same HTTP request that started it,
-- which means a browser reload, a deploy, or a request timeout loses the run
-- from the customer's side even though it is still going. Recording the step
-- on the row lets the page ask "where is it?" instead of holding a wire open
-- for four minutes, which is what has to happen before this can run on a
-- worker rather than inside the web server.
--
-- step is the runner's own name for what it is doing, not what the customer is
-- shown: the wording lives in lib/audit/progress-copy.ts so it can change
-- without a migration.
alter table public.scan_runs
  add column if not exists step text;

alter table public.scan_runs
  add column if not exists progress integer not null default 0;
