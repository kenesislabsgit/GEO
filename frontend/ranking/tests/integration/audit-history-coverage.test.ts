import { afterAll, beforeAll, expect, it } from "vitest";
import audit from "@/tests/fixtures/free-audit-export.json";
import { resetTestDb, closeTestDb } from "./pg-test-db";

beforeAll(resetTestDb);
afterAll(closeTestDb);
it("keeps SQL history counts consistent with details and resets comparisons for partial coverage", async () => {
  const { importAuditExport } = await import("@/lib/audit/import-export");
  const repo = await import("@/lib/db/repository");
  const { exec } = await import("@/lib/db/pg");
  const { auditCoverage } = await import("@/lib/audit/coverage");
  const first = await importAuditExport(audit);
  const second = await importAuditExport(audit, { brandId: first.brandId });
  let rows = await repo.listScanHistoryForBrands([first.brandId]);
  expect(rows).toHaveLength(2);
  expect(rows[0].question_count).toBe(5);
  expect(rows[0].successful_checks).toBe(5);
  expect(rows[0].sample_key).toBeTruthy();
  expect(rows[0].sample_key).toBe(rows[1].sample_key);
  await exec(
    `update scan_runs set status='partial', input_snapshot=$2 where id=$1`,
    [
      second.scanRunId,
      JSON.stringify({
        question_count: 5,
        assistants: ["openai_search", "claude"],
      }),
    ],
  );
  rows = await repo.listScanHistoryForBrands([first.brandId]);
  const row = rows.find((row) => row.id === second.scanRunId)!;
  const coverage = auditCoverage(
    (await repo.getScanRun(row.id))!,
    await repo.getQueryResults(row.id),
    await repo.getScanQuestions(row.id),
  );
  expect(row.requested_checks).toBe(10);
  expect(row.successful_checks).toBe(coverage.successful);
  expect(row.question_count).toBe(coverage.questions);
  expect(row.sample_key).toBeNull();
  expect(coverage.missing).toBe(5);
});
