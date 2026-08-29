import { exec, one, q, withTransaction } from "@/lib/db/pg";
import { getScanRun } from "@/lib/db/repository";
import type {
  Brand,
  ScanInputSnapshot,
  ScanRun,
  ScanStatus,
} from "@/types/database";

/**
 * The durable audit queue. scan_runs is the queue: a row with status
 * 'queued' is a job, the worker claims it with FOR UPDATE SKIP LOCKED, and
 * every state change is a row update. There is no in-memory state anywhere - 
 * any web instance and any worker sees the same truth.
 */

export const SCAN_HEARTBEAT_TIMEOUT_SECONDS = Number(
  process.env.SCAN_HEARTBEAT_TIMEOUT_SECONDS ?? "180",
);

/** A queued row nobody claimed after this long is dead, not "still starting". */
const STALE_QUEUED_MS = 15 * 60 * 1000;

/** Estimated provider checks for a scan: one question to one provider. */
export function estimatedChecks(snapshot: ScanInputSnapshot): number {
  return snapshot.assistants.length * snapshot.limit_per_assistant;
}

export type EnqueueScanInput = {
  brand: Brand;
  initiatedBy: string | null;
  scanType: "free" | "manual" | "scheduled";
  snapshot: ScanInputSnapshot;
  idempotencyKey?: string | null;
  /** Monthly allowance remaining, already computed under the caller's
   * entitlement check. Re-checked here inside the transaction. */
  checksLimit: number;
};

export type EnqueueScanResult =
  | { ok: true; scan: ScanRun; alreadyRunning: boolean }
  | { ok: false; status: number; error: string };

/**
 * The one way a scan enters the system. Atomic: the active-scan-per-brand
 * unique index makes double clicks join the existing run, the per-user
 * advisory lock makes concurrent requests see each other's reservations,
 * and the reservation row is written in the same transaction as the scan.
 */
