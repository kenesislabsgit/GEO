import { exec, insertRow, one, q, updateRow } from "@/lib/db/pg";
import type {
  Alert,
  Brand,
  Competitor,
  QueryResult,
  Recommendation,
  ScanRun,
  ScoreSnapshot,
  Subscription,
  TrackedPrompt,
  UsageLedgerEntry,
  WebhookEvent,
} from "@/types/database";
import type { OnboardingState, BrandMonitoringSettings } from "@/types/onboarding";
import type { PlanId } from "@/lib/billing/entitlements";

/**
 * The single door between the app and its data. Every function here is one
 * or two SQL statements against the Postgres in DATABASE_URL - locally the
 * geo_dev database, in production RDS. Accounts live in the same database
 * under Better Auth's "user" table, which is why owner ids are text.
 */

/**
 * The most recent brand record for a website, whoever created it.
 * Several people may each have their own record for the same website, so this is
 * only for public/display lookups - never to decide what a signed-in user may do.
 */
export async function getBrandByDomain(domain: string): Promise<Brand | null> {
  return one<Brand>(
    `select * from brands where canonical_domain = $1 order by created_at desc limit 1`,
    [domain],
  );
}

/** The record this specific person has for a website, if any. */
export async function getBrandByDomainForOwner(
  domain: string,
  ownerId: string,
): Promise<Brand | null> {
  return one<Brand>(
    `select * from brands where canonical_domain = $1 and owner_id = $2 limit 1`,
    [domain, ownerId],
  );
}

/** Report links must stay unique even when several people audit one website. */
function escapeLike(value: string): string {
  return value.replace(/([%_\\])/g, "\\$1");
}

async function findAvailableSlug(base: string): Promise<string> {
  const rows = await q<{ slug: string }>(
    `select slug from brands where slug like $1 escape '\\'`,
    [`${escapeLike(base)}%`],
  );
  const taken = new Set(rows.map((r) => r.slug));
  if (!taken.has(base)) return base;
  for (let suffix = 2; suffix < 500; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export async function getBrandBySlug(slug: string): Promise<Brand | null> {
  return one<Brand>(`select * from brands where slug = $1`, [slug]);
}

export async function getBrandById(id: string): Promise<Brand | null> {
  return one<Brand>(`select * from brands where id = $1`, [id]);
}

export async function upsertBrand(
  brand: Omit<Brand, "id" | "created_at" | "updated_at"> & { id?: string },
): Promise<Brand> {
  // Update in place only when this is the same person's record for the website.
  // Anonymous audits always insert, so simultaneous visitors stay separate.
  const existing = brand.id
    ? await getBrandById(brand.id)
    : brand.owner_id
      ? await getBrandByDomainForOwner(brand.canonical_domain, brand.owner_id)
      : null;

  const { id: _brandId, ...fields } = brand;
  void _brandId;

  if (existing) {
    const updated = await updateRow<Brand>("brands", existing.id, {
      ...fields,
      // Keep the link this report is already published under.
      slug: existing.slug,
    });
    if (!updated) throw new Error("Brand update returned nothing.");
    return updated;
  }

  // The slug column's unique constraint is the truth; the availability scan
  // above is only a first guess. Two concurrent inserts can pick the same
  // slug, so a unique violation retries with a fresh random suffix instead
  // of failing the audit that raced second.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await insertRow<Brand>("brands", {
        ...fields,
        slug:
          attempt === 0
            ? await findAvailableSlug(brand.slug)
            : `${brand.slug}-${Math.random().toString(36).slice(2, 8)}`,
      });
    } catch (error) {
      const code = (error as { code?: string }).code;
      const constraint = (error as { constraint?: string }).constraint ?? "";
      if (code === "23505" && constraint.includes("slug")) continue;
      throw error;
    }
  }
  throw new Error("Could not allocate a unique report link.");
}

export async function createScanRun(
  run: Omit<ScanRun, "id" | "created_at"> & { id?: string },
): Promise<ScanRun> {
  return insertRow<ScanRun>("scan_runs", run);
}

