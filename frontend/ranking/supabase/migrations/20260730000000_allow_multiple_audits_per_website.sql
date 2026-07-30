-- Several people may audit the same website.
--
-- Before: one brand row per domain, globally. Whoever audited a website first
-- effectively owned it, and everyone else was refused.
--
-- After: one brand row per (account, domain). Each person gets their own record
-- for a website, with their own questions, competitors, audits and reports.
-- Anonymous audits (owner_id is null) each get their own row too, so two
-- visitors auditing the same website at the same time never overwrite each
-- other. Report slugs stay globally unique because public links are keyed by them.

drop index if exists brands_canonical_domain_idx;

-- One record per website per account.
create unique index if not exists brands_owner_domain_idx
  on public.brands (owner_id, canonical_domain)
  where owner_id is not null;

-- Domain lookups (public report resolution) are still fast, just not unique.
create index if not exists brands_canonical_domain_lookup_idx
  on public.brands (canonical_domain);
