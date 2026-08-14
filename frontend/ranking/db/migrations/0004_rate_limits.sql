-- Distributed rate limiting in the database every instance already shares.
-- Unlogged: counters are not worth WAL; losing them on a crash just resets
-- the window.

create unlogged table rate_limits (
  key text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (key, window_start)
);
