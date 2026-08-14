-- Competitors a user added by hand must survive the next audit import, which
-- replaces the discovered list wholesale. Same pattern tracked_prompts
-- already uses.

alter table competitors
  add column is_custom boolean not null default false;