export async function updateScanRun(
  id: string,
  patch: Partial<ScanRun>,
): Promise<ScanRun | null> {
  return updateRow<ScanRun>("scan_runs", id, patch);
}

export async function getScanRun(id: string): Promise<ScanRun | null> {
  return one<ScanRun>(`select * from scan_runs where id = $1`, [id]);
}

export async function listScansForBrands(
  brandIds: string[],
): Promise<ScanRun[]> {
  if (brandIds.length === 0) return [];
  return q<ScanRun>(
    `select * from scan_runs where brand_id = any($1::uuid[]) order by created_at desc`,
    [brandIds],
  );
}

/**
 * Latest finished audit for one brand record. Pass a max age only when you need
 * "was this audited recently"; leave it out to always get the newest report.
 */
export async function getLatestScanForBrand(
  brandId: string,
  maxAgeDays: number | null = null,
) {
  const brand = await getBrandById(brandId);
  if (!brand) return null;
  const params: unknown[] = [brand.id];
  let ageFilter = "";
  if (maxAgeDays !== null) {
    params.push(
      new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString(),
    );
    ageFilter = `and created_at >= $2`;
  }
  const scan = await one<ScanRun>(
    `select * from scan_runs
     where brand_id = $1 and status in ('completed', 'partial') ${ageFilter}
     order by created_at desc limit 1`,
    params,
  );
  if (!scan) return null;
  const score = await one<ScoreSnapshot>(
    `select * from score_snapshots where scan_run_id = $1`,
    [scan.id],
  );
  return { brand, scan, score };
}

export async function replacePrompts(
  brandId: string,
  prompts: Array<Omit<TrackedPrompt, "id" | "created_at" | "brand_id">>,
): Promise<TrackedPrompt[]> {
  await exec(
    `delete from tracked_prompts where brand_id = $1 and is_custom = false`,
    [brandId],
  );
  const stored: TrackedPrompt[] = [];
  for (const prompt of prompts) {
    stored.push(
      await insertRow<TrackedPrompt>("tracked_prompts", {
        ...prompt,
        brand_id: brandId,
      }),
    );
  }
  return stored;
}

export async function getPrompts(brandId: string): Promise<TrackedPrompt[]> {
  return q<TrackedPrompt>(
    `select * from tracked_prompts where brand_id = $1 and active = true`,
    [brandId],
  );
}

export async function listAllPrompts(brandId: string): Promise<TrackedPrompt[]> {
  return q<TrackedPrompt>(
    `select * from tracked_prompts where brand_id = $1 order by created_at desc`,
    [brandId],
  );
}

export async function getTrackedPromptById(
  id: string,
): Promise<TrackedPrompt | null> {
  return one<TrackedPrompt>(`select * from tracked_prompts where id = $1`, [id]);
}

export async function createTrackedPrompt(
  row: Omit<TrackedPrompt, "id" | "created_at">,
): Promise<TrackedPrompt> {
  return insertRow<TrackedPrompt>("tracked_prompts", row);
}

export async function updateTrackedPrompt(
  id: string,
  patch: Partial<TrackedPrompt>,
): Promise<TrackedPrompt | null> {
  return updateRow<TrackedPrompt>("tracked_prompts", id, patch);
}

export async function deleteTrackedPrompt(id: string): Promise<boolean> {
  await exec(`delete from tracked_prompts where id = $1`, [id]);
  return true;
}

export async function updateBrand(
  id: string,
  patch: Partial<Brand>,
): Promise<Brand | null> {
  return updateRow<Brand>("brands", id, patch);
}

// What look like their own tables are rows in app_settings, whole state as
// one JSON value. See docs/DATABASE.md before writing a migration for these.
function onboardingSettingsKey(userId: string): string {
  return `user_onboarding:${userId}`;
}

async function getSetting<T>(key: string): Promise<T | null> {
  const row = await one<{ value: T }>(
    `select value from app_settings where key = $1`,
    [key],
  );
  return row?.value ?? null;
}

