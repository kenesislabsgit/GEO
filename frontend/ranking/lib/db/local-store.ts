import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type {
  Alert,
  Brand,
  Competitor,
  FreeScanRequest,
  QueryResult,
  Recommendation,
  ScanRun,
  ScoreSnapshot,
  Subscription,
  TrackedPrompt,
  UsageLedgerEntry,
  WebhookEvent,
} from "@/types/database";
import type {
  BrandMonitoringSettings,
  OnboardingState,
} from "@/types/onboarding";

type StoreShape = {
  brands: Brand[];
  competitors: Competitor[];
  tracked_prompts: TrackedPrompt[];
  scan_runs: ScanRun[];
  query_results: QueryResult[];
  score_snapshots: ScoreSnapshot[];
  recommendations: Recommendation[];
  subscriptions: Subscription[];
  usage_ledger: UsageLedgerEntry[];
  free_scan_requests: FreeScanRequest[];
  alerts: Alert[];
  webhook_events: WebhookEvent[];
  profiles: Array<{
    id: string;
    email: string;
    full_name: string | null;
    avatar_url: string | null;
    created_at: string;
    updated_at: string;
  }>;
  user_onboarding: Record<string, OnboardingState>;
  brand_monitoring: Record<string, BrandMonitoringSettings>;
};

const STORE_PATH =
  process.env.LOCAL_STORE_PATH ??
  path.join(process.cwd(), ".data", "local-store.json");

let writeChain: Promise<unknown> = Promise.resolve();

function withStoreLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn, fn);
  writeChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

const emptyStore = (): StoreShape => ({
  brands: [],
  competitors: [],
  tracked_prompts: [],
  scan_runs: [],
  query_results: [],
  score_snapshots: [],
  recommendations: [],
  subscriptions: [],
  usage_ledger: [],
  free_scan_requests: [],
  alerts: [],
  webhook_events: [],
  profiles: [],
  user_onboarding: {},
  brand_monitoring: {},
});

async function readStoreUnlocked(): Promise<StoreShape> {
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    return { ...emptyStore(), ...JSON.parse(raw) } as StoreShape;
  } catch {
    const store = emptyStore();
    await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2));
    return store;
  }
}