export async function enqueueScan(
  input: EnqueueScanInput,
): Promise<EnqueueScanResult> {
  return withTransaction(async () => {
    // Operator controls are real controls: maintenance mode stops new work,
    // and a disabled provider is stripped from every new scan.
    const settings = await q<{ key: string; value: unknown }>(
      `select key, value from app_settings
       where key in ('maintenance_mode', 'providers_disabled')`,
    );
    const maintenance = settings.find((s) => s.key === "maintenance_mode");
    if (maintenance?.value === true) {
      return {
        ok: false,
        status: 503,
        error: "Audits are paused for maintenance. Try again shortly.",
      };
    }
    const disabledRow = settings.find((s) => s.key === "providers_disabled");
    const disabled = new Set(
      Array.isArray(disabledRow?.value) ? (disabledRow.value as string[]) : [],
    );
    if (disabled.size > 0) {
      input.snapshot.assistants = input.snapshot.assistants.filter(
        (provider) => !disabled.has(provider),
      );
      if (input.snapshot.assistants.length === 0) {
        return {
          ok: false,
          status: 503,
          error: "The requested AI providers are temporarily unavailable.",
        };
      }
    }

    // Serialize usage accounting per user so two concurrent requests cannot
    // both pass the allowance check before either reserves.
    if (input.initiatedBy) {
      await exec("select pg_advisory_xact_lock(hashtext($1), 729185)", [
        input.initiatedBy,
      ]);
    }

    if (input.idempotencyKey && input.initiatedBy) {
      const existing = await one<ScanRun>(
        `select * from scan_runs
         where initiated_by = $1 and idempotency_key = $2`,
        [input.initiatedBy, input.idempotencyKey],
      );
      if (existing) return { ok: true, scan: existing, alreadyRunning: true };
    }

    const active = await one<ScanRun>(
      `select * from scan_runs
       where brand_id = $1 and status in ('queued', 'running', 'cancel_requested')
       order by created_at desc limit 1`,
      [input.brand.id],
    );
    if (active) {
      const queuedAt = new Date(active.queued_at ?? active.created_at).getTime();
      const staleQueued =
        active.status === "queued" && Date.now() - queuedAt > STALE_QUEUED_MS;
      if (!staleQueued) {
        return { ok: true, scan: active, alreadyRunning: true };
      }
      await exec(
        `update scan_runs set
           status = 'cancelled', step = 'cancelled',
           cancel_requested_at = timezone('utc', now()),
           cancelled_at = timezone('utc', now()),
           completed_at = timezone('utc', now()),
           error_summary = 'Cancelled because the audit sat in queue too long.',
           failure_reason = 'stale_queue'
         where id = $1 and status = 'queued'`,
        [active.id],
      );
    }

    const reserve = estimatedChecks(input.snapshot);
    if (input.initiatedBy) {
      const period = new Date().toISOString().slice(0, 7);
      const used = await one<{ total: number }>(
        `select coalesce(sum(units), 0)::int as total
         from usage_ledger where user_id = $1 and billing_period = $2`,
        [input.initiatedBy, period],
      );
      if ((used?.total ?? 0) + reserve > input.checksLimit) {
        return {
          ok: false,
          status: 402,
          error: `This audit needs ${reserve} provider checks but only ${Math.max(
            input.checksLimit - (used?.total ?? 0),
            0,
          )} are left this month.`,
        };
      }
    }

    let scan: ScanRun;
    try {
      const inserted = await one<ScanRun>(
        `insert into scan_runs (
           brand_id, initiated_by, scan_type, status, provider_ids,
           total_queries, completed_queries, methodology_version, demo_mode,
           country, language, step, progress, queued_at, attempts,
           max_attempts, trigger_source, input_snapshot, idempotency_key,
           cost_ceiling_usd
         ) values (
           $1, $2, $3, 'queued', $4,
           $5, 0, 'pending', false,
           $6, $7, 'queued', 0, timezone('utc', now()), 0,
           $8, $9, $10, $11, $12
         ) returning *`,
        [
          input.brand.id,
          input.initiatedBy,
          input.scanType,
          JSON.stringify(input.snapshot.assistants),
          reserve,
          input.snapshot.country,
          input.snapshot.language,
          Number(process.env.SCAN_MAX_ATTEMPTS ?? "2"),
          input.snapshot.trigger_source,
          JSON.stringify(input.snapshot),
          input.idempotencyKey ?? null,
          input.snapshot.cost_ceiling_usd,
        ],
      );
      if (!inserted) throw new Error("Scan insert returned nothing.");
      scan = inserted;
    } catch (error) {
      // A concurrent request won the unique active-scan index. Join its run.
      if (isUniqueViolation(error)) {
        const winner = await one<ScanRun>(
          `select * from scan_runs
           where brand_id = $1 and status in ('queued', 'running', 'cancel_requested')
           order by created_at desc limit 1`,
          [input.brand.id],
        );
        if (winner) return { ok: true, scan: winner, alreadyRunning: true };
      }
      throw error;
    }

    if (input.initiatedBy) {
      await exec(
        `insert into usage_ledger
           (user_id, brand_id, scan_run_id, operation, units, estimated_cost, billing_period)
         values ($1, $2, $3, 'reserve_checks', $4, 0, $5)`,
        [
          input.initiatedBy,
          input.brand.id,
          scan.id,
          reserve,
          new Date().toISOString().slice(0, 7),
        ],
      );
    }

    return { ok: true, scan, alreadyRunning: false };
  });
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "23505"
  );
}

/**
 * Settle a scan's provider-check reservation against what actually ran.
 * Append-only: the settlement row adjusts the reserved units up or down so
 * reservation + settlement = actual usage. Idempotent via the unique index
 * on (scan_run_id, operation).
 */
export async function settleReservation(
  scan: ScanRun,
  actualUnits: number,
  actualCostUsd: number,
): Promise<void> {
  if (!scan.initiated_by) return;
  const reserved = await one<{ units: number; billing_period: string }>(
    `select units, billing_period from usage_ledger
     where scan_run_id = $1 and operation = 'reserve_checks'`,
    [scan.id],
  );
  if (!reserved) return;
  await exec(
    `insert into usage_ledger
       (user_id, brand_id, scan_run_id, operation, units, estimated_cost, billing_period)
     values ($1, $2, $3, 'settle_checks', $4, $5, $6)
     on conflict (scan_run_id, operation) where scan_run_id is not null
       and operation in ('reserve_checks', 'settle_checks')
     do nothing`,
    [
      scan.initiated_by,
      scan.brand_id,
      scan.id,
      actualUnits - reserved.units,
      actualCostUsd,
      reserved.billing_period,
    ],
  );
}

// ── Worker-side operations ──────────────────────────────────────────────────

