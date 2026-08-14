import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeTestDb, resetTestDb } from "./pg-test-db";
import type { Brand, ScanInputSnapshot } from "@/types/database";

/**
 * The durable queue's contracts, proven against a real Postgres:
 * enqueue is atomic and idempotent, one active scan per brand survives
 * races, claims are exclusive, cancellation and the reaper work, and
 * reservations settle exactly once.
 */

async function makeUser(id: string): Promise<string> {
  const { exec } = await import("@/lib/db/pg");
  await exec(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     values ($1, $1, $2, true, now(), now())
     on conflict (id) do nothing`,
    [id, `${id}@example.com`],
  );
  return id;
}

async function makeBrand(ownerId: string, domain: string): Promise<Brand> {
  const { upsertBrand } = await import("@/lib/db/repository");
  return upsertBrand({
    owner_id: ownerId,
    name: domain,
    canonical_domain: domain,
    slug: domain.replace(/[^a-z0-9]+/g, "-"),
    logo_url: null,
    description: null,
    category: null,
    target_audience: null,
    aliases: [domain],
    default_country: "US",
    default_language: "en",
    visibility: "public",
    claimed_at: null,
    metadata_confidence: null,
  });
}

function snapshot(domain: string): ScanInputSnapshot {
  return {
    domain,
    mode: "pro",
    assistants: ["openai_search", "bedrock_claude"],
    limit_per_assistant: 5,
    prompts: [],
    country: "us",
    language: "en",
    geo_market: false,
    geo_market_name: null,
    ip_hash: null,
    plan: "founder",
    question_count: 5,
    methodology_version_requested: null,
    trigger_source: "manual",
    cost_ceiling_usd: 2.5,
    resume: false,
  };
}

describe("the durable scan queue", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("enqueues once and reserves the provider checks", async () => {
    const { enqueueScan } = await import("@/lib/scans/queue");
    const { one } = await import("@/lib/db/pg");
    const user = await makeUser("queue-user-1");
    const brand = await makeBrand(user, "queue-one.example");

    const result = await enqueueScan({
      brand,
      initiatedBy: user,
      scanType: "manual",
      snapshot: snapshot(brand.canonical_domain),
      checksLimit: 400,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scan.status).toBe("queued");
    expect(result.alreadyRunning).toBe(false);

    const reservation = await one<{ units: number }>(
      `select units from usage_ledger where scan_run_id = $1 and operation = 'reserve_checks'`,
      [result.scan.id],
    );
    expect(reservation?.units).toBe(10); // 2 providers × 5 questions
  });

  it("returns the same scan for the same idempotency key", async () => {
    const { enqueueScan } = await import("@/lib/scans/queue");
    const user = await makeUser("queue-user-2");
    const brand = await makeBrand(user, "queue-idem.example");

    const first = await enqueueScan({
      brand,
      initiatedBy: user,
      scanType: "manual",
      snapshot: snapshot(brand.canonical_domain),
      idempotencyKey: "click-abc",
      checksLimit: 400,
    });
    const second = await enqueueScan({
      brand,
      initiatedBy: user,
      scanType: "manual",
      snapshot: snapshot(brand.canonical_domain),
      idempotencyKey: "click-abc",
      checksLimit: 400,
    });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.scan.id).toBe(first.scan.id);
    expect(second.alreadyRunning).toBe(true);
  });

  it("refuses a second concurrent scan for the same brand", async () => {
    const { enqueueScan } = await import("@/lib/scans/queue");
    const user = await makeUser("queue-user-3");
    const brand = await makeBrand(user, "queue-race.example");

    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        enqueueScan({
          brand,
          initiatedBy: user,
          scanType: "manual",
          snapshot: snapshot(brand.canonical_domain),
          idempotencyKey: `race-${i}`,
          checksLimit: 400,
        }),
      ),
    );
    const ok = results.filter((r) => r.ok);
    expect(ok).toHaveLength(5);
    const ids = new Set(ok.map((r) => (r.ok ? r.scan.id : "")));
    expect(ids.size).toBe(1);
    const created = ok.filter((r) => r.ok && !r.alreadyRunning);
    expect(created).toHaveLength(1);
  });

  it("refuses when the monthly allowance cannot cover the reservation", async () => {
    const { enqueueScan } = await import("@/lib/scans/queue");
    const user = await makeUser("queue-user-4");
    const brand = await makeBrand(user, "queue-broke.example");

    const result = await enqueueScan({
      brand,
      initiatedBy: user,
      scanType: "manual",
      snapshot: snapshot(brand.canonical_domain),
      checksLimit: 5, // needs 10
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(402);
  });

  it("claims exclusively and heartbeats report cancellation", async () => {
    const { enqueueScan, claimNextScan, heartbeatScan, requestScanCancel } =
      await import("@/lib/scans/queue");
    const user = await makeUser("queue-user-5");
    const brand = await makeBrand(user, "queue-claim.example");
    const enq = await enqueueScan({
      brand,
      initiatedBy: user,
      scanType: "manual",
      snapshot: snapshot(brand.canonical_domain),
      checksLimit: 400,
    });
    expect(enq.ok).toBe(true);

    const claimed = await claimNextScan("worker-a", "test");
    expect(claimed).not.toBeNull();
    expect(claimed?.status).toBe("running");
    expect(claimed?.attempts).toBe(1);

    const second = await claimNextScan("worker-b", "test");
    expect(second).toBeNull();

    await requestScanCancel(claimed!.id);
    const status = await heartbeatScan(claimed!.id);
    expect(status).toBe("cancel_requested");
  });

  it("cancels a queued scan instantly", async () => {
    const { enqueueScan, requestScanCancel } = await import("@/lib/scans/queue");
    const { getScanRun } = await import("@/lib/db/repository");
    const user = await makeUser("queue-user-6");
    const brand = await makeBrand(user, "queue-cancel.example");
    const enq = await enqueueScan({
      brand,
      initiatedBy: user,
      scanType: "manual",
      snapshot: snapshot(brand.canonical_domain),
      checksLimit: 400,
    });
    if (!enq.ok) throw new Error("enqueue failed");

    const status = await requestScanCancel(enq.scan.id);
    expect(status).toBe("cancelled");
    const stored = await getScanRun(enq.scan.id);
    expect(stored?.status).toBe("cancelled");
    expect(stored?.cancelled_at).toBeTruthy();
  });

  it("reaps silent workers and requeues while attempts remain", async () => {
    const { enqueueScan, claimNextScan, reapStaleScans } = await import(
      "@/lib/scans/queue"
    );
    const { exec } = await import("@/lib/db/pg");
    const { getScanRun } = await import("@/lib/db/repository");
    const user = await makeUser("queue-user-7");
    const brand = await makeBrand(user, "queue-reap.example");
    const enq = await enqueueScan({
      brand,
      initiatedBy: user,
      scanType: "manual",
      snapshot: snapshot(brand.canonical_domain),
      checksLimit: 400,
    });
    if (!enq.ok) throw new Error("enqueue failed");

    const claimed = await claimNextScan("worker-dead", "test");
    expect(claimed).not.toBeNull();
    // Simulate a worker that stopped heartbeating half an hour ago.
    await exec(
      `update scan_runs set heartbeat_at = timezone('utc', now()) - interval '30 minutes' where id = $1`,
      [claimed!.id],
    );

    const reaped = await reapStaleScans();
    expect(reaped).toBe(1);
    const requeued = await getScanRun(claimed!.id);
    expect(requeued?.status).toBe("queued"); // attempt 1 of 2 → back in queue

    const claimedAgain = await claimNextScan("worker-alive", "test");
    expect(claimedAgain?.id).toBe(claimed!.id);
    expect(claimedAgain?.attempts).toBe(2);
    await exec(
      `update scan_runs set heartbeat_at = timezone('utc', now()) - interval '30 minutes' where id = $1`,
      [claimed!.id],
    );
    await reapStaleScans();
    const dead = await getScanRun(claimed!.id);
    expect(dead?.status).toBe("timed_out"); // attempts exhausted
  });

  it("settles a reservation exactly once", async () => {
    const { enqueueScan, claimNextScan, settleReservation } = await import(
      "@/lib/scans/queue"
    );
    const { q } = await import("@/lib/db/pg");
    const user = await makeUser("queue-user-8");
    const brand = await makeBrand(user, "queue-settle.example");
    const enq = await enqueueScan({
      brand,
      initiatedBy: user,
      scanType: "manual",
      snapshot: snapshot(brand.canonical_domain),
      checksLimit: 400,
    });
    if (!enq.ok) throw new Error("enqueue failed");
    const claimed = await claimNextScan("worker-s", "test");

    await settleReservation(claimed!, 7, 0.21); // 7 of 10 reserved ran
    await settleReservation(claimed!, 7, 0.21); // retry must be a no-op

    const rows = await q<{ operation: string; units: number }>(
      `select operation, units from usage_ledger where scan_run_id = $1 order by operation`,
      [claimed!.id],
    );
    expect(rows).toHaveLength(2);
    const total = rows.reduce((sum, row) => sum + row.units, 0);
    expect(total).toBe(7); // reserve 10 + settle −3
  });

  it("retries only from the stored snapshot", async () => {
    const { enqueueScan, claimNextScan, failOrRequeueScan, retryScan } =
      await import("@/lib/scans/queue");
    const { exec } = await import("@/lib/db/pg");
    const { getScanRun } = await import("@/lib/db/repository");
    const user = await makeUser("queue-user-9");
    const brand = await makeBrand(user, "queue-retry.example");
    const enq = await enqueueScan({
      brand,
      initiatedBy: user,
      scanType: "manual",
      snapshot: snapshot(brand.canonical_domain),
      checksLimit: 400,
    });
    if (!enq.ok) throw new Error("enqueue failed");
    const claimed = await claimNextScan("worker-r", "test");
    // Exhaust attempts so the failure is terminal.
    await exec(`update scan_runs set attempts = max_attempts where id = $1`, [
      claimed!.id,
    ]);
    const outcome = await failOrRequeueScan(
      claimed!.id,
      "The audit engine stopped before finishing.",
      "exit_1",
    );
    expect(outcome).toBe("failed");

    const retried = await retryScan(claimed!.id, user);
    expect(retried.ok).toBe(true);
    const stored = await getScanRun(claimed!.id);
    expect(stored?.status).toBe("queued");
    expect(stored?.attempts).toBe(0);
    expect(stored?.input_snapshot?.domain).toBe("queue-retry.example");
  });
});
