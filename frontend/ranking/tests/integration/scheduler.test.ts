import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeTestDb, resetTestDb } from "./pg-test-db";

describe("weekly monitoring scheduler", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("catches up a missed hour and still queues only once", async () => {
    const { exec, one } = await import("@/lib/db/pg");
    const { upsertBrand, upsertBrandMonitoringSettings } =
      await import("@/lib/db/repository");
    const { runSchedulerTick } = await import("@/worker/scheduler");
    const userId = "weekly-monitor-user";
    await exec(
      `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       values ($1, $1, $2, true, now(), now())`,
      [userId, "weekly@example.com"],
    );
    await exec(
      `insert into subscriptions (user_id, plan, status)
       values ($1, 'founder', 'active')`,
      [userId],
    );
    const brand = await upsertBrand({
      owner_id: userId,
      name: "Weekly Test",
      canonical_domain: "weekly-test.example",
      slug: "weekly-test",
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
    const now = new Date("2026-08-26T12:00:00.000Z"); // Wednesday
    await upsertBrandMonitoringSettings(brand.id, {
      enabled: true,
      monitoringFrequency: "weekly",
      dayOfWeek: 0, // Monday at 09:00 was missed.
      hourLocal: 9,
      timezone: "UTC",
      providers: ["openai_search"],
      monitoringQuestions: [
        "One question?",
        "Two question?",
        "Three question?",
        "Four question?",
        "Five question?",
      ],
      country: "US",
      language: "en",
      alerts: { scoreDrop: true, competitor: true, citation: true },
    });

    const first = await runSchedulerTick(now);
    const second = await runSchedulerTick(now);

    const queued = await one<{
      scan_type: string;
      trigger_source: string;
      total_queries: number;
      input_snapshot: { prompts: Array<{ prompt: string }> };
    }>(`select * from scan_runs where brand_id = $1`, [brand.id]);
    expect(queued?.scan_type).toBe("scheduled");
    expect(queued?.trigger_source).toBe("scheduled");
    expect(queued?.total_queries).toBe(5);
    expect(queued?.input_snapshot.prompts).toHaveLength(5);
    expect(first.enqueued).toBe(1);
    expect(second.alreadyQueued).toBe(1);
    expect(
      await one<{ count: number }>(
        `select count(*)::int as count from scan_runs where brand_id = $1`,
        [brand.id],
      ),
    ).toEqual({ count: 1 });
    expect(
      await one<{ units: number }>(
        `select coalesce(sum(units), 0)::int as units from usage_ledger
         where user_id = $1`,
        [userId],
      ),
    ).toEqual({ units: 5 });
  });

  it("limits Plus monitoring to one selected website", async () => {
    const { exec, one } = await import("@/lib/db/pg");
    const { upsertBrand, upsertBrandMonitoringSettings } =
      await import("@/lib/db/repository");
    const { runSchedulerTick } = await import("@/worker/scheduler");
    const userId = "two-brand-monitor-user";
    await exec(
      `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       values ($1, $1, $2, true, now(), now())`,
      [userId, "two-brand@example.com"],
    );
    await exec(
      `insert into subscriptions (user_id, plan, status)
       values ($1, 'founder', 'active')`,
      [userId],
    );

    const brands = [];
    for (let index = 1; index <= 3; index += 1) {
      brands.push(
        await upsertBrand({
          owner_id: userId,
          name: `Brand ${index}`,
          canonical_domain: `brand-${index}.example`,
          slug: `brand-${index}`,
          logo_url: null,
          description: null,
          category: null,
          target_audience: null,
          aliases: [],
          default_country: "US",
          default_language: "en",
          visibility: "private",
          claimed_at: null,
          metadata_confidence: null,
        }),
      );
    }

    const questions = ["One?", "Two?", "Three?", "Four?", "Five?"];
    for (const brand of brands.slice(1)) {
      await upsertBrandMonitoringSettings(brand.id, {
        enabled: true,
        monitoringFrequency: "weekly",
        dayOfWeek: 0,
        hourLocal: 9,
        timezone: "UTC",
        providers: ["openai_search"],
        monitoringQuestions: questions,
        country: "US",
        language: "en",
        alerts: { scoreDrop: true, competitor: true, citation: true },
      });
    }

    const result = await runSchedulerTick(new Date("2026-08-26T12:00:00.000Z"));
    expect(result.enqueued).toBe(1);
    expect(
      await one<{ count: number }>(
        `select count(*)::int as count from scan_runs where initiated_by = $1`,
        [userId],
      ),
    ).toEqual({ count: 1 });
  });
});