async function writeStoreUnlocked(store: StoreShape): Promise<void> {
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
  const tmp = `${STORE_PATH}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(store, null, 2));
  await fs.rename(tmp, STORE_PATH);
}

async function mutateStore<T>(
  mutator: (store: StoreShape) => T | Promise<T>,
): Promise<T> {
  return withStoreLock(async () => {
    const store = await readStoreUnlocked();
    const result = await mutator(store);
    await writeStoreUnlocked(store);
    return result;
  });
}

async function readStore(): Promise<StoreShape> {
  return withStoreLock(() => readStoreUnlocked());
}

export function isLocalPersistence(): boolean {
  return !(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

/**
 * A website may be audited by many different people. Each person gets their own
 * brand record for that website, so their questions, competitors and reports
 * stay separate. Report links must stay unique, so a taken slug gets a suffix.
 */
function freeSlug(store: StoreShape, base: string, ownId?: string): string {
  const taken = (slug: string) =>
    store.brands.some((b) => b.slug === slug && b.id !== ownId);
  if (!taken(base)) return base;
  for (let suffix = 2; suffix < 500; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!taken(candidate)) return candidate;
  }
  return `${base}-${randomUUID().slice(0, 6)}`;
}

/**
 * Find the brand record this owner already has for a website. Anonymous audits
 * (no owner) always get a new record, so two visitors auditing the same site at
 * the same time never overwrite each other.
 */
function findOwnBrand(
  store: StoreShape,
  brand: { id?: string; owner_id: string | null; canonical_domain: string },
): Brand | undefined {
  if (brand.id) return store.brands.find((b) => b.id === brand.id);
  if (!brand.owner_id) return undefined;
  return store.brands.find(
    (b) =>
      b.owner_id === brand.owner_id &&
      b.canonical_domain === brand.canonical_domain,
  );
}

export async function localUpsertBrand(
  brand: Omit<Brand, "id" | "created_at" | "updated_at"> & { id?: string },
): Promise<Brand> {
  return mutateStore((store) => {
    const now = new Date().toISOString();
    const existing = findOwnBrand(store, brand);
    if (existing) {
      const updated: Brand = {
        ...existing,
        ...brand,
        id: existing.id,
        // Keep the link this report is already published under.
        slug: existing.slug,
        created_at: existing.created_at,
        updated_at: now,
      };
      store.brands = store.brands.map((b) =>
        b.id === existing.id ? updated : b,
      );
      return updated;
    }
    const id = brand.id?.trim() || randomUUID();
    const created: Brand = {
      ...brand,
      id,
      slug: freeSlug(store, brand.slug, id),
      created_at: now,
      updated_at: now,
    } as Brand;
    store.brands.push(created);
    return created;
  });
}

/** Most recent record for a website, whoever created it. Public/display use. */
export async function localGetBrandByDomain(domain: string): Promise<Brand | null> {
  const store = await readStore();
  const matches = store.brands
    .filter((b) => b.canonical_domain === domain)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  return matches[0] ?? null;
}

/** The record this specific person has for a website, if any. */
export async function localGetBrandByDomainForOwner(
  domain: string,
  ownerId: string,
): Promise<Brand | null> {
  const store = await readStore();
  return (
    store.brands.find(
      (b) => b.canonical_domain === domain && b.owner_id === ownerId,
    ) ?? null
  );
}

/**
 * Give this person their own copy of someone else's brand record so they can
 * audit the same website. Only the website-level description is copied — no
 * questions, competitors, scans or reports come across.
 */
export async function localCopyBrandForOwner(
  brandId: string,
  ownerId: string,
): Promise<Brand | null> {
  return mutateStore((store) => {
    const source = store.brands.find((b) => b.id === brandId);
    if (!source) return null;
    const own = store.brands.find(
      (b) =>
        b.owner_id === ownerId && b.canonical_domain === source.canonical_domain,
    );
    if (own) return own;
    const now = new Date().toISOString();
    const id = randomUUID();
    const copy: Brand = {
      ...source,
      id,
      owner_id: ownerId,
      slug: freeSlug(store, source.slug, id),
      claimed_at: now,
      created_at: now,
      updated_at: now,
    };
    store.brands.push(copy);
    return copy;
  });
}

export async function localGetBrandBySlug(slug: string): Promise<Brand | null> {
  const store = await readStore();
  return store.brands.find((b) => b.slug === slug) ?? null;
}

export async function localGetBrandById(id: string): Promise<Brand | null> {
  const store = await readStore();
  return store.brands.find((b) => b.id === id) ?? null;
}

export async function localListBrandsForOwner(ownerId: string): Promise<Brand[]> {
  const store = await readStore();
  return store.brands.filter((b) => b.owner_id === ownerId);
}

export async function localCreateScanRun(
  run: Omit<ScanRun, "id" | "created_at"> & { id?: string },
): Promise<ScanRun> {
  return mutateStore((store) => {
    const created: ScanRun = {
      ...run,
      id: run.id ?? randomUUID(),
      created_at: new Date().toISOString(),
    };
    store.scan_runs.unshift(created);
    return created;
  });
}

export async function localUpdateScanRun(
  id: string,
  patch: Partial<ScanRun>,
): Promise<ScanRun | null> {
  return mutateStore((store) => {
    const idx = store.scan_runs.findIndex((r) => r.id === id);
    if (idx < 0) return null;
    store.scan_runs[idx] = { ...store.scan_runs[idx]!, ...patch };
    return store.scan_runs[idx]!;
  });
}

export async function localGetScanRun(id: string): Promise<ScanRun | null> {
  const store = await readStore();
  return store.scan_runs.find((r) => r.id === id) ?? null;
}

export async function localListScansForBrands(
  brandIds: string[],
): Promise<ScanRun[]> {
  const store = await readStore();
  const ids = new Set(brandIds);
  return store.scan_runs
    .filter((r) => ids.has(r.brand_id))
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
}

export async function localGetLatestCompletedScanForBrand(
  brandId: string,
): Promise<ScanRun | null> {
  const store = await readStore();
  return (
    store.scan_runs
      .filter(
        (s) =>
          s.brand_id === brandId &&
          (s.status === "completed" || s.status === "partial"),
      )
      .sort(
        (a, b) =>
          new Date(b.completed_at ?? b.created_at).getTime() -
          new Date(a.completed_at ?? a.created_at).getTime(),
      )[0] ?? null
  );
}

export async function localGetActiveScanForBrand(
  brandId: string,
): Promise<ScanRun | null> {
  const store = await readStore();
  return (
    store.scan_runs.find(
      (s) =>
        s.brand_id === brandId &&
        (s.status === "queued" || s.status === "running"),
    ) ?? null
  );
}

export async function localGetRecommendationById(
  id: string,
): Promise<Recommendation | null> {
  const store = await readStore();
  return store.recommendations.find((r) => r.id === id) ?? null;
}

export async function localUpdateRecommendationStatus(
  id: string,
  status: Recommendation["status"],
  completedAt: string | null,
): Promise<Recommendation | null> {
  return mutateStore((store) => {
    const idx = store.recommendations.findIndex((r) => r.id === id);
    if (idx < 0) return null;
    store.recommendations[idx] = {
      ...store.recommendations[idx]!,
      status,
      completed_at: completedAt,
    };
    return store.recommendations[idx]!;
  });
}

export async function localAddCompetitor(
  brandId: string,
  row: { name: string; domain: string | null },
): Promise<Competitor> {
  return mutateStore((store) => {
    const created: Competitor = {
      id: randomUUID(),
      brand_id: brandId,
      name: row.name,
      domain: row.domain,
      aliases: [],
      created_at: new Date().toISOString(),
    };
    store.competitors.push(created);
    return created;
  });
}

export async function localRemoveCompetitor(
  brandId: string,
  competitorId: string,
): Promise<boolean> {
  return mutateStore((store) => {
    const before = store.competitors.length;
    store.competitors = store.competitors.filter(
      (c) => !(c.id === competitorId && c.brand_id === brandId),
    );
    return store.competitors.length < before;
  });
}

export async function localGetUserEmail(userId: string): Promise<string | null> {
  const store = await readStore();
  return store.profiles.find((p) => p.id === userId)?.email ?? null;
}

export async function localListMonitorableBrandCandidates(): Promise<
  Array<{
    brandId: string;
    ownerId: string;
    plan: "founder" | "growth" | "agency";
    email: string;
    settings: BrandMonitoringSettings;
  }>
> {
  const store = await readStore();
  const results: Array<{
    brandId: string;
    ownerId: string;
    plan: "founder" | "growth" | "agency";
    email: string;
    settings: BrandMonitoringSettings;
  }> = [];

  for (const [brandId, settings] of Object.entries(store.brand_monitoring)) {
    const brand = store.brands.find((b) => b.id === brandId);
    if (!brand?.owner_id) continue;
    const sub = store.subscriptions.find(
      (s) =>
        s.user_id === brand.owner_id &&
        (s.status === "active" || s.status === "trialing"),
    );
    if (!sub) continue;
    const email =
      store.profiles.find((p) => p.id === brand.owner_id)?.email ??
      `${brand.owner_id.slice(0, 8)}@local.rankedbyai.dev`;
    results.push({
      brandId,
      ownerId: brand.owner_id,
      plan: sub.plan,
      email,
      settings,
    });
  }
  return results;
}

/**
 * Latest finished audit for one brand record. Looked up by brand, never by
 * domain, because several people can have their own audits of the same website.
 */
export async function localLatestCompletedScanForBrand(
  brandId: string,
  maxAgeDays: number | null,
): Promise<{ brand: Brand; scan: ScanRun; score: ScoreSnapshot | null } | null> {
  const store = await readStore();
  const brand = store.brands.find((b) => b.id === brandId);
  if (!brand) return null;
  const cutoff =
    maxAgeDays === null ? null : Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const scan = store.scan_runs
    .filter((s) => s.brand_id === brand.id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .find(
      (s) =>
        (s.status === "completed" || s.status === "partial") &&
        (cutoff === null || new Date(s.created_at).getTime() >= cutoff),
    );
  if (!scan) return null;
  const score =
    store.score_snapshots.find((s) => s.scan_run_id === scan.id) ?? null;
  return { brand, scan, score };
}

export async function localReplacePrompts(
  brandId: string,
  prompts: Array<Omit<TrackedPrompt, "id" | "created_at" | "brand_id">>,
): Promise<TrackedPrompt[]> {
  return mutateStore((store) => {
    store.tracked_prompts = store.tracked_prompts.filter(
      (p) => p.brand_id !== brandId || p.is_custom,
    );
    const created = prompts.map((p) => ({
      ...p,
      id: randomUUID(),
      brand_id: brandId,
      created_at: new Date().toISOString(),
    }));
    store.tracked_prompts.push(...created);
    return created;
  });
}

export async function localGetPrompts(brandId: string): Promise<TrackedPrompt[]> {
  const store = await readStore();
  return store.tracked_prompts.filter((p) => p.brand_id === brandId && p.active);
}

export async function localListAllPrompts(
  brandId: string,
): Promise<TrackedPrompt[]> {
  const store = await readStore();
  return store.tracked_prompts
    .filter((p) => p.brand_id === brandId)
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
}

export async function localGetTrackedPromptById(
  id: string,
): Promise<TrackedPrompt | null> {
  const store = await readStore();
  return store.tracked_prompts.find((p) => p.id === id) ?? null;
}

export async function localCreateTrackedPrompt(
  row: Omit<TrackedPrompt, "id" | "created_at">,
): Promise<TrackedPrompt> {
  return mutateStore((store) => {
    const created: TrackedPrompt = {
      ...row,
      id: randomUUID(),
      created_at: new Date().toISOString(),
    };
    store.tracked_prompts.push(created);
    return created;
  });
}

export async function localUpdateTrackedPrompt(
  id: string,
  patch: Partial<TrackedPrompt>,
): Promise<TrackedPrompt | null> {
  return mutateStore((store) => {
    const idx = store.tracked_prompts.findIndex((p) => p.id === id);
    if (idx < 0) return null;
    store.tracked_prompts[idx] = { ...store.tracked_prompts[idx]!, ...patch };
    return store.tracked_prompts[idx]!;
  });
}

export async function localDeleteTrackedPrompt(id: string): Promise<boolean> {
  return mutateStore((store) => {
    const before = store.tracked_prompts.length;
    store.tracked_prompts = store.tracked_prompts.filter((p) => p.id !== id);
    return store.tracked_prompts.length < before;
  });
}

export async function localUpdateBrand(
  id: string,
  patch: Partial<Brand>,
): Promise<Brand | null> {
  return mutateStore((store) => {
    const idx = store.brands.findIndex((b) => b.id === id);
    if (idx < 0) return null;
    const updated: Brand = {
      ...store.brands[idx]!,
      ...patch,
      updated_at: new Date().toISOString(),
    };
    store.brands[idx] = updated;
    return updated;
  });
}

export async function localGetUserOnboarding(
  userId: string,
): Promise<OnboardingState | null> {
  const store = await readStore();
  return store.user_onboarding[userId] ?? null;
}

export async function localUpsertUserOnboarding(
  userId: string,
  state: OnboardingState,
): Promise<OnboardingState> {
  return mutateStore((store) => {
    const next = { ...state, updatedAt: new Date().toISOString() };
    store.user_onboarding[userId] = next;
    return next;
  });
}

export async function localGetBrandMonitoringSettings(
  brandId: string,
): Promise<BrandMonitoringSettings | null> {
  const store = await readStore();
  return store.brand_monitoring[brandId] ?? null;
}

export async function localUpsertBrandMonitoringSettings(
  brandId: string,
  settings: BrandMonitoringSettings,
): Promise<BrandMonitoringSettings> {
  return mutateStore((store) => {
    const next = { ...settings, updatedAt: new Date().toISOString() };
    store.brand_monitoring[brandId] = next;
    return next;
  });
}

export async function localInsertQueryResult(
  row: Omit<QueryResult, "id" | "created_at">,
): Promise<QueryResult> {
  return mutateStore((store) => {
    const created: QueryResult = {
      ...row,
      id: randomUUID(),
      created_at: new Date().toISOString(),
    };
    store.query_results.push(created);
    return created;
  });
}

export async function localGetQueryResults(scanRunId: string): Promise<QueryResult[]> {
  const store = await readStore();
  return store.query_results.filter((q) => q.scan_run_id === scanRunId);
}

export async function localUpsertScore(
  row: Omit<ScoreSnapshot, "id" | "created_at">,
): Promise<ScoreSnapshot> {
  return mutateStore((store) => {
    const existing = store.score_snapshots.find(
      (s) => s.scan_run_id === row.scan_run_id,
    );
    if (existing) {
      const updated = { ...existing, ...row };
      store.score_snapshots = store.score_snapshots.map((s) =>
        s.id === existing.id ? updated : s,
      );
      return updated;
    }
    const created: ScoreSnapshot = {
      ...row,
      id: randomUUID(),
      created_at: new Date().toISOString(),
    };
    store.score_snapshots.push(created);
    return created;
  });
}

export async function localGetScoreForScan(
  scanRunId: string,
): Promise<ScoreSnapshot | null> {
  const store = await readStore();
  return store.score_snapshots.find((s) => s.scan_run_id === scanRunId) ?? null;
}

export async function localReplaceRecommendations(
  brandId: string,
  scanRunId: string,
  rows: Array<
    Omit<
      Recommendation,
      "id" | "created_at" | "brand_id" | "scan_run_id" | "completed_at"
    >
  >,
): Promise<Recommendation[]> {
  return mutateStore((store) => {
    store.recommendations = store.recommendations.filter(
      (r) => r.scan_run_id !== scanRunId,
    );
    const created = rows.map((r) => ({
      ...r,
      id: randomUUID(),
      brand_id: brandId,
      scan_run_id: scanRunId,
      completed_at: null,
      created_at: new Date().toISOString(),
    }));
    store.recommendations.push(...created);
    return created;
  });
}

export async function localGetRecommendations(
  brandId: string,
): Promise<Recommendation[]> {
  const store = await readStore();
  return store.recommendations.filter((r) => r.brand_id === brandId);
}

export async function localGetRecommendationsForScan(
  scanRunId: string,
): Promise<Recommendation[]> {
  const store = await readStore();
  return store.recommendations.filter((r) => r.scan_run_id === scanRunId);
}

export async function localRecordFreeScan(
  row: Omit<FreeScanRequest, "id" | "created_at">,
): Promise<FreeScanRequest> {
  return mutateStore((store) => {
    const created: FreeScanRequest = {
      ...row,
      id: randomUUID(),
      created_at: new Date().toISOString(),
    };
    store.free_scan_requests.push(created);
    return created;
  });
}

export async function localReplaceCompetitors(
  brandId: string,
  rows: Array<Omit<Competitor, "id" | "created_at" | "brand_id">>,
): Promise<Competitor[]> {
  return mutateStore((store) => {
    store.competitors = store.competitors.filter((c) => c.brand_id !== brandId);
    const created = rows.map((r) => ({
      ...r,
      id: randomUUID(),
      brand_id: brandId,
      created_at: new Date().toISOString(),
    }));
    store.competitors.push(...created);
    return created;
  });
}

export async function localGetCompetitors(brandId: string): Promise<Competitor[]> {
  const store = await readStore();
  return store.competitors.filter((c) => c.brand_id === brandId);
}

export async function localAddUsage(
  row: Omit<UsageLedgerEntry, "id" | "created_at">,
): Promise<void> {
  await mutateStore((store) => {
    store.usage_ledger.push({
      ...row,
      id: randomUUID(),
      created_at: new Date().toISOString(),
    });
  });
}

export async function localSumUsage(
  userId: string,
  billingPeriod: string,
): Promise<number> {
  const store = await readStore();
  return store.usage_ledger
    .filter((u) => u.user_id === userId && u.billing_period === billingPeriod)
    .reduce((sum, u) => sum + u.units, 0);
}

export async function localUpsertSubscription(
  row: Omit<Subscription, "id" | "created_at" | "updated_at"> & { id?: string },
): Promise<Subscription> {
  return mutateStore((store) => {
    const now = new Date().toISOString();
    const existing = store.subscriptions.find(
      (s) =>
        s.provider_subscription_id === row.provider_subscription_id ||
        (s.user_id === row.user_id &&
          (s.status === "active" || s.status === "trialing")),
    );
    if (existing) {
      const updated = { ...existing, ...row, updated_at: now };
      store.subscriptions = store.subscriptions.map((s) =>
        s.id === existing.id ? updated : s,
      );
      return updated;
    }
    const created: Subscription = {
      ...row,
      id: row.id ?? randomUUID(),
      created_at: now,
      updated_at: now,
    };
    store.subscriptions.push(created);
    return created;
  });
}

export async function localGetSubscription(
  userId: string,
): Promise<Subscription | null> {
  const store = await readStore();
  return (
    store.subscriptions.find(
      (s) =>
        s.user_id === userId &&
        (s.status === "active" || s.status === "trialing"),
    ) ?? null
  );
}

export async function localCreateAlert(
  row: Omit<Alert, "id" | "created_at" | "read_at" | "emailed_at">,
): Promise<Alert> {
  return mutateStore((store) => {
    const created: Alert = {
      ...row,
      id: randomUUID(),
      read_at: null,
      emailed_at: null,
      created_at: new Date().toISOString(),
    };
    store.alerts.unshift(created);
    return created;
  });
}

export async function localListAlerts(userId: string): Promise<Alert[]> {
  const store = await readStore();
  return store.alerts.filter((a) => a.user_id === userId);
}

export async function localRecordWebhook(
  row: Omit<WebhookEvent, "id" | "processed_at">,
): Promise<{ inserted: boolean }> {
  return mutateStore((store) => {
    const exists = store.webhook_events.some(
      (w) => w.provider === row.provider && w.event_id === row.event_id,
    );
    if (exists) return { inserted: false };
    store.webhook_events.push({
      ...row,
      id: randomUUID(),
      processed_at: new Date().toISOString(),
    });
    return { inserted: true };
  });
}

export async function localAdminStats() {
  const store = await readStore();
  const today = new Date().toISOString().slice(0, 10);
  return {
    users: store.profiles.length,
    brands: store.brands.length,
    activeSubscriptions: store.subscriptions.filter(
      (s) => s.status === "active" || s.status === "trialing",
    ).length,
    scansToday: store.scan_runs.filter((s) => s.created_at.startsWith(today))
      .length,
    failedScans: store.scan_runs.filter((s) => s.status === "failed").length,
    providerUsage: store.usage_ledger.reduce(
      (acc, row) => {
        const key = row.provider ?? "unknown";
        acc[key] = (acc[key] ?? 0) + row.units;
        return acc;
      },
      {} as Record<string, number>,
    ),
    estimatedCost: store.usage_ledger.reduce(
      (sum, row) => sum + Number(row.estimated_cost || 0),
      0,
    ),
    freeScanCount: store.free_scan_requests.length,
  };
}

export async function localScoresForBrand(brandId: string): Promise<ScoreSnapshot[]> {
  const store = await readStore();
  return store.score_snapshots
    .filter((s) => s.brand_id === brandId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function localClaimBrand(
  brandId: string,
  ownerId: string,
): Promise<Brand | null> {
  return mutateStore((store) => {
    const brand = store.brands.find((b) => b.id === brandId);
    if (!brand) return null;
    if (brand.owner_id && brand.owner_id !== ownerId) {
      throw new Error("Brand already claimed by another account.");
    }
    const updated: Brand = {
      ...brand,
      owner_id: ownerId,
      claimed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    store.brands = store.brands.map((b) => (b.id === brandId ? updated : b));
    return updated;
  });
}
