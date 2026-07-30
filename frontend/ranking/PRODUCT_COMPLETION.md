# RankedByAI Product Completion

**Last updated:** 2026-07-16  
**Status:** Priority 1 complete; security, monitoring, intelligence, exports, and legal pages in progress.

## What currently works

- Anonymous homepage free scan → progress → public report
- Website understanding, prompt generation, scoring, demo-mode providers
- Public report with score, prompt matrix, example answer, teasers, claim CTA
- Local demo auth (signup/signin/signout) + Supabase path when configured
- Brand claiming from public report / claim route
- Dashboard shell (overview, brands, scans history, alerts, billing, settings)
- Dedicated signed-in routes: `/dashboard/scans/new`, `/dashboard/scans/[id]`, `/dashboard/scans`
- Paid onboarding wizard at `/dashboard/onboarding` (resumable, 8 steps, first premium scan)
- Prompt tracking CRUD at `/dashboard/brands/[id]/prompts` with duplicate detection
- Competitor add/remove API + UI (paid plans)
- Manual scan API with plan/provider/usage enforcement
- Scan progress API auth (public free vs owned dashboard scans)
- Action status updates require brand ownership
- Weekly monitoring tick schedules due brand scans (Inngest + inline dev fallback)
- Citations page uses latest completed scan (not free-cache only)
- Brand dashboard premium metrics (share of voice, citation score, next scan)
- CSV exports for Growth/Agency on history page
- Usage warnings at 70/80/100% on dashboard overview
- Legal: privacy, terms, refund, data handling, contact
- Central routes in `lib/routes.ts`
- Unit/integration tests and production build

## What is partially built

- Action centre / competitors / citations show data; competitor compare + history charts incomplete
- Alerts page lists alerts; full email suite + preference centre incomplete
- Monitoring schedule UI (settings page) incomplete; cron tick implemented
- Premium report view (dashboard-native, not only public report)
- Brand accuracy monitoring (detection pipeline partial)
- Team/agency features (config only)
- PDF exports (CSV done; PDF not yet)
- Auth: email verification, password reset, profile management

## What is missing / broken

### Authentication & claiming
- [ ] Email verification
- [ ] Password reset
- [ ] Profile management
- [ ] Ownership dispute workflow (beyond error message)

### Premium dashboard
- [ ] Provider comparison chart on overview
- [ ] Biggest gain/loss widgets
- [ ] Dedicated premium report page

### Question / competitor / citation intelligence
- [x] Full prompt CRUD with duplicate detection
- [x] Competitor add/remove (paid)
- [ ] Competitor compare + visibility history per competitor
- [ ] Citation gap intelligence + history
- [ ] Brand accuracy monitoring UI

### Monitoring, alerts, billing enforcement
- [ ] Configurable schedule UI in settings
- [ ] Scan comparison tool
- [ ] Full email notification suite + preferences
- [x] Usage warnings at 70/80/100%
- [ ] Downgrade pause (not delete) excess items

### Agency / team / exports
- [ ] Team invites & roles
- [ ] White-label branding
- [ ] Bulk import
- [x] CSV exports (Growth/Agency)
- [ ] PDF exports
- [ ] Webhooks management UI

### Admin
- [ ] Interactive admin actions (retry scans, disable accounts)

## What must be tested

1. Anonymous scan from homepage → public report
2. Signed-in free user "Run a scan" stays in dashboard
3. Paid user sees premium scan settings
4. Brand-specific scan preselects brand
5. No unexpected homepage redirects for signed-in users
6. ReturnTo after login and checkout
7. Failed scan retry inside dashboard
8. Premium scan progress not leaked to unauthorised users
9. Plan limits server-side
10. Billing webhooks update subscription status

## Working notes

- Central routes live in `lib/routes.ts` — use them everywhere.
- Public CTAs: `routes.publicScanAnchor`; signed-in CTAs: `routes.newScan()` / `routes.scanProgress()`.
- Run e2e: `pnpm exec playwright install && pnpm test:e2e`
