import { PLAN_CONFIG, type PlanId } from "@/lib/billing/entitlements";
import { one, q } from "@/lib/db/pg";
import { getBrandById, getSubscription } from "@/lib/db/repository";
import { enqueueScan } from "@/lib/scans/queue";
import { log } from "@/lib/log";
import type { ProviderId, ScanInputSnapshot } from "@/types/database";

/**
 * Scheduled monitoring, run by the worker. Every due brand gets a scan
 * enqueued through the same path a manual audit uses - same engine, same
 * methodology, same entitlement accounting.
 *
 * The database idempotency key makes this safe across many workers. Every
 * monitoring period can create at most one audit, even when several workers
 * notice it at the same time or restart after the scheduled hour.
 */

type MonitoringRow = {
  brand_id: string;
  enabled: boolean;
  frequency: "daily" | "weekly";
  day_of_week: number;
  hour_local: number;
  timezone: string;
  providers: ProviderId[];
  monitoring_questions: string[];
  country: string | null;
  language: string | null;
};

function localParts(
  timezone: string,
  now: Date,
): { hour: number; day: number; date: string } {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hourCycle: "h23",
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = formatter.formatToParts(now);
    const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "9");
    const weekday = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
    const day = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(
      weekday,
    );
    const year = parts.find((p) => p.type === "year")?.value ?? "1970";
    const month = parts.find((p) => p.type === "month")?.value ?? "01";
    const date = parts.find((p) => p.type === "day")?.value ?? "01";
    return { hour, day: day < 0 ? 0 : day, date: `${year}-${month}-${date}` };
  } catch {
    return {
      hour: now.getUTCHours(),
      day: (now.getUTCDay() + 6) % 7,
      date: now.toISOString().slice(0, 10),
    };
  }
}

function periodKey(
  frequency: "daily" | "weekly",
  localDate: string,
  localDay: number,
): string {
  if (frequency === "daily") return localDate;
  const monday = new Date(`${localDate}T00:00:00.000Z`);
  monday.setUTCDate(monday.getUTCDate() - localDay);
  return monday.toISOString().slice(0, 10);
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

export type SchedulerTickStats = {
  checked: number;
  enqueued: number;
  alreadyQueued: number;
  skipped: number;
  refused: number;
  failed: number;
};

type ScheduleOutcome = Exclude<keyof SchedulerTickStats, "checked" | "failed">;

export async function runSchedulerTick(
  now = new Date(),
): Promise<SchedulerTickStats> {
  const stats: SchedulerTickStats = {
    checked: 0,
    enqueued: 0,
    alreadyQueued: 0,
    skipped: 0,
    refused: 0,
    failed: 0,
  };
  if (await maintenanceModeOn()) {
    log.info("scheduler_skipped", { reason: "maintenance_mode" });
    return stats;
  }
  const disabled = await disabledProviders();

  // One query for all candidates: monitoring row + owner + plan presence.
  const rows = await q<MonitoringRow & { owner_id: string }>(
    `select bm.brand_id, bm.enabled, bm.frequency, bm.day_of_week,
            bm.hour_local, bm.timezone, bm.providers, bm.country, bm.language,
            bm.monitoring_questions,
            b.owner_id
     from brand_monitoring bm
     join brands b on b.id = bm.brand_id
     where bm.enabled = true and b.owner_id is not null`,
  );

  for (const row of rows) {
    stats.checked += 1;
    try {
      const outcome = await maybeScheduleBrand(row, disabled, now);
      stats[outcome] += 1;
    } catch (error) {
      stats.failed += 1;
      log.error("scheduler_brand_failed", {
        brandId: row.brand_id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  log.info("scheduler_tick_completed", stats);
  return stats;
}

async function maybeScheduleBrand(
  row: MonitoringRow & { owner_id: string },
  disabled: Set<string>,
  now: Date,
): Promise<ScheduleOutcome> {
  const sub = await getSubscription(row.owner_id);
  if (!sub) return "skipped"; // Monitoring is a paid feature; lapsed plans pause it.
  const plan: PlanId = sub.plan;
  const features = PLAN_CONFIG[plan].features;

  // The plan caps the frequency: a weekly plan monitoring row set to daily
  // (edited by hand, or after a downgrade) runs weekly.
  const frequency: "daily" | "weekly" =
    row.frequency === "daily" && features.dailyMonitoring ? "daily" : "weekly";
  if (frequency === "weekly" && !features.weeklyMonitoring) return "skipped";

  // Downgrades pause monitoring for brands beyond the new plan's limit -
  // the data stays, the spending stops. Oldest brands keep their slots.
  const rank = await one<{ position: number }>(
    `select count(*)::int as position
     from brands b
     join brand_monitoring bm on bm.brand_id = b.id and bm.enabled = true
     where b.owner_id = $1
       and b.created_at <= (select created_at from brands where id = $2)`,
    [row.owner_id, row.brand_id],
  );
  if ((rank?.position ?? 1) > features.brands) {
    return "skipped";
  }

  const local = localParts(row.timezone || "UTC", now);
  const due =
    frequency === "daily"
      ? local.hour >= row.hour_local
      : local.day > row.day_of_week ||
        (local.day === row.day_of_week && local.hour >= row.hour_local);
  if (!due) return "skipped";

  const brand = await getBrandById(row.brand_id);
  if (!brand) return "skipped";

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
    return "skipped";
  }

  // Repeat the same five questions. Rotating questions made week-to-week
  // score changes look meaningful when the underlying sample had changed.
  const monitoringQuestions = (row.monitoring_questions ?? [])
    .map((question) => String(question).trim())
    .filter(Boolean)
    .slice(0, 5);
  if (monitoringQuestions.length !== 5) {
    log.warn("scheduler_monitoring_questions_missing", {
      brandId: row.brand_id,
    });
    return "skipped";
  }
  const prompts = monitoringQuestions.map((prompt, index) => ({
    id: `monitoring-${index + 1}`,
    prompt,
  }));

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
    idempotencyKey: `scheduled:${row.brand_id}:${frequency}:${periodKey(
      frequency,
      local.date,
      local.day,
    )}`,
    checksLimit: features.providerChecksPerMonth,
  });

  if (!result.ok) {
    log.warn("scheduler_enqueue_refused", {
      brandId: row.brand_id,
      error: result.error,
    });
    return "refused";
  } else if (!result.alreadyRunning) {
    log.info("scheduler_enqueued", {
      brandId: row.brand_id,
      scanId: result.scan.id,
      prompts: prompts.length,
      providers: providers.length,
      frequency,
    });
    return "enqueued";
  }
  return "alreadyQueued";
}
