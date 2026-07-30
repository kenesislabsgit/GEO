import { FREE_SCAN_CACHE_DAYS } from "@/lib/constants";
import { createServiceClient, hasServiceRole } from "@/lib/db/supabase/service";
import * as local from "@/lib/db/local-store";
import type {
  Brand,
  Competitor,
  QueryResult,
  Recommendation,
  ScanRun,
  ScoreSnapshot,
  Subscription,
  TrackedPrompt,
} from "@/types/database";
import type { OnboardingState, BrandMonitoringSettings } from "@/types/onboarding";
import type { PlanId } from "@/lib/billing/entitlements";

export function usingLocalDb(): boolean {
  return !hasServiceRole();
}

/**
 * The most recent brand record for a website, whoever created it.
 * Several people may each have their own record for the same website, so this is
 * only for public/display lookups — never to decide what a signed-in user may do.
 */
export async function getBrandByDomain(domain: string): Promise<Brand | null> {
  if (usingLocalDb()) return local.localGetBrandByDomain(domain);
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("brands")
    .select("*")
    .eq("canonical_domain", domain)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as Brand | null) ?? null;
}

/** The record this specific person has for a website, if any. */
export async function getBrandByDomainForOwner(
  domain: string,
  ownerId: string,
): Promise<Brand | null> {
  if (usingLocalDb()) {
    return local.localGetBrandByDomainForOwner(domain, ownerId);
  }
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("brands")
    .select("*")
    .eq("canonical_domain", domain)
    .eq("owner_id", ownerId)
    .maybeSingle();
  return (data as Brand | null) ?? null;
}

/** Report links must stay unique even when several people audit one website. */
async function findAvailableSlug(base: string): Promise<string> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("brands")
    .select("slug")
    .like("slug", `${base}%`);
  const taken = new Set(((data ?? []) as Array<{ slug: string }>).map((r) => r.slug));
  if (!taken.has(base)) return base;
  for (let suffix = 2; suffix < 500; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export async function getBrandBySlug(slug: string): Promise<Brand | null> {
  if (usingLocalDb()) return local.localGetBrandBySlug(slug);
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("brands")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  return (data as Brand | null) ?? null;
}

export async function getBrandById(id: string): Promise<Brand | null> {
  if (usingLocalDb()) return local.localGetBrandById(id);
  const supabase = createServiceClient();
  const { data } = await supabase.from("brands").select("*").eq("id", id).maybeSingle();
  return (data as Brand | null) ?? null;
}

export async function upsertBrand(
  brand: Omit<Brand, "id" | "created_at" | "updated_at"> & { id?: string },
): Promise<Brand> {
  if (usingLocalDb()) return local.localUpsertBrand(brand);
  const supabase = createServiceClient();
  const now = new Date().toISOString();

  // Update in place only when this is the same person's record for the website.
  // Anonymous audits always insert, so simultaneous visitors stay separate.
  const existing = brand.id
    ? await getBrandById(brand.id)
    : brand.owner_id
      ? await getBrandByDomainForOwner(brand.canonical_domain, brand.owner_id)
      : null;

  if (existing) {
    const { data, error } = await supabase
      .from("brands")
      .update({
        ...brand,
        id: existing.id,
        // Keep the link this report is already published under.
        slug: existing.slug,
        updated_at: now,
      })
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error) throw error;
    return data as Brand;
  }

  const { data, error } = await supabase
    .from("brands")
    .insert({
      ...brand,
      slug: await findAvailableSlug(brand.slug),
      updated_at: now,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as Brand;
}

export async function createScanRun(
  run: Omit<ScanRun, "id" | "created_at"> & { id?: string },
): Promise<ScanRun> {
  if (usingLocalDb()) return local.localCreateScanRun(run);
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("scan_runs")
    .insert(run)
    .select("*")
    .single();
  if (error) throw error;
  return data as ScanRun;
}

export async function updateScanRun(
  id: string,
  patch: Partial<ScanRun>,
): Promise<ScanRun | null> {
  if (usingLocalDb()) return local.localUpdateScanRun(id, patch);
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("scan_runs")
    .update(patch)
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return (data as ScanRun | null) ?? null;
}

export async function getScanRun(id: string): Promise<ScanRun | null> {
  if (usingLocalDb()) return local.localGetScanRun(id);
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("scan_runs")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return (data as ScanRun | null) ?? null;
}

export async function listScansForBrands(
  brandIds: string[],
): Promise<ScanRun[]> {
  if (brandIds.length === 0) return [];
  if (usingLocalDb()) return local.localListScansForBrands(brandIds);
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("scan_runs")
    .select("*")
    .in("brand_id", brandIds)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as ScanRun[]) ?? [];
}

/**
 * Latest finished audit for one brand record. Pass a max age only when you need
 * "was this audited recently"; leave it out to always get the newest report.
 */
export async function getLatestScanForBrand(
  brandId: string,
  maxAgeDays: number | null = null,
) {
  if (usingLocalDb()) {
    return local.localLatestCompletedScanForBrand(brandId, maxAgeDays);
  }
  const supabase = createServiceClient();
  const brand = await getBrandById(brandId);
  if (!brand) return null;
  let query = supabase
    .from("scan_runs")
    .select("*")
    .eq("brand_id", brand.id)
    .in("status", ["completed", "partial"]);
  if (maxAgeDays !== null) {
    query = query.gte(
      "created_at",
      new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString(),
    );
  }
  const { data: scan } = await query
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!scan) return null;
  const { data: score } = await supabase
    .from("score_snapshots")
    .select("*")
    .eq("scan_run_id", scan.id)
    .maybeSingle();
  return {
    brand,
    scan: scan as ScanRun,
    score: (score as ScoreSnapshot | null) ?? null,
  };
}

