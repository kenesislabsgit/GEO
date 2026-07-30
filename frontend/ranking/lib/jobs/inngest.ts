import { Inngest } from "inngest";
import { executeScanRun } from "@/lib/jobs/run-scan";
import {
  getSubscription,
  listBrandsForOwner,
  createScanRun,
  getPrompts,
  createAlert,
  scoresForBrand,
  getScanRun,
  listMonitorableBrandCandidates,
  getLatestCompletedScanForBrand,
  getActiveScanForBrand,
} from "@/lib/db/repository";
import { getAccountEntitlements } from "@/lib/billing/account";
import { METHODOLOGY_VERSION } from "@/lib/constants";
import { PLAN_CONFIG, type PlanId, canRunProviderCheck } from "@/lib/billing/entitlements";
import { sendAlertEmail } from "@/lib/email/resend";
import { isMonitoringScanDue } from "@/lib/monitoring/schedule";

export const inngest = new Inngest({ id: "rankedbyai" });

export const runScanFunction = inngest.createFunction(
  {
    id: "scan-run",
    retries: 2,
    concurrency: { limit: 5 },
    triggers: [{ event: "scan/run" }],
  },
  async ({ event, step }) => {
    const scanRunId = event.data.scanRunId as string;
    await step.run("execute-scan", async () => {
      await executeScanRun(scanRunId);
    });
    return { ok: true, scanRunId };
  },
);

export const weeklyMonitoringFunction = inngest.createFunction(
  {
    id: "scheduled-weekly-scans",
    retries: 1,
    triggers: [{ cron: "0 9 * * 1" }],
  },
  async ({ step }) => {
    await step.sendEvent("emit-monitor-tick", {
      name: "monitoring/weekly-tick",
      data: { at: new Date().toISOString() },
    });
    return { ok: true };
  },
);

export const processWeeklyTick = inngest.createFunction(
  {
    id: "process-weekly-tick",
    retries: 1,
    triggers: [{ event: "monitoring/weekly-tick" }],
  },
  async ({ step }) => {
    const candidates = await step.run("list-candidates", async () =>
      listMonitorableBrandCandidates(),
    );

    let scheduled = 0;
    for (const candidate of candidates) {
      const planFeatures = PLAN_CONFIG[candidate.plan].features;
      const frequency = candidate.settings.monitoringFrequency;
      if (frequency === "daily" && !planFeatures.dailyMonitoring) continue;
      if (frequency === "weekly" && !planFeatures.weeklyMonitoring) continue;

      const shouldRun = await step.run(
        `check-due-${candidate.brandId}`,
        async () => {
          const active = await getActiveScanForBrand(candidate.brandId);
          if (active) return false;
          const last = await getLatestCompletedScanForBrand(candidate.brandId);
          return isMonitoringScanDue(
            last?.completed_at ?? last?.created_at,
            frequency,
          );
        },
      );
      if (!shouldRun) continue;

      const hasUsage = await step.run(
        `check-usage-${candidate.brandId}`,
        async () => {
          const entitlements = await getAccountEntitlements(candidate.ownerId);
          return canRunProviderCheck(entitlements);
        },
      );
      if (!hasUsage) continue;

      await step.sendEvent(`schedule-${candidate.brandId}`, {
        name: "monitoring/brand-scan",
        data: {
          brandId: candidate.brandId,
          userId: candidate.ownerId,
          plan: candidate.plan,
          email: candidate.email,
        },
      });
      scheduled += 1;
    }

    return { scheduled, candidates: candidates.length };
  },
);

export const scheduleBrandScan = inngest.createFunction(
  {
    id: "schedule-brand-scan",
    retries: 1,
    triggers: [{ event: "monitoring/brand-scan" }],
  },
  async ({ event, step }) => {
    const brandId = event.data.brandId as string;
    const userId = event.data.userId as string;
    const plan = (event.data.plan as PlanId) ?? "founder";

    const scanRunId = await step.run("create-scan", async () => {
      const sub = await getSubscription(userId);
      if (!sub || (sub.status !== "active" && sub.status !== "trialing")) {
        throw new Error("No active subscription");
      }
      const prompts = await getPrompts(brandId);
      const providers = PLAN_CONFIG[plan].features.providers;
      const run = await createScanRun({
        brand_id: brandId,
        initiated_by: userId,
        scan_type: "scheduled",
        status: "queued",
        provider_ids: providers,
        total_queries: prompts.length * providers.length,
        completed_queries: 0,
        started_at: null,
        completed_at: null,
        error_summary: null,
        methodology_version: METHODOLOGY_VERSION,
        demo_mode: false,
        cancelled_at: null,
        country: null,
        language: null,
      });
      return run.id;
    });

    await step.run("execute-scheduled-scan", async () => {
      await executeScanRun(scanRunId);
    });

    await step.run("diff-alerts", async () => {
      const scores = await scoresForBrand(brandId);
      if (scores.length >= 2) {
        const [latest, previous] = scores;
        const delta =
          Number(latest!.overall_score) - Number(previous!.overall_score);
        if (Math.abs(delta) >= 5) {
          const title =
            delta > 0
              ? "Visibility score increased"
              : "Visibility score decreased";
          const alert = await createAlert({
            user_id: userId,
            brand_id: brandId,
            type: "score_change",
            title,
            body: `Overall score changed by ${delta.toFixed(1)} points after the scheduled scan.`,
            metadata: { delta, scanRunId },
          });
          await sendAlertEmail({
            to: event.data.email as string,
            subject: title,
            body: alert.body,
          });
        }
      }
      return { scanRunId };
    });

    return { scanRunId };
  },
);

export const cancelScanFunction = inngest.createFunction(
  {
    id: "cancel-scan",
    triggers: [{ event: "scan/cancel" }],
  },
  async ({ event }) => {
    const scan = await getScanRun(event.data.scanRunId as string);
    if (!scan) return { ok: false };
    return { ok: true, status: scan.status };
  },
);

export const inngestFunctions = [
  runScanFunction,
  weeklyMonitoringFunction,
  processWeeklyTick,
  scheduleBrandScan,
  cancelScanFunction,
];

export async function enqueueScan(scanRunId: string): Promise<void> {
  if (!process.env.INNGEST_EVENT_KEY) {
    // Local/dev without Inngest: run inline and await so progress APIs see completion.
    await executeScanRun(scanRunId);
    return;
  }
  await inngest.send({ name: "scan/run", data: { scanRunId } });
}

export async function enqueueBrandMonitoring(input: {
  brandId: string;
  userId: string;
  plan: PlanId;
  email: string;
}) {
  if (!process.env.INNGEST_EVENT_KEY) {
    const brands = await listBrandsForOwner(input.userId);
    const brand = brands.find((b) => b.id === input.brandId);
    if (!brand) return;
    const prompts = await getPrompts(brand.id);
    const providers = PLAN_CONFIG[input.plan].features.providers;
    const run = await createScanRun({
      brand_id: brand.id,
      initiated_by: input.userId,
      scan_type: "scheduled",
      status: "queued",
      provider_ids: providers,
      total_queries: prompts.length * providers.length,
      completed_queries: 0,
      started_at: null,
      completed_at: null,
      error_summary: null,
      methodology_version: METHODOLOGY_VERSION,
      demo_mode: false,
      cancelled_at: null,
      country: null,
      language: null,
    });
    await executeScanRun(run.id);
    return;
  }
  await inngest.send({ name: "monitoring/brand-scan", data: input });
}