async function putSetting(key: string, value: unknown): Promise<void> {
  await exec(
    `insert into app_settings (key, value, updated_at)
     values ($1, $2, timezone('utc', now()))
     on conflict (key) do update
       set value = excluded.value, updated_at = excluded.updated_at`,
    [key, JSON.stringify(value)],
  );
}

export async function getUserOnboarding(
  userId: string,
): Promise<OnboardingState | null> {
  return getSetting<OnboardingState>(onboardingSettingsKey(userId));
}

export async function upsertUserOnboarding(
  userId: string,
  state: OnboardingState,
): Promise<OnboardingState> {
  const next = { ...state, updatedAt: new Date().toISOString() };
  await putSetting(onboardingSettingsKey(userId), next);
  return next;
}

/** Monitoring settings live in brand_monitoring (0002); they cascade with
 * the brand and the scheduler can join them. */
export async function getBrandMonitoringSettings(
  brandId: string,
): Promise<BrandMonitoringSettings | null> {
  const row = await one<{
    frequency: "daily" | "weekly";
    alerts: BrandMonitoringSettings["alerts"];
    providers: BrandMonitoringSettings["providers"];
    country: string | null;
    language: string | null;
    enabled: boolean;
    day_of_week: number;
    hour_local: number;
    timezone: string;
    updated_at: string;
  }>(`select * from brand_monitoring where brand_id = $1`, [brandId]);
  if (!row) return null;
  return {
    monitoringFrequency: row.frequency,
    alerts: row.alerts ?? {},
    providers: row.providers ?? [],
    country: row.country ?? "US",
    language: row.language ?? "en",
    enabled: row.enabled,
    dayOfWeek: row.day_of_week,
    hourLocal: row.hour_local,
    timezone: row.timezone,
    updatedAt: row.updated_at,
  };
}

export async function upsertBrandMonitoringSettings(
  brandId: string,
  settings: Partial<BrandMonitoringSettings> &
    Pick<BrandMonitoringSettings, "monitoringFrequency" | "alerts" | "providers">,
): Promise<BrandMonitoringSettings> {
  await exec(
    `insert into brand_monitoring
       (brand_id, enabled, frequency, day_of_week, hour_local, timezone,
        providers, country, language, alerts)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     on conflict (brand_id) do update set
       enabled = excluded.enabled,
       frequency = excluded.frequency,
       day_of_week = excluded.day_of_week,
       hour_local = excluded.hour_local,
       timezone = excluded.timezone,
       providers = excluded.providers,
       country = excluded.country,
       language = excluded.language,
       alerts = excluded.alerts`,
    [
      brandId,
      settings.enabled ?? true,
      settings.monitoringFrequency,
      settings.dayOfWeek ?? 0,
      settings.hourLocal ?? 9,
      settings.timezone ?? "UTC",
      JSON.stringify(settings.providers ?? []),
      settings.country ?? null,
      settings.language ?? null,
      JSON.stringify(settings.alerts ?? {}),
    ],
  );
  const stored = await getBrandMonitoringSettings(brandId);
  if (!stored) throw new Error("Monitoring settings upsert returned nothing.");
  return stored;
}

export async function insertQueryResult(
  row: Omit<QueryResult, "id" | "created_at">,
): Promise<QueryResult> {
  return insertRow<QueryResult>("query_results", row);
}

export async function getQueryResults(scanRunId: string): Promise<QueryResult[]> {
  return q<QueryResult>(
    `select * from query_results where scan_run_id = $1`,
    [scanRunId],
  );
}

export async function upsertScore(
  row: Omit<ScoreSnapshot, "id" | "created_at">,
): Promise<ScoreSnapshot> {
  const { brand_id, scan_run_id, ...rest } = row;
  const keys = Object.keys(rest);
  const cols = ["brand_id", "scan_run_id", ...keys];
  const placeholders = cols.map((_, i) => `$${i + 1}`);
  const updates = keys.map((k) => `${k} = excluded.${k}`);
  const values = [brand_id, scan_run_id, ...Object.values(rest)].map((v) =>
    v !== null && typeof v === "object" ? JSON.stringify(v) : v,
  );
  const stored = await one<ScoreSnapshot>(
    `insert into score_snapshots (${cols.join(", ")})
     values (${placeholders.join(", ")})
     on conflict (scan_run_id) do update set ${updates.join(", ")}
     returning *`,
    values,
  );
  if (!stored) throw new Error("Score upsert returned nothing.");
  return stored;
}

