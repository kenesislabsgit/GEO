import { PLAN_CONFIG, type PlanId } from "@/lib/billing/entitlements";
import { PRO_AUDIT_QUESTION_COUNT } from "@/lib/constants";
import { one, q } from "@/lib/db/pg";
import {
  getBrandById,
  getLatestScanForBrand,
  getPrompts,
  getSubscription,
} from "@/lib/db/repository";
import { enqueueScan } from "@/lib/scans/queue";
import { log } from "@/lib/log";
import type { ProviderId, ScanInputSnapshot } from "@/types/database";

/**
 * Scheduled monitoring, run by the worker. Every due brand gets a scan
 * enqueued through the same path a manual audit uses - same engine, same
 * methodology, same entitlement accounting.
 *
 * Question rotation: a plan can track more prompts than its monthly
 * provider-check allowance could ask on every run. Each scheduled scan asks
 * a deterministic slice of the active prompts, sized so a full month of
 * scheduled runs fits inside the allowance, and rotates the starting point
 * so every prompt is covered over successive runs.
 */

type MonitoringRow = {
  brand_id: string;
  enabled: boolean;
  frequency: "daily" | "weekly";
  day_of_week: number;
  hour_local: number;
  timezone: string;
  providers: ProviderId[];
  country: string | null;
  language: string | null;
};

function localParts(timezone: string): { hour: number; day: number } {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hour12: false,
      weekday: "short",
    });
    const parts = formatter.formatToParts(new Date());
    const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "9");
    const weekday = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
    const day = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(
      weekday,
    );
    return { hour, day: day < 0 ? 0 : day };
  } catch {
    return { hour: new Date().getUTCHours(), day: (new Date().getUTCDay() + 6) % 7 };
  }
}

/** Deterministic rotation offset: changes once per scheduled run. */
function rotationOffset(frequency: "daily" | "weekly"): number {
  const days = Math.floor(Date.now() / 86_400_000);
  return frequency === "daily" ? days : Math.floor(days / 7);
}

export function rotatingSlice<T>(
  items: T[],
  batchSize: number,
  offsetIndex: number,
): T[] {
  if (items.length <= batchSize) return items;
  const start = (offsetIndex * batchSize) % items.length;
  const slice = items.slice(start, start + batchSize);
  if (slice.length < batchSize) {
    slice.push(...items.slice(0, batchSize - slice.length));
  }
  return slice;
}

async function maintenanceModeOn(): Promise<boolean> {
  const row = await one<{ value: unknown }>(
    `select value from app_settings where key = 'maintenance_mode'`,
  );
  return row?.value === true;
}

async function disabledProviders(): Promise<Set<string>> {
  const row = await one<{ value: unknown }>(
    `select value from app_settings where key = 'providers_disabled'`,
  );
  return new Set(Array.isArray(row?.value) ? (row.value as string[]) : []);
}

