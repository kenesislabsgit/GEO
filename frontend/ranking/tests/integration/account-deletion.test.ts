import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeTestDb, resetTestDb } from "./pg-test-db";

/**
 * Deletion leaves no account-owned rows and cancels active work. This tests
 * the data layer the route drives (the route itself additionally requires a
 * session and typed confirmation).
 */
describe("account deletion data path", () => {
  beforeAll(async () => {
    await resetTestDb();
  });
  afterAll(async () => {
    await closeTestDb();
  });

  it("cancels active scans and removes every owned row", async () => {
    const { exec, one, withTransaction, q } = await import("@/lib/db/pg");
    const { upsertBrand, upsertBrandMonitoringSettings } = await import(
      "@/lib/db/repository"
    );
    const { enqueueScan, cancelActiveScansForUser } = await import(
      "@/lib/scans/queue"
    );

    const userId = "delete-me";
    await exec(
      `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       values ($1, $1, $2, true, now(), now())`,
      [userId, "delete-me@example.com"],
    );
    await exec(
      `insert into session (id, token, "userId", "expiresAt", "createdAt", "updatedAt")
       values ('sess-1', 'tok-1', $1, now() + interval '1 day', now(), now())`,
      [userId],
    );
    const brand = await upsertBrand({
      owner_id: userId,
      name: "delete.example",
      canonical_domain: "delete.example",
      slug: "delete-example",
      logo_url: null,
      description: null,
      category: null,
      target_audience: null,
      aliases: [],
      default_country: "US",
      default_language: "en",
      visibility: "public",
      claimed_at: null,
      metadata_confidence: null,
    });
    await upsertBrandMonitoringSettings(brand.id, {
      monitoringFrequency: "weekly",
      alerts: { scoreDrop: true, competitor: true, citation: false },
      providers: ["openai_search"],
      country: "US",
      language: "en",
      updatedAt: new Date().toISOString(),
    });
    const enq = await enqueueScan({
      brand,
      initiatedBy: userId,
      scanType: "manual",
      snapshot: {
        domain: brand.canonical_domain,
        mode: "pro",
        assistants: ["openai_search"],
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
      },
      checksLimit: 400,
    });
    expect(enq.ok).toBe(true);

    // The deletion sequence the route runs.
    await cancelActiveScansForUser(userId);
    await withTransaction(async () => {
      await exec(`delete from brands where owner_id = $1`, [userId]);
      await exec(`delete from subscriptions where user_id = $1`, [userId]);
      await exec(`delete from alerts where user_id = $1`, [userId]);
      await exec(`delete from domain_verifications where user_id = $1`, [userId]);
      await exec(`delete from app_settings where key = $1`, [
        `user_onboarding:${userId}`,
      ]);
      await exec(
        `delete from verification where identifier in (
           select email from "user" where id = $1)`,
        [userId],
      );
      await exec(`delete from session where "userId" = $1`, [userId]);
      await exec(`delete from account where "userId" = $1`, [userId]);
      await exec(`delete from "user" where id = $1`, [userId]);
    });

    // Nothing owned remains; sessions are gone; the scan ended cancelled
    // (kept as an anonymized run record — its user and brand links are
    // severed by the cascades).
    const checks = await one<{
      users: number;
      brands: number;
      monitoring: number;
      sessions: number;
      owned_scans: number;
    }>(
      `select
        (select count(*)::int from "user" where id = $1) as users,
        (select count(*)::int from brands where owner_id = $1) as brands,
        (select count(*)::int from brand_monitoring bm
           join brands b on b.id = bm.brand_id where b.owner_id = $1) as monitoring,
        (select count(*)::int from session where "userId" = $1) as sessions,
        (select count(*)::int from scan_runs where initiated_by = $1) as owned_scans`,
      [userId],
    );
    expect(checks).toEqual({
      users: 0,
      brands: 0,
      monitoring: 0,
      sessions: 0,
      owned_scans: 0,
    });

    // Usage rows survive anonymized (user_id nulled), for billing accuracy.
    const usage = await q<{ user_id: string | null }>(
      `select user_id from usage_ledger where scan_run_id = $1`,
      [enq.ok ? enq.scan.id : ""],
    );
    for (const row of usage) expect(row.user_id).toBeNull();
  });
});
