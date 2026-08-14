import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { exec } from "@/lib/db/pg";
import { log } from "@/lib/log";

/**
 * Retention sweep, run by the worker a few times a day. Nothing here touches
 * scores, answers, or anything a report renders - only raw artifacts and
 * bookkeeping that would otherwise grow forever.
 *
 * Periods (days, overridable by env):
 *   RETENTION_RUN_DIRS_DAYS      engine output folders on worker disk (14)
 *   RETENTION_EVENTS_DAYS        scan_run_events rows for finished scans (30)
 *   RETENTION_WEBHOOK_DAYS       webhook payload bodies (90; row + id kept)
 *   RETENTION_FREE_SCAN_DAYS     free_scan_requests abuse rows (90)
 */

const days = (name: string, fallback: number) =>
  Math.max(1, Number(process.env[name] ?? String(fallback)));

export async function runRetentionSweep(): Promise<void> {
  await sweepRunDirs().catch((error) =>
    log.warn("retention_run_dirs_failed", { error: String(error) }),
  );

  const eventsDays = days("RETENTION_EVENTS_DAYS", 30);
  const events = await exec(
    `delete from scan_run_events e
     using scan_runs s
     where s.id = e.scan_run_id
       and s.status in ('completed', 'partial', 'failed', 'cancelled', 'timed_out')
       and e.created_at < timezone('utc', now()) - make_interval(days => $1)`,
    [eventsDays],
  ).catch(() => 0);

  // Webhook rows stay (idempotency needs the ids); the raw payload bodies
  // age out because they can hold customer metadata.
  const webhookDays = days("RETENTION_WEBHOOK_DAYS", 90);
  const webhooks = await exec(
    `update webhook_events set payload = '{}'::jsonb
     where processed_at < timezone('utc', now()) - make_interval(days => $1)
       and payload <> '{}'::jsonb`,
    [webhookDays],
  ).catch(() => 0);

  await exec(
    `delete from rate_limits where window_start < now() - interval '2 days'`,
  ).catch(() => 0);

  const freeScanDays = days("RETENTION_FREE_SCAN_DAYS", 90);
  const freeScans = await exec(
    `delete from free_scan_requests
     where created_at < timezone('utc', now()) - make_interval(days => $1)`,
    [freeScanDays],
  ).catch(() => 0);

  if (events || webhooks || freeScans) {
    log.info("retention_sweep", { events, webhooks, freeScans });
  }
}

/** Engine output folders: keep recent runs (they back --resume-from), drop old. */
async function sweepRunDirs(): Promise<void> {
  const geoRoot =
    process.env.GEO_AUDIT_ROOT ?? path.resolve(process.cwd(), "../../GEO");
  const outputs = path.join(geoRoot, "outputs");
  const maxAgeMs = days("RETENTION_RUN_DIRS_DAYS", 14) * 86_400_000;
  const entries = await readdir(outputs, { withFileTypes: true }).catch(
    () => [],
  );
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    // Shared site-read cache manages its own TTL.
    if (entry.name.startsWith("_")) continue;
    const full = path.join(outputs, entry.name);
    try {
      const info = await stat(full);
      if (Date.now() - info.mtimeMs > maxAgeMs) {
        await rm(full, { recursive: true, force: true });
        removed += 1;
      }
    } catch {
      // Directory vanished mid-sweep; fine.
    }
  }
  if (removed > 0) log.info("retention_run_dirs", { removed });
}