export async function getScoreForScan(scanRunId: string) {
  return one<ScoreSnapshot>(
    `select * from score_snapshots where scan_run_id = $1`,
    [scanRunId],
  );
}

export async function replaceRecommendations(
  brandId: string,
  scanRunId: string,
  rows: Array<
    Omit<
      Recommendation,
      "id" | "created_at" | "brand_id" | "scan_run_id" | "completed_at"
    >
  >,
) {
  await exec(`delete from recommendations where scan_run_id = $1`, [scanRunId]);
  const stored: Recommendation[] = [];
  for (const row of rows) {
    stored.push(
      await insertRow<Recommendation>("recommendations", {
        ...row,
        brand_id: brandId,
        scan_run_id: scanRunId,
      }),
    );
  }
  return stored;
}

export async function getRecommendations(brandId: string) {
  return q<Recommendation>(
    `select * from recommendations where brand_id = $1 order by priority asc`,
    [brandId],
  );
}

export async function getRecommendationsForScan(scanRunId: string) {
  return q<Recommendation>(
    `select * from recommendations where scan_run_id = $1 order by priority asc`,
    [scanRunId],
  );
}

export async function recordFreeScan(row: {
  domain: string;
  normalized_domain: string;
  ip_hash: string | null;
  scan_run_id: string | null;
}) {
  return insertRow("free_scan_requests", row);
}

export async function replaceCompetitors(
  brandId: string,
  rows: Array<Omit<Competitor, "id" | "created_at" | "brand_id">>,
) {
  // Discovered competitors are replaced by each audit; ones the user added
  // by hand survive it, the same way custom prompts do.
  await exec(
    `delete from competitors where brand_id = $1 and is_custom = false`,
    [brandId],
  );
  const kept = await q<Competitor>(
    `select * from competitors where brand_id = $1`,
    [brandId],
  );
  const keptNames = new Set(kept.map((row) => row.name.toLowerCase()));
  const stored: Competitor[] = [...kept];
  for (const row of rows) {
    if (keptNames.has(row.name.toLowerCase())) continue;
    stored.push(
      await insertRow<Competitor>("competitors", { ...row, brand_id: brandId }),
    );
  }
  return stored;
}

export async function getCompetitors(brandId: string) {
  return q<Competitor>(`select * from competitors where brand_id = $1`, [
    brandId,
  ]);
}

export async function addUsage(
  row: Omit<UsageLedgerEntry, "id" | "created_at">,
) {
  await insertRow("usage_ledger", row);
}

export async function sumUsage(userId: string, billingPeriod: string) {
  const row = await one<{ total: number }>(
    `select coalesce(sum(units), 0)::int as total
     from usage_ledger where user_id = $1 and billing_period = $2`,
    [userId, billingPeriod],
  );
  return row?.total ?? 0;
}

export async function getSubscription(userId: string): Promise<Subscription | null> {
  return one<Subscription>(
    `select * from subscriptions
     where user_id = $1 and status in ('active', 'trialing')
     order by created_at desc limit 1`,
    [userId],
  );
}

/**
 * The newest subscription row whatever its status. Billing screens and the
 * customer portal need to see a past_due or canceled subscription - hiding
 * it (as getSubscription does for entitlement checks) would lock people out
 * of the portal exactly when they need it to fix a failed payment.
 */
export async function getLatestSubscription(
  userId: string,
): Promise<Subscription | null> {
  return one<Subscription>(
    `select * from subscriptions
     where user_id = $1
     order by created_at desc limit 1`,
    [userId],
  );
}