export async function runSchedulerTick(): Promise<void> {
  if (await maintenanceModeOn()) {
    log.info("scheduler_skipped", { reason: "maintenance_mode" });
    return;
  }
  const disabled = await disabledProviders();

  // One query for all candidates: monitoring row + owner + plan presence.
  const rows = await q<MonitoringRow & { owner_id: string }>(
    `select bm.brand_id, bm.enabled, bm.frequency, bm.day_of_week,
            bm.hour_local, bm.timezone, bm.providers, bm.country, bm.language,
            b.owner_id
     from brand_monitoring bm
     join brands b on b.id = bm.brand_id
     where bm.enabled = true and b.owner_id is not null`,
  );

  for (const row of rows) {
    try {
      await maybeScheduleBrand(row, disabled);
    } catch (error) {
      log.error("scheduler_brand_failed", {
        brandId: row.brand_id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

async function maybeScheduleBrand(
  row: MonitoringRow & { owner_id: string },
  disabled: Set<string>,
): Promise<void> {
  const sub = await getSubscription(row.owner_id);
  if (!sub) return; // Monitoring is a paid feature; lapsed plans pause it.
  const plan: PlanId = sub.plan;
  const features = PLAN_CONFIG[plan].features;

  // The plan caps the frequency: a weekly plan monitoring row set to daily
  // (edited by hand, or after a downgrade) runs weekly.
  const frequency: "daily" | "weekly" =
    row.frequency === "daily" && features.dailyMonitoring ? "daily" : "weekly";
  if (frequency === "weekly" && !features.weeklyMonitoring) return;

  // Downgrades pause monitoring for brands beyond the new plan's limit - 
  // the data stays, the spending stops. Oldest brands keep their slots.
  const rank = await one<{ position: number }>(
    `select count(*)::int as position from brands
     where owner_id = $1 and created_at <= (select created_at from brands where id = $2)`,
    [row.owner_id, row.brand_id],
  );
  if ((rank?.position ?? 1) > features.brands) {
    return;
  }

  const { hour, day } = localParts(row.timezone || "UTC");
  if (hour < row.hour_local) return;
  if (frequency === "weekly" && day !== row.day_of_week) return;

  // Due when no scan has run inside the current window. The 20h/6d guards
  // absorb clock drift and reruns of the tick within the same day.
  const latest = await getLatestScanForBrand(row.brand_id);
  if (latest) {
    const last = new Date(
      latest.scan.completed_at ?? latest.scan.created_at,
    ).getTime();
    const elapsed = Date.now() - last;
    if (frequency === "daily" && elapsed < 20 * 3_600_000) return;
    if (frequency === "weekly" && elapsed < 6 * 86_400_000) return;
  }

  const brand = await getBrandById(row.brand_id);
  if (!brand) return;

  const planProviders = new Set<string>(features.providers);
  let providers = (row.providers ?? []).filter(
    (p) => planProviders.has(p) && !disabled.has(p),
  );
  if (providers.length === 0) {
    providers = features.providers
      .filter((p) => !disabled.has(p))
      .slice(0, features.providersPerScan);
  }
  providers = providers.slice(0, features.providersPerScan);
  if (providers.length === 0) {
    log.warn("scheduler_no_providers", { brandId: row.brand_id });
    return;
  }

  const activePrompts = await getPrompts(row.brand_id);
  if (activePrompts.length === 0) return;

  // Size the batch so the month of scheduled runs fits the allowance,
  // leaving half the allowance for manual audits.
  const runsPerMonth = frequency === "daily" ? 31 : 5;
  const budgetPerRun = Math.floor(
    features.providerChecksPerMonth / 2 / (runsPerMonth * providers.length),
  );
  const batchSize = Math.max(
    1,
    Math.min(activePrompts.length, PRO_AUDIT_QUESTION_COUNT, budgetPerRun || 1),
  );
  const prompts = rotatingSlice(
    [...activePrompts].sort((a, b) => a.id.localeCompare(b.id)),
    batchSize,
    rotationOffset(frequency),
  ).map((p) => ({ id: p.id, prompt: p.prompt }));

  const snapshot: ScanInputSnapshot = {
    domain: brand.canonical_domain,
    mode: "pro",
    assistants: providers,
    limit_per_assistant: prompts.length,
    prompts,
    country: row.country ?? brand.default_country ?? null,
    language: row.language ?? brand.default_language ?? null,
    geo_market: false,
    geo_market_name: null,
    ip_hash: null,
    plan,
    question_count: prompts.length,
    methodology_version_requested: null,
    trigger_source: "scheduled",
    cost_ceiling_usd: Number(process.env.SCAN_COST_CEILING_USD ?? "2.50"),
    resume: false,
  };

  const result = await enqueueScan({
    brand,
    initiatedBy: row.owner_id,
    scanType: "scheduled",
    snapshot,
    idempotencyKey: `scheduled:${row.brand_id}:${rotationOffset(frequency)}`,
    checksLimit: features.providerChecksPerMonth,
  });

  if (!result.ok) {
    log.warn("scheduler_enqueue_refused", {
      brandId: row.brand_id,
      error: result.error,
    });
  } else if (!result.alreadyRunning) {
    log.info("scheduler_enqueued", {
      brandId: row.brand_id,
      scanId: result.scan.id,
      prompts: prompts.length,
      providers: providers.length,
      frequency,
    });
  }
}