export async function replacePrompts(
  brandId: string,
  prompts: Array<Omit<TrackedPrompt, "id" | "created_at" | "brand_id">>,
): Promise<TrackedPrompt[]> {
  if (usingLocalDb()) return local.localReplacePrompts(brandId, prompts);
  const supabase = createServiceClient();
  await supabase.from("tracked_prompts").delete().eq("brand_id", brandId).eq("is_custom", false);
  const { data, error } = await supabase
    .from("tracked_prompts")
    .insert(prompts.map((p) => ({ ...p, brand_id: brandId })))
    .select("*");
  if (error) throw error;
  return data as TrackedPrompt[];
}

export async function getPrompts(brandId: string): Promise<TrackedPrompt[]> {
  if (usingLocalDb()) return local.localGetPrompts(brandId);
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("tracked_prompts")
    .select("*")
    .eq("brand_id", brandId)
    .eq("active", true);
  return (data as TrackedPrompt[]) ?? [];
}

export async function listAllPrompts(brandId: string): Promise<TrackedPrompt[]> {
  if (usingLocalDb()) return local.localListAllPrompts(brandId);
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("tracked_prompts")
    .select("*")
    .eq("brand_id", brandId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as TrackedPrompt[]) ?? [];
}

export async function getTrackedPromptById(
  id: string,
): Promise<TrackedPrompt | null> {
  if (usingLocalDb()) return local.localGetTrackedPromptById(id);
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("tracked_prompts")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return (data as TrackedPrompt | null) ?? null;
}

export async function createTrackedPrompt(
  row: Omit<TrackedPrompt, "id" | "created_at">,
): Promise<TrackedPrompt> {
  if (usingLocalDb()) return local.localCreateTrackedPrompt(row);
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("tracked_prompts")
    .insert(row)
    .select("*")
    .single();
  if (error) throw error;
  return data as TrackedPrompt;
}

export async function updateTrackedPrompt(
  id: string,
  patch: Partial<TrackedPrompt>,
): Promise<TrackedPrompt | null> {
  if (usingLocalDb()) return local.localUpdateTrackedPrompt(id, patch);
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("tracked_prompts")
    .update(patch)
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return (data as TrackedPrompt | null) ?? null;
}

export async function deleteTrackedPrompt(id: string): Promise<boolean> {
  if (usingLocalDb()) return local.localDeleteTrackedPrompt(id);
  const supabase = createServiceClient();
  const { error } = await supabase.from("tracked_prompts").delete().eq("id", id);
  if (error) throw error;
  return true;
}

export async function updateBrand(
  id: string,
  patch: Partial<Brand>,
): Promise<Brand | null> {
  if (usingLocalDb()) return local.localUpdateBrand(id, patch);
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("brands")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return (data as Brand | null) ?? null;
}

function onboardingSettingsKey(userId: string): string {
  return `user_onboarding:${userId}`;
}