export async function upsertSubscription(
  row: Omit<Subscription, "id" | "created_at" | "updated_at"> & { id?: string },
) {
  // A payment provider retries webhooks, so the same subscription arrives more
  // than once: match on the provider's id first, then on the user's live
  // subscription, and only insert when neither exists.
  const existing = row.provider_subscription_id
    ? await one<Subscription>(
        `select * from subscriptions where provider_subscription_id = $1`,
        [row.provider_subscription_id],
      )
    : null;
  const target =
    existing ??
    (await one<Subscription>(
      `select * from subscriptions
       where user_id = $1 and status in ('active', 'trialing')
       order by created_at desc limit 1`,
      [row.user_id],
    ));
  if (target) {
    const { id: _rowId, ...fields } = row;
    void _rowId;
    const updated = await updateRow<Subscription>("subscriptions", target.id, fields);
    if (!updated) throw new Error("Subscription update returned nothing.");
    return updated;
  }
  return insertRow<Subscription>("subscriptions", row);
}

export async function createAlert(
  row: Omit<Alert, "id" | "created_at" | "read_at" | "emailed_at">,
) {
  return insertRow<Alert>("alerts", row);
}

export async function listAlerts(userId: string) {
  return q<Alert>(
    `select * from alerts where user_id = $1 order by created_at desc`,
    [userId],
  );
}

export async function countUnreadAlerts(userId: string): Promise<number> {
  const row = await one<{ n: number }>(
    `select count(*)::int as n from alerts where user_id = $1 and read_at is null`,
    [userId],
  );
  return row?.n ?? 0;
}

/** Scoped to the owner so nobody can mark another person's alert. */
export async function markAlertRead(
  userId: string,
  alertId: string,
): Promise<boolean> {
  const touched = await exec(
    `update alerts set read_at = timezone('utc', now())
     where id = $1 and user_id = $2 and read_at is null`,
    [alertId, userId],
  );
  return touched > 0;
}

export async function markAllAlertsRead(userId: string): Promise<number> {
  return exec(
    `update alerts set read_at = timezone('utc', now())
     where user_id = $1 and read_at is null`,
    [userId],
  );
}

/**
 * Record a webhook event once. Returns whether this call inserted it and,
 * when it already existed, its processing status - so a retry of a FAILED
 * event gets reprocessed while a retry of a processed one is a no-op.
 */
export async function recordWebhookEvent(
  row: Omit<WebhookEvent, "id" | "processed_at">,
): Promise<{ inserted: boolean; existingStatus: string | null }> {
  const stored = await one<{ status: string; inserted: boolean }>(
    `insert into webhook_events (provider, event_id, event_type, payload, status)
     values ($1, $2, $3, $4, 'processed')
     on conflict (provider, event_id) do update set event_type = webhook_events.event_type
     returning status, (xmax = 0) as inserted`,
    [row.provider, row.event_id, row.event_type, JSON.stringify(row.payload)],
  );
  return {
    inserted: Boolean(stored?.inserted),
    existingStatus: stored?.inserted ? null : (stored?.status ?? null),
  };
}

/** Mark a recorded webhook event's outcome; error text is for operators. */
export async function setWebhookEventStatus(
  provider: string,
  eventId: string,
  status: "processed" | "failed" | "skipped",
  error?: string | null,
) {
  await exec(
    `update webhook_events set status = $3, error = $4
     where provider = $1 and event_id = $2`,
    [provider, eventId, status, error ?? null],
  );
}

/**
 * Ownership transfer lives in lib/claims/verification.ts now: it requires a
 * verified domain proof and does the transfer atomically. The old click-to-
 * claim helpers were removed with the unverified claim flow.
 */

export async function listBrandsForOwner(ownerId: string) {
  return q<Brand>(
    `select * from brands where owner_id = $1 order by created_at desc`,
    [ownerId],
  );
}

export async function getLatestCompletedScanForBrand(
  brandId: string,
): Promise<ScanRun | null> {
  return one<ScanRun>(
    `select * from scan_runs
     where brand_id = $1 and status in ('completed', 'partial')
     order by completed_at desc nulls last limit 1`,
    [brandId],
  );
}

export async function getActiveScanForBrand(
  brandId: string,
): Promise<ScanRun | null> {
  return one<ScanRun>(
    `select * from scan_runs
     where brand_id = $1 and status in ('queued', 'running')
     order by created_at desc limit 1`,
    [brandId],
  );
}