/** Claim the oldest queued scan. Safe with any number of workers. */
export async function claimNextScan(
  workerId: string,
  workerVersion: string,
): Promise<ScanRun | null> {
  return one<ScanRun>(
    `update scan_runs set
       status = 'running',
       claimed_by = $1,
       claimed_at = timezone('utc', now()),
       started_at = coalesce(started_at, timezone('utc', now())),
       heartbeat_at = timezone('utc', now()),
       attempts = attempts + 1,
       worker_version = $2,
       step = 'starting',
       progress = 1
     where id = (
       select id from scan_runs
       where status = 'queued'
       order by queued_at nulls first, created_at
       limit 1
       for update skip locked
     )
     returning *`,
    [workerId, workerVersion],
  );
}

/**
 * Heartbeat. Returns the row's current status so the worker notices a
 * cancellation request without a second query.
 */
export async function heartbeatScan(
  scanId: string,
): Promise<ScanStatus | null> {
  const row = await one<{ status: ScanStatus }>(
    `update scan_runs set heartbeat_at = timezone('utc', now())
     where id = $1 returning status`,
    [scanId],
  );
  return row?.status ?? null;
}

export async function scanQueueSnapshot(): Promise<{
  queued: number;
  running: number;
  oldestQueuedSeconds: number;
}> {
  const row = await one<{
    queued: number;
    running: number;
    oldest_queued_seconds: number;
  }>(
    `select
       count(*) filter (where status = 'queued')::int as queued,
       count(*) filter (where status in ('running', 'cancel_requested'))::int as running,
       coalesce(extract(epoch from (
         now() - min(queued_at) filter (where status = 'queued')
       )), 0)::float as oldest_queued_seconds
     from scan_runs`,
  );
  return {
    queued: row?.queued ?? 0,
    running: row?.running ?? 0,
    oldestQueuedSeconds: Math.max(0, row?.oldest_queued_seconds ?? 0),
  };
}

/** Mark a claimed scan failed, or requeue it if attempts remain. */
export async function failOrRequeueScan(
  scanId: string,
  message: string,
  reason: string,
): Promise<"requeued" | "failed"> {
  const requeued = await one<{ id: string }>(
    `update scan_runs set
       status = 'queued', claimed_by = null, claimed_at = null,
       heartbeat_at = null, step = 'queued', progress = 0,
       last_error_at = timezone('utc', now()),
       error_summary = $2, failure_reason = $3
     where id = $1 and attempts < max_attempts
       and status in ('running', 'cancel_requested')
       and cancel_requested_at is null
     returning id`,
    [scanId, message, reason],
  );
  if (requeued) return "requeued";
  await exec(
    `update scan_runs set
       status = case when cancel_requested_at is not null then 'cancelled' else 'failed' end,
       cancelled_at = case when cancel_requested_at is not null then timezone('utc', now()) else cancelled_at end,
       step = 'failed',
       completed_at = timezone('utc', now()),
       last_error_at = timezone('utc', now()),
       error_summary = $2, failure_reason = $3
     where id = $1 and status in ('running', 'cancel_requested')`,
    [scanId, message, reason],
  );
  return "failed";
}

/** Mark a claimed scan cancelled after the worker stopped its child. */
export async function markScanCancelled(scanId: string): Promise<void> {
  await exec(
    `update scan_runs set
       status = 'cancelled', step = 'cancelled',
       cancelled_at = timezone('utc', now()),
       completed_at = timezone('utc', now())
     where id = $1 and status in ('running', 'cancel_requested', 'queued')`,
    [scanId],
  );
}

/**
 * Close out scans whose worker went silent. Requeues when attempts remain,
 * otherwise marks timed_out. Runs on every worker loop tick; harmless to run
 * from several workers at once.
 */
export async function reapStaleScans(): Promise<number> {
  const rows = await q<{ id: string; outcome: string }>(
    `update scan_runs set
       status = case when attempts < max_attempts and cancel_requested_at is null
                     then 'queued' else 'timed_out' end,
       claimed_by = null, claimed_at = null, heartbeat_at = null,
       step = case when attempts < max_attempts and cancel_requested_at is null
                   then 'queued' else 'failed' end,
       completed_at = case when attempts < max_attempts and cancel_requested_at is null
                          then completed_at else timezone('utc', now()) end,
       last_error_at = timezone('utc', now()),
       failure_reason = 'heartbeat_timeout',
       error_summary = 'The worker running this audit stopped responding.'
     where status in ('running', 'cancel_requested')
       and heartbeat_at < timezone('utc', now()) - make_interval(secs => $1)
     returning id, status as outcome`,
    [SCAN_HEARTBEAT_TIMEOUT_SECONDS],
  );
  return rows.length;
}

