import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuditExport } from "@/lib/audit/import-export";
import { closeTestDb, resetTestDb } from "./pg-test-db";

/**
 * A retried import must not duplicate results or double-count anything.
 */
describe("importing the same audit twice", () => {
  let audit: AuditExport;

  beforeAll(async () => {
    await resetTestDb();
    audit = JSON.parse(
      await readFile(
        path.join(process.cwd(), "tests/fixtures/free-audit-export.json"),
        "utf8",
      ),
    ) as AuditExport;
  });
  afterAll(async () => {
    await closeTestDb();
  });

  it("keeps exactly one set of answers, one score, one action list", async () => {
    const { importAuditExport } = await import("@/lib/audit/import-export");
    const { one } = await import("@/lib/db/pg");

    const first = await importAuditExport(audit, { scanType: "free" });
    // Same scan id, imported again — a worker retry after a crash between
    // import and settlement does exactly this.
    const second = await importAuditExport(audit, {
      scanType: "free",
      scanRunId: first.scanRunId,
      brandId: first.brandId,
    });
    expect(second.scanRunId).toBe(first.scanRunId);

    const answers = await one<{ n: number }>(
      `select count(*)::int as n from query_results where scan_run_id = $1`,
      [first.scanRunId],
    );
    expect(answers?.n).toBe(first.importedQueryResults);

    const scores = await one<{ n: number }>(
      `select count(*)::int as n from score_snapshots where scan_run_id = $1`,
      [first.scanRunId],
    );
    expect(scores?.n).toBe(1);

    const score = await one<{
      methodology_version: string | null;
      has_breakdown: boolean;
    }>(
      `select methodology_version, (breakdown is not null) as has_breakdown
       from score_snapshots where scan_run_id = $1`,
      [first.scanRunId],
    );
    expect(score?.methodology_version).toBeTruthy();
    expect(score?.has_breakdown).toBe(true);

    // Sentiment is never fabricated: the engine does not measure it.
    const sentiments = await one<{ n: number }>(
      `select count(*)::int as n from query_results
       where scan_run_id = $1 and brand_sentiment is not null`,
      [first.scanRunId],
    );
    expect(sentiments?.n).toBe(0);

    const questions = await one<{ n: number }>(
      `select count(*)::int as n from scan_questions where scan_run_id = $1`,
      [first.scanRunId],
    );
    expect(questions?.n).toBe(audit.prompt_matrix?.length ?? 0);
  });
});