export async function getRecommendationById(
  id: string,
): Promise<Recommendation | null> {
  return one<Recommendation>(`select * from recommendations where id = $1`, [id]);
}

export async function updateRecommendationStatus(
  id: string,
  status: Recommendation["status"],
  completedAt: string | null,
): Promise<Recommendation | null> {
  return updateRow<Recommendation>("recommendations", id, {
    status,
    completed_at: completedAt,
  });
}

export async function addCompetitor(
  brandId: string,
  row: { name: string; domain: string | null },
): Promise<Competitor> {
  return insertRow<Competitor>("competitors", {
    ...row,
    brand_id: brandId,
    aliases: [],
    is_custom: true,
  });
}

export async function removeCompetitor(
  brandId: string,
  competitorId: string,
): Promise<boolean> {
  const removed = await exec(
    `delete from competitors where id = $1 and brand_id = $2`,
    [competitorId, brandId],
  );
  return removed > 0;
}

export async function getUserEmail(userId: string): Promise<string | null> {
  // Better Auth owns the "user" table; we only ever read from it.
  const row = await one<{ email: string }>(
    `select email from "user" where id = $1`,
    [userId],
  );
  return row?.email ?? null;
}

export type MonitorableBrandCandidate = {
  brandId: string;
  ownerId: string;
  plan: PlanId;
  email: string;
  settings: BrandMonitoringSettings;
};

export async function listMonitorableBrandCandidates(): Promise<
  MonitorableBrandCandidate[]
> {
  const brands = await q<{ id: string; owner_id: string }>(
    `select id, owner_id from brands where owner_id is not null`,
  );
  const results: MonitorableBrandCandidate[] = [];
  for (const brand of brands) {
    const settings = await getBrandMonitoringSettings(brand.id);
    if (!settings) continue;
    const sub = await getSubscription(brand.owner_id);
    if (!sub || (sub.status !== "active" && sub.status !== "trialing")) {
      continue;
    }
    const email = await getUserEmail(brand.owner_id);
    if (!email) continue;
    results.push({
      brandId: brand.id,
      ownerId: brand.owner_id,
      plan: sub.plan,
      email,
      settings,
    });
  }
  return results;
}

export async function scoresForBrand(brandId: string) {
  return q<ScoreSnapshot>(
    `select * from score_snapshots where brand_id = $1 order by created_at desc`,
    [brandId],
  );
}