/**
 * Ask for a running or queued scan to stop. Queued scans cancel instantly;
 * running ones flip to cancel_requested and the worker kills the pipeline at
 * its next heartbeat.
 */
export async function requestScanCancel(
  scanId: string,
): Promise<ScanStatus | null> {
  const queued = await one<{ status: ScanStatus }>(
    `update scan_runs set
       status = 'cancelled', step = 'cancelled',
       cancel_requested_at = timezone('utc', now()),
       cancelled_at = timezone('utc', now()),
       completed_at = timezone('utc', now())
     where id = $1 and status = 'queued'
     returning status`,
    [scanId],
  );
  if (queued) return queued.status;
  const running = await one<{ status: ScanStatus }>(
    `update scan_runs set
       status = 'cancel_requested',
       cancel_requested_at = timezone('utc', now())
     where id = $1 and status = 'running'
     returning status`,
    [scanId],
  );
  if (running) return running.status;
  return (await getScanRun(scanId))?.status ?? null;
}

/** Cancel every active scan a user owns (account deletion). */
export async function cancelActiveScansForUser(userId: string): Promise<void> {
  const rows = await q<{ id: string }>(
    `select s.id from scan_runs s
     join brands b on b.id = s.brand_id
     where (s.initiated_by = $1 or b.owner_id = $1)
       and s.status in ('queued', 'running')`,
    [userId],
  );
  for (const row of rows) {
    await requestScanCancel(row.id);
  }
}

/**
 * Re-enqueue a finished scan using its stored input snapshot. Never crosses
 * engines and never picks up settings changed since the original click.
 */
export async function retryScan(
  scanId: string,
  requestedBy: string,
): Promise<EnqueueScanResult> {
  const scan = await getScanRun(scanId);
  if (!scan) return { ok: false, status: 404, error: "Scan not found." };
  if (!scan.input_snapshot) {
    return {
      ok: false,
      status: 409,
      error:
        "This scan predates input snapshots and cannot be retried directly. Start a new audit instead.",
    };
  }
  if (!["failed", "timed_out", "cancelled", "partial"].includes(scan.status)) {
    return { ok: false, status: 409, error: "This scan is not retryable." };
  }
  const requeued = await one<ScanRun>(
    `update scan_runs set
       status = 'queued', step = 'queued', progress = 0,
       queued_at = timezone('utc', now()),
       claimed_by = null, claimed_at = null, heartbeat_at = null,
       cancel_requested_at = null, cancelled_at = null,
       completed_at = null, error_summary = null, failure_reason = null,
       attempts = 0
     where id = $1
       and status in ('failed', 'timed_out', 'cancelled', 'partial')
       and not exists (
         select 1 from scan_runs other
         where other.brand_id = scan_runs.brand_id
           and other.id <> scan_runs.id
           and other.status in ('queued', 'running', 'cancel_requested')
       )
     returning *`,
    [scanId],
  );
  if (!requeued) {
    return {
      ok: false,
      status: 409,
      error: "Another audit for this website is already in progress.",
    };
  }
  void requestedBy;
  return { ok: true, scan: requeued, alreadyRunning: false };
}

// ── Durable progress events ─────────────────────────────────────────────────

export type ScanEvent = {
  seq: number;
  at: string;
  step: string;
  progress: number;
  message: string | null;
  assistant: string | null;
  questions: string[];
};

export async function recordScanEvent(
  scanRunId: string,
  event: Omit<ScanEvent, "seq" | "at">,
): Promise<void> {
  // seq assigned atomically from the current max; the unique (scan, seq)
  // index means two writers can never produce the same number.
  await exec(
    `insert into scan_run_events (scan_run_id, seq, step, progress, message, assistant, questions)
     select $1, coalesce(max(seq), 0) + 1, $2, $3, $4, $5, $6
     from scan_run_events where scan_run_id = $1
     on conflict (scan_run_id, seq) do nothing`,
    [
      scanRunId,
      event.step,
      event.progress,
      event.message,
      event.assistant,
      JSON.stringify(event.questions ?? []),
    ],
  );
}

export async function getScanEvents(
  scanRunId: string,
  afterSeq = 0,
  limit = 200,
): Promise<ScanEvent[]> {
  return q<ScanEvent>(
    `select seq, created_at as at, step, progress, message, assistant, questions
     from scan_run_events
     where scan_run_id = $1 and seq > $2
     order by seq
     limit $3`,
    [scanRunId, afterSeq, limit],
  );
}
