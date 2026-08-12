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
 * or two SQL statements against the Postgres in DATABASE_URL — locally the
 * geo_dev database, in production RDS. Accounts live in the same database
 * under Better Auth's "user" table, which is why owner ids are text.
 */

/**
 * The most recent brand record for a website, whoever created it.
 * Several people may each have their own record for the same website, so this is
 * only for public/display lookups — never to decide what a signed-in user may do.
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
async function findAvailableSlug(base: string): Promise<string> {
  const rows = await q<{ slug: string }>(
    `select slug from brands where slug like $1`,
    [`${base}%`],
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

  const { id: _ignored, ...fields } = brand;

  if (existing) {
    const updated = await updateRow<Brand>("brands", existing.id, {
      ...fields,
      // Keep the link this report is already published under.
      slug: existing.slug,
    });
    if (!updated) throw new Error("Brand update returned nothing.");
    return updated;
  }

  return insertRow<Brand>("brands", {
    ...fields,
    slug: await findAvailableSlug(brand.slug),
  });
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

function brandMonitoringSettingsKey(brandId: string): string {
  return `brand_monitoring:${brandId}`;
}

export async function getBrandMonitoringSettings(
  brandId: string,
): Promise<BrandMonitoringSettings | null> {
  return getSetting<BrandMonitoringSettings>(brandMonitoringSettingsKey(brandId));
}

export async function upsertBrandMonitoringSettings(
  brandId: string,
  settings: BrandMonitoringSettings,
): Promise<BrandMonitoringSettings> {
  const next = { ...settings, updatedAt: new Date().toISOString() };
  await putSetting(brandMonitoringSettingsKey(brandId), next);
  return next;
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
  await exec(`delete from competitors where brand_id = $1`, [brandId]);
  const stored: Competitor[] = [];
  for (const row of rows) {
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
    const { id: _ignored, ...fields } = row;
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

export async function recordWebhookEvent(
  row: Omit<WebhookEvent, "id" | "processed_at">,
) {
  const inserted = await exec(
    `insert into webhook_events (provider, event_id, event_type, payload)
     values ($1, $2, $3, $4)
     on conflict (provider, event_id) do nothing`,
    [row.provider, row.event_id, row.event_type, JSON.stringify(row.payload)],
  );
  return { inserted: inserted > 0 };
}

/**
 * Take ownership of a report when nobody owns it. If someone else already owns
 * it, this person gets their own copy of the website record instead of an error,
 * so they can still audit the same website.
 */
export async function claimOrCopyBrand(
  brandId: string,
  ownerId: string,
): Promise<Brand | null> {
  const existing = await getBrandById(brandId);
  if (!existing) return null;
  if (existing.owner_id && existing.owner_id !== ownerId) {
    return copyBrandForOwner(brandId, ownerId);
  }
  return claimBrand(brandId, ownerId);
}

export async function copyBrandForOwner(
  brandId: string,
  ownerId: string,
): Promise<Brand | null> {
  const source = await getBrandById(brandId);
  if (!source) return null;
  const own = await getBrandByDomainForOwner(source.canonical_domain, ownerId);
  if (own) return own;
  const now = new Date().toISOString();
  return upsertBrand({
    owner_id: ownerId,
    name: source.name,
    canonical_domain: source.canonical_domain,
    slug: source.slug,
    logo_url: source.logo_url,
    description: source.description,
    category: source.category,
    target_audience: source.target_audience,
    aliases: source.aliases,
    default_country: source.default_country,
    default_language: source.default_language,
    visibility: source.visibility,
    claimed_at: now,
    metadata_confidence: source.metadata_confidence,
  });
}

export async function claimBrand(brandId: string, ownerId: string) {
  const existing = await getBrandById(brandId);
  if (!existing) return null;
  if (existing.owner_id && existing.owner_id !== ownerId) {
    throw new Error("Brand already claimed by another account.");
  }
  return updateRow<Brand>("brands", brandId, {
    owner_id: ownerId,
    claimed_at: new Date().toISOString(),
  });
}

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
  const [users, brands, subs, scansToday, failed, usage] = await Promise.all([
    one<{ n: number }>(`select count(*)::int as n from "user"`),
    one<{ n: number }>(`select count(*)::int as n from brands`),
    one<{ n: number }>(
      `select count(*)::int as n from subscriptions where status in ('active', 'trialing')`,
    ),
    one<{ n: number }>(
      `select count(*)::int as n from scan_runs where created_at >= $1`,
      [`${today}T00:00:00.000Z`],
    ),
    one<{ n: number }>(
      `select count(*)::int as n from scan_runs where status = 'failed'`,
    ),
    q<{ provider: string | null; units: number; estimated_cost: number }>(
      `select provider, units, estimated_cost from usage_ledger`,
    ),
  ]);

  const providerUsage: Record<string, number> = {};
  let estimatedCost = 0;
  for (const row of usage) {
    const key = row.provider ?? "unknown";
    providerUsage[key] = (providerUsage[key] ?? 0) + Number(row.units || 0);
    estimatedCost += Number(row.estimated_cost || 0);
  }

  return {
    users: users?.n ?? 0,
    brands: brands?.n ?? 0,
    activeSubscriptions: subs?.n ?? 0,
    scansToday: scansToday?.n ?? 0,
    failedScans: failed?.n ?? 0,
    providerUsage,
    estimatedCost,
    freeScanCount: 0,
  };
}