export async function adminStats() {
  const today = new Date().toISOString().slice(0, 10);
  const [counts, queue, usage, webhookFailures, recentLog] = await Promise.all([
    one<{
      users: number;
      brands: number;
      subs: number;
      scans_today: number;
      free_scans: number;
    }>(
      `select
         (select count(*)::int from "user") as users,
         (select count(*)::int from brands) as brands,
         (select count(*)::int from subscriptions where status in ('active', 'trialing')) as subs,
         (select count(*)::int from scan_runs where created_at >= $1) as scans_today,
         (select count(*)::int from free_scan_requests) as free_scans`,
      [`${today}T00:00:00.000Z`],
    ),
    one<{
      queued: number;
      running: number;
      failed: number;
      cancelled: number;
      timed_out: number;
      completed: number;
      stale: number;
      worker_seen: boolean;
      cost: number;
    }>(
      `select
         count(*) filter (where status = 'queued')::int as queued,
         count(*) filter (where status in ('running', 'cancel_requested'))::int as running,
         count(*) filter (where status = 'failed')::int as failed,
         count(*) filter (where status = 'cancelled')::int as cancelled,
         count(*) filter (where status = 'timed_out')::int as timed_out,
         count(*) filter (where status in ('completed', 'partial'))::int as completed,
         count(*) filter (where status in ('running', 'cancel_requested')
           and heartbeat_at < timezone('utc', now()) - interval '3 minutes')::int as stale,
         bool_or(heartbeat_at > timezone('utc', now()) - interval '10 minutes') as worker_seen,
         coalesce(sum(estimated_cost_usd), 0)::float as cost
       from scan_runs`,
    ),
    q<{ provider: string | null; units: number; cost: number }>(
      `select provider, coalesce(sum(units), 0)::int as units,
              coalesce(sum(estimated_cost), 0)::float as cost
       from usage_ledger group by provider`,
    ),
    q<{ event_id: string; event_type: string; error: string | null; processed_at: string }>(
      `select event_id, event_type, error, processed_at
       from webhook_events where status = 'failed'
       order by processed_at desc limit 10`,
    ),
    q<{ admin_email: string; action: string; target: string | null; created_at: string }>(
      `select admin_email, action, target, created_at
       from admin_audit_log order by created_at desc limit 15`,
    ),
  ]);

  const providerUsage: Record<string, number> = {};
  let estimatedCost = 0;
  for (const row of usage) {
    providerUsage[row.provider ?? "unknown"] = row.units;
    estimatedCost += row.cost;
  }

  return {
    users: counts?.users ?? 0,
    brands: counts?.brands ?? 0,
    activeSubscriptions: counts?.subs ?? 0,
    scansToday: counts?.scans_today ?? 0,
    freeScanCount: counts?.free_scans ?? 0,
    queue: {
      queued: queue?.queued ?? 0,
      running: queue?.running ?? 0,
      failed: queue?.failed ?? 0,
      cancelled: queue?.cancelled ?? 0,
      timedOut: queue?.timed_out ?? 0,
      completed: queue?.completed ?? 0,
      stale: queue?.stale ?? 0,
      workerSeenRecently: Boolean(queue?.worker_seen),
    },
    providerUsage,
    estimatedCost,
    scanSpendUsd: queue?.cost ?? 0,
    webhookFailures,
    recentAdminActions: recentLog,
  };
}

export async function adminRecentScans(limit = 25) {
  return q<{
    id: string;
    status: string;
    scan_type: string;
    trigger_source: string | null;
    brand_name: string;
    attempts: number;
    error_summary: string | null;
    created_at: string;
  }>(
    `select s.id, s.status, s.scan_type, s.trigger_source, b.name as brand_name,
            s.attempts, s.error_summary, s.created_at
     from scan_runs s join brands b on b.id = s.brand_id
     order by s.created_at desc limit $1`,
    [limit],
  );
}

/**
 * Account-level series for the dashboard overview: per-scan provider answer
 * counts for the stacked bars, and every score snapshot for the trend lines.
 */
export async function accountOverviewSeries(ownerId: string): Promise<{
  scans: Array<{
    scan_id: string;
    created_at: string;
    brand_name: string;
    provider: string;
    answers: number;
    mentioned: number;
  }>;
  snapshots: Array<{
    created_at: string;
    overall_score: number;
    mention_rate: number;
  }>;
}> {
  const scans = await q<{
    scan_id: string;
    created_at: string;
    brand_name: string;
    provider: string;
    answers: number;
    mentioned: number;
  }>(
    `select s.id as scan_id, s.created_at::text as created_at, b.name as brand_name,
            r.provider, count(*)::int as answers,
            count(*) filter (where r.brand_mentioned)::int as mentioned
     from scan_runs s
     join brands b on b.id = s.brand_id
     join query_results r on r.scan_run_id = s.id
     where b.owner_id = $1 and s.status in ('completed', 'partial')
       and s.id in (
         select s2.id from scan_runs s2
         join brands b2 on b2.id = s2.brand_id
         where b2.owner_id = $1 and s2.status in ('completed', 'partial')
         order by s2.created_at desc limit 14
       )
     group by s.id, s.created_at, b.name, r.provider
     order by s.created_at`,
    [ownerId],
  );
  const snapshots = await q<{
    created_at: string;
    overall_score: number;
    mention_rate: number;
  }>(
    `select sc.created_at::text as created_at,
            sc.overall_score::float as overall_score,
            sc.mention_rate::float as mention_rate
     from score_snapshots sc
     join brands b on b.id = sc.brand_id
     where b.owner_id = $1
     order by sc.created_at
     limit 90`,
    [ownerId],
  );
  return { scans, snapshots };
}
