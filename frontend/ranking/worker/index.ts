import "./env";
import http from "node:http";
import os from "node:os";
import { validateEnv } from "@/lib/env";

validateEnv("worker");
import { one } from "@/lib/db/pg";
import {
  claimNextScan,
  failOrRequeueScan,
  heartbeatScan,
  markScanCancelled,
  reapStaleScans,
} from "@/lib/scans/queue";
import { exec } from "@/lib/db/pg";
import { log } from "@/lib/log";
import { runSchedulerTick } from "./scheduler";
import { startAuditRun, type RunningAudit } from "./run-audit";
import { runRetentionSweep } from "./retention";
import { reconcileSubscriptions } from "./reconcile";
import { detectAlertsForScan } from "./alerts";
import { getScanRun } from "@/lib/db/repository";

/**
 * The audit worker. Deployed separately from the web app; the web app only
 * writes queued rows and reads progress. Everything durable lives in
 * Postgres - this process can die at any moment and another instance picks
 * the work back up.
 *
 * Run: npm run worker
 */

const WORKER_ID = `${os.hostname()}-${process.pid}`;
const WORKER_VERSION = process.env.WORKER_VERSION ?? "dev";
const CONCURRENCY = Math.max(1, Number(process.env.WORKER_CONCURRENCY ?? "2"));
const POLL_MS = Math.max(500, Number(process.env.WORKER_POLL_MS ?? "3000"));
const HEARTBEAT_MS = 15_000;
const SCHEDULER_EVERY_MS = 5 * 60_000;
const RETENTION_EVERY_MS = 6 * 3_600_000;

type ActiveJob = {
  scanId: string;
  audit: RunningAudit;
  heartbeat: NodeJS.Timeout;
};

const active = new Map<string, ActiveJob>();
let shuttingDown = false;
let lastSchedulerAt = 0;
let lastRetentionAt = 0;

async function startJob(scanId: string, audit: RunningAudit): Promise<void> {
  const heartbeat = setInterval(async () => {
    try {
      const status = await heartbeatScan(scanId);
      if (status === "cancel_requested") {
        log.info("scan_cancelling", { scanId, workerId: WORKER_ID });
        audit.kill();
      }
    } catch (error) {
      log.warn("heartbeat_failed", {
        scanId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, HEARTBEAT_MS);

  active.set(scanId, { scanId, audit, heartbeat });

  const startedAt = Date.now();
  try {
    const result = await audit.done;
    const durationMs = Date.now() - startedAt;
    if (result.ok) {
      log.info("scan_completed", { scanId, workerId: WORKER_ID, durationMs });
    } else if (result.reason === "cancelled") {
      await markScanCancelled(scanId);
      log.info("scan_cancelled", { scanId, workerId: WORKER_ID, durationMs });
    } else {
      const outcome = await failOrRequeueScan(
        scanId,
        result.message,
        result.reason,
      );
      log.warn("scan_failed", {
        scanId,
        workerId: WORKER_ID,
        durationMs,
        reason: result.reason,
        outcome,
      });
    }
  } catch (error) {
    await failOrRequeueScan(
      scanId,
      "The audit failed unexpectedly.",
      "worker_exception",
    ).catch(() => {});
    log.error("scan_exception", {
      scanId,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    clearInterval(heartbeat);
    active.delete(scanId);
    // Alert detection runs on the final state, whatever it was. A requeued
    // scan is not final, so detection skips it (status is 'queued').
    try {
      const finished = await getScanRun(scanId);
      if (
        finished &&
        ["completed", "partial", "failed", "timed_out"].includes(finished.status)
      ) {
        await detectAlertsForScan(finished);
      }
    } catch (error) {
      log.warn("alert_detection_failed", {
        scanId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

async function loop(): Promise<void> {
  while (!shuttingDown) {
    try {
      const reaped = await reapStaleScans();
      if (reaped > 0) log.warn("stale_scans_reaped", { count: reaped });

      if (Date.now() - lastSchedulerAt > SCHEDULER_EVERY_MS) {
        lastSchedulerAt = Date.now();
        await runSchedulerTick();
      }
      if (Date.now() - lastRetentionAt > RETENTION_EVERY_MS) {
        lastRetentionAt = Date.now();
        await runRetentionSweep();
        await reconcileSubscriptions();
      }

      while (active.size < CONCURRENCY && !shuttingDown) {
        const scan = await claimNextScan(WORKER_ID, WORKER_VERSION);
        if (!scan) break;
        log.info("scan_claimed", {
          scanId: scan.id,
          workerId: WORKER_ID,
          attempt: scan.attempts,
          trigger: scan.trigger_source ?? scan.scan_type,
        });
        void startJob(scan.id, startAuditRun(scan));
      }
    } catch (error) {
      log.error("worker_loop_error", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

/** /healthz = liveness (DB reachable); /readyz = ready to take work. */
function startHealthServer(): http.Server {
  const port = Number(process.env.WORKER_HEALTH_PORT ?? "8787");
  const server = http.createServer(async (req, res) => {
    if (req.url === "/healthz" || req.url === "/readyz") {
      try {
        await one("select 1 as ok");
        const body = JSON.stringify({
          ok: true,
          workerId: WORKER_ID,
          version: WORKER_VERSION,
          activeJobs: active.size,
          shuttingDown,
        });
        res.writeHead(shuttingDown && req.url === "/readyz" ? 503 : 200, {
          "content-type": "application/json",
        });
        res.end(body);
      } catch {
        res.writeHead(503, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false }));
      }
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.listen(port, () => log.info("worker_health_listening", { port }));
  return server;
}

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info("worker_shutdown", { signal, activeJobs: active.size });

  // Stop the children and hand their jobs back to the queue. A graceful
  // shutdown is not the job's fault, so the attempt is refunded.
  for (const job of active.values()) {
    job.audit.kill();
    await exec(
      `update scan_runs set
         status = 'queued', step = 'queued', progress = 0,
         claimed_by = null, claimed_at = null, heartbeat_at = null,
         attempts = greatest(attempts - 1, 0),
         queued_at = timezone('utc', now())
       where id = $1 and status in ('running', 'cancel_requested')
         and cancel_requested_at is null`,
      [job.scanId],
    ).catch(() => {});
  }

  // Give kills a moment to land, then exit.
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

log.info("worker_started", {
  workerId: WORKER_ID,
  version: WORKER_VERSION,
  concurrency: CONCURRENCY,
});
startHealthServer();
void loop();
