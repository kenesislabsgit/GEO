import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeTestDb, resetTestDb } from "./pg-test-db";
import type { ScanRun } from "@/types/database";

describe("monitoring alerts", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("waits for two matching changes before alerting", async () => {
    const { exec, one, q } = await import("@/lib/db/pg");
    const { upsertBrand, upsertBrandMonitoringSettings } =
      await import("@/lib/db/repository");
    const { detectAlertsForScan } = await import("@/worker/alerts");
    const userId = "alert-test-user";
    await exec(
      `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       values ($1, $1, $2, true, now(), now())`,
      [userId, "alerts@example.com"],
    );
    const brand = await upsertBrand({
      owner_id: userId,
      name: "Alert Test",
      canonical_domain: "alert-test.example",
      slug: "alert-test",
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
      providers: ["openai_search"],
      monitoringQuestions: ["Same buyer question"],
      alerts: { scoreDrop: true, competitor: true, citation: true },
    });

    const snapshot = JSON.stringify({
      assistants: ["openai_search"],
      prompts: [{ id: "q1", prompt: "Same buyer question" }],
      country: "US",
      language: "en",
    });
    async function addRun(
      daysAgo: number,
      score: number,
      mentionRate: number,
      competitors: string[],
      citation: string,
    ): Promise<ScanRun> {
      const run = await one<ScanRun>(
        `insert into scan_runs
           (brand_id, initiated_by, scan_type, status, provider_ids,
            total_queries, completed_queries, methodology_version, country,
            language, input_snapshot, completed_at, created_at)
         values ($1, $2, 'scheduled', 'completed', '["openai_search"]',
                 1, 1, 'test', 'US', 'en', $3,
                 now() - ($4 * interval '1 day'),
                 now() - ($4 * interval '1 day')) returning *`,
        [brand.id, userId, snapshot, daysAgo],
      );
      if (!run) throw new Error("Could not create alert test run.");
      await exec(
        `insert into score_snapshots
           (brand_id, scan_run_id, overall_score, mention_score,
            position_score, citation_score, sentiment_score, mention_rate,
            share_of_voice, competitor_scores, created_at)
         values ($1, $2, $3, 0, 0, 0, 0, $4, 0, $5,
                 now() - ($6 * interval '1 day'))`,
        [
          brand.id,
          run.id,
          score,
          mentionRate,
          JSON.stringify(competitors.map((name) => ({ name }))),
          daysAgo,
        ],
      );
      await exec(
        `insert into query_results
           (scan_run_id, provider, model, citations)
         values ($1, 'openai_search', 'test', $2)`,
        [run.id, JSON.stringify([{ domain: citation }])],
      );
      return run;
    }

    await addRun(3, 60, 0.5, [], "old.example");
    const second = await addRun(2, 48, 0, ["Stable Rival"], "new.example");
    await detectAlertsForScan(second);
    expect(
      await one<{ count: number }>(
        `select count(*)::int as count from alerts where user_id = $1`,
        [userId],
      ),
    ).toEqual({ count: 0 });

    const third = await addRun(1, 47, 0, ["Stable Rival"], "new.example");
    await detectAlertsForScan(third);
    const types = await q<{ type: string }>(
      `select type from alerts where user_id = $1 order by type`,
      [userId],
    );
    expect(types.map((item) => item.type)).toEqual([
      "citation_gained",
      "citation_lost",
      "competitor_appeared",
      "mention_lost",
      "score_change",
    ]);
  });
});