export async function getUserOnboarding(
  userId: string,
): Promise<OnboardingState | null> {
  if (usingLocalDb()) return local.localGetUserOnboarding(userId);
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", onboardingSettingsKey(userId))
    .maybeSingle();
  return (data?.value as OnboardingState | null) ?? null;
}

export async function upsertUserOnboarding(
  userId: string,
  state: OnboardingState,
): Promise<OnboardingState> {
  const next = { ...state, updatedAt: new Date().toISOString() };
  if (usingLocalDb()) return local.localUpsertUserOnboarding(userId, next);
  const supabase = createServiceClient();
  const { error } = await supabase.from("app_settings").upsert({
    key: onboardingSettingsKey(userId),
    value: next,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
  return next;
}

function brandMonitoringSettingsKey(brandId: string): string {
  return `brand_monitoring:${brandId}`;
}

export async function getBrandMonitoringSettings(
  brandId: string,
): Promise<BrandMonitoringSettings | null> {
  if (usingLocalDb()) return local.localGetBrandMonitoringSettings(brandId);
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", brandMonitoringSettingsKey(brandId))
    .maybeSingle();
  return (data?.value as BrandMonitoringSettings | null) ?? null;
}

export async function upsertBrandMonitoringSettings(
  brandId: string,
  settings: BrandMonitoringSettings,
): Promise<BrandMonitoringSettings> {
  const next = { ...settings, updatedAt: new Date().toISOString() };
  if (usingLocalDb()) {
    return local.localUpsertBrandMonitoringSettings(brandId, next);
  }
  const supabase = createServiceClient();
  const { error } = await supabase.from("app_settings").upsert({
    key: brandMonitoringSettingsKey(brandId),
    value: next,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
  return next;
}

export async function insertQueryResult(
  row: Omit<QueryResult, "id" | "created_at">,
): Promise<QueryResult> {
  if (usingLocalDb()) return local.localInsertQueryResult(row);
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("query_results")
    .insert(row)
    .select("*")
    .single();
  if (error) throw error;
  return data as QueryResult;
}

export async function getQueryResults(scanRunId: string): Promise<QueryResult[]> {
  if (usingLocalDb()) return local.localGetQueryResults(scanRunId);
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("query_results")
    .select("*")
    .eq("scan_run_id", scanRunId);
  return (data as QueryResult[]) ?? [];
}

export async function upsertScore(
  row: Omit<ScoreSnapshot, "id" | "created_at">,
): Promise<ScoreSnapshot> {
  if (usingLocalDb()) return local.localUpsertScore(row);
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("score_snapshots")
    .upsert(row, { onConflict: "scan_run_id" })
    .select("*")
    .single();
  if (error) throw error;
  return data as ScoreSnapshot;
}

export async function getScoreForScan(scanRunId: string) {
  if (usingLocalDb()) return local.localGetScoreForScan(scanRunId);
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("score_snapshots")
    .select("*")
    .eq("scan_run_id", scanRunId)
    .maybeSingle();
  return (data as ScoreSnapshot | null) ?? null;
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
  if (usingLocalDb()) {
    return local.localReplaceRecommendations(brandId, scanRunId, rows);
  }
  const supabase = createServiceClient();
  await supabase.from("recommendations").delete().eq("scan_run_id", scanRunId);
  const { data, error } = await supabase
    .from("recommendations")
    .insert(
      rows.map((r) => ({
        ...r,
        brand_id: brandId,
        scan_run_id: scanRunId,
      })),
    )
    .select("*");
  if (error) throw error;
  return data as Recommendation[];
}

export async function getRecommendations(brandId: string) {
  if (usingLocalDb()) return local.localGetRecommendations(brandId);
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("recommendations")
    .select("*")
    .eq("brand_id", brandId)
    .order("priority", { ascending: true });
  return (data as Recommendation[]) ?? [];
}

export async function getRecommendationsForScan(scanRunId: string) {
  if (usingLocalDb()) return local.localGetRecommendationsForScan(scanRunId);
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("recommendations")
    .select("*")
    .eq("scan_run_id", scanRunId)
    .order("priority", { ascending: true });
  return (data as Recommendation[]) ?? [];
}

export async function recordFreeScan(row: {
  domain: string;
  normalized_domain: string;
  ip_hash: string | null;
  scan_run_id: string | null;
}) {
  if (usingLocalDb()) return local.localRecordFreeScan(row);
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("free_scan_requests")
    .insert(row)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function replaceCompetitors(
  brandId: string,
  rows: Array<Omit<Competitor, "id" | "created_at" | "brand_id">>,
) {
  if (usingLocalDb()) return local.localReplaceCompetitors(brandId, rows);
  const supabase = createServiceClient();
  await supabase.from("competitors").delete().eq("brand_id", brandId);
  if (rows.length === 0) return [];
  const { data, error } = await supabase
    .from("competitors")
    .insert(rows.map((r) => ({ ...r, brand_id: brandId })))
    .select("*");
  if (error) throw error;
  return data as Competitor[];
}

export async function getCompetitors(brandId: string) {
  if (usingLocalDb()) return local.localGetCompetitors(brandId);
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("competitors")
    .select("*")
    .eq("brand_id", brandId);
  return (data as Competitor[]) ?? [];
}

export async function addUsage(
  row: Parameters<typeof local.localAddUsage>[0],
) {
  if (usingLocalDb()) return local.localAddUsage(row);
  const supabase = createServiceClient();
  const { error } = await supabase.from("usage_ledger").insert(row);
  if (error) throw error;
}

export async function sumUsage(userId: string, billingPeriod: string) {
  if (usingLocalDb()) return local.localSumUsage(userId, billingPeriod);
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("usage_ledger")
    .select("units")
    .eq("user_id", userId)
    .eq("billing_period", billingPeriod);
  return (data ?? []).reduce((sum, row) => sum + Number(row.units || 0), 0);
}

export async function getSubscription(userId: string): Promise<Subscription | null> {
  if (usingLocalDb()) return local.localGetSubscription(userId);
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("user_id", userId)
    .in("status", ["active", "trialing"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as Subscription | null) ?? null;
}

export async function upsertSubscription(
  row: Parameters<typeof local.localUpsertSubscription>[0],
) {
  if (usingLocalDb()) return local.localUpsertSubscription(row);
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("subscriptions")
    .upsert(row, { onConflict: "provider_subscription_id" })
    .select("*")
    .single();
  if (error) throw error;
  return data as Subscription;
}

export async function createAlert(
  row: Parameters<typeof local.localCreateAlert>[0],
) {
  if (usingLocalDb()) return local.localCreateAlert(row);
  const supabase = createServiceClient();
  const { data, error } = await supabase.from("alerts").insert(row).select("*").single();
  if (error) throw error;
  return data;
}

export async function listAlerts(userId: string) {
  if (usingLocalDb()) return local.localListAlerts(userId);
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("alerts")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  return data ?? [];
}

export async function recordWebhookEvent(
  row: Parameters<typeof local.localRecordWebhook>[0],
) {
  if (usingLocalDb()) return local.localRecordWebhook(row);
  const supabase = createServiceClient();
  const { error } = await supabase.from("webhook_events").insert({
    provider: row.provider,
    event_id: row.event_id,
    event_type: row.event_type,
    payload: row.payload,
  });
  if (error) {
    if (error.code === "23505") return { inserted: false };
    throw error;
  }
  return { inserted: true };
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
  if (usingLocalDb()) return local.localCopyBrandForOwner(brandId, ownerId);
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
  if (usingLocalDb()) return local.localClaimBrand(brandId, ownerId);
  const supabase = createServiceClient();
  const existing = await getBrandById(brandId);
  if (!existing) return null;
  if (existing.owner_id && existing.owner_id !== ownerId) {
    throw new Error("Brand already claimed by another account.");
  }
  const { data, error } = await supabase
    .from("brands")
    .update({
      owner_id: ownerId,
      claimed_at: new Date().toISOString(),
    })
    .eq("id", brandId)
    .select("*")
    .single();
  if (error) throw error;
  return data as Brand;
}

export async function listBrandsForOwner(ownerId: string) {
  if (usingLocalDb()) return local.localListBrandsForOwner(ownerId);
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("brands")
    .select("*")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false });
  return (data as Brand[]) ?? [];
}

export async function getLatestCompletedScanForBrand(
  brandId: string,
): Promise<ScanRun | null> {
  if (usingLocalDb()) {
    return local.localGetLatestCompletedScanForBrand(brandId);
  }
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("scan_runs")
    .select("*")
    .eq("brand_id", brandId)
    .in("status", ["completed", "partial"])
    .order("completed_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  return (data as ScanRun | null) ?? null;
}

export async function getActiveScanForBrand(
  brandId: string,
): Promise<ScanRun | null> {
  if (usingLocalDb()) return local.localGetActiveScanForBrand(brandId);
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("scan_runs")
    .select("*")
    .eq("brand_id", brandId)
    .in("status", ["queued", "running"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as ScanRun | null) ?? null;
}

export async function getRecommendationById(
  id: string,
): Promise<Recommendation | null> {
  if (usingLocalDb()) return local.localGetRecommendationById(id);
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("recommendations")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return (data as Recommendation | null) ?? null;
}

export async function updateRecommendationStatus(
  id: string,
  status: Recommendation["status"],
  completedAt: string | null,
): Promise<Recommendation | null> {
  if (usingLocalDb()) {
    return local.localUpdateRecommendationStatus(id, status, completedAt);
  }
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("recommendations")
    .update({ status, completed_at: completedAt })
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return (data as Recommendation | null) ?? null;
}

export async function addCompetitor(
  brandId: string,
  row: { name: string; domain: string | null },
): Promise<Competitor> {
  if (usingLocalDb()) return local.localAddCompetitor(brandId, row);
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("competitors")
    .insert({ ...row, brand_id: brandId, aliases: [] })
    .select("*")
    .single();
  if (error) throw error;
  return data as Competitor;
}

export async function removeCompetitor(
  brandId: string,
  competitorId: string,
): Promise<boolean> {
  if (usingLocalDb()) {
    return local.localRemoveCompetitor(brandId, competitorId);
  }
  const supabase = createServiceClient();
  const { error, count } = await supabase
    .from("competitors")
    .delete({ count: "exact" })
    .eq("id", competitorId)
    .eq("brand_id", brandId);
  if (error) throw error;
  return (count ?? 0) > 0;
}

export async function getUserEmail(userId: string): Promise<string | null> {
  if (usingLocalDb()) return local.localGetUserEmail(userId);
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("profiles")
    .select("email")
    .eq("id", userId)
    .maybeSingle();
  return data?.email ?? null;
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
  if (usingLocalDb()) return local.localListMonitorableBrandCandidates();
  const supabase = createServiceClient();
  const { data: brands } = await supabase
    .from("brands")
    .select("id, owner_id")
    .not("owner_id", "is", null);
  const results: MonitorableBrandCandidate[] = [];
  for (const brand of brands ?? []) {
    if (!brand.owner_id) continue;
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
  if (usingLocalDb()) return local.localScoresForBrand(brandId);
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("score_snapshots")
    .select("*")
    .eq("brand_id", brandId)
    .order("created_at", { ascending: false });
  return (data as ScoreSnapshot[]) ?? [];
}

export async function adminStats() {
  if (usingLocalDb()) return local.localAdminStats();
  const supabase = createServiceClient();
  const today = new Date().toISOString().slice(0, 10);
  const [users, brands, subs, scansToday, failed, usage] = await Promise.all([
    supabase.from("profiles").select("id", { count: "exact", head: true }),
    supabase.from("brands").select("id", { count: "exact", head: true }),
    supabase
      .from("subscriptions")
      .select("id", { count: "exact", head: true })
      .in("status", ["active", "trialing"]),
    supabase
      .from("scan_runs")
      .select("id", { count: "exact", head: true })
      .gte("created_at", `${today}T00:00:00.000Z`),
    supabase
      .from("scan_runs")
      .select("id", { count: "exact", head: true })
      .eq("status", "failed"),
    supabase.from("usage_ledger").select("provider,units,estimated_cost"),
  ]);

  const providerUsage: Record<string, number> = {};
  let estimatedCost = 0;
  for (const row of usage.data ?? []) {
    const key = (row.provider as string) ?? "unknown";
    providerUsage[key] = (providerUsage[key] ?? 0) + Number(row.units || 0);
    estimatedCost += Number(row.estimated_cost || 0);
  }

  return {
    users: users.count ?? 0,
    brands: brands.count ?? 0,
    activeSubscriptions: subs.count ?? 0,
    scansToday: scansToday.count ?? 0,
    failedScans: failed.count ?? 0,
    providerUsage,
    estimatedCost,
    freeScanCount: 0,
  };
}
