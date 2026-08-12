import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuditExport } from "@/lib/audit/import-export";
import { closeTestDb, resetTestDb } from "./pg-test-db";

describe("an import that dies partway through", () => {
  let audit: AuditExport;

  beforeEach(async () => {
    await resetTestDb();
    audit = JSON.parse(
      await readFile(
        path.join(process.cwd(), "tests/fixtures/free-audit-export.json"),
        "utf8",
      ),
    ) as AuditExport;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("does not leave a finished-looking report with empty panels", async () => {
    // A Windows file lock killed an import between the answers and the score,
    // and the dashboard showed a completed audit with no competitors, no
    // actions and a dash where the score belongs.
    const repository = await import("@/lib/db/repository");
    const { importAuditExport } = await import("@/lib/audit/import-export");
    const failure = new Error("EPERM: operation not permitted, rename");
    (failure as NodeJS.ErrnoException).code = "EPERM";
    vi.spyOn(repository, "upsertScore").mockRejectedValueOnce(failure);

    await expect(importAuditExport(audit, { scanType: "free" })).rejects.toThrow(
      /EPERM/,
    );

    const { one } = await import("@/lib/db/pg");
    const scan = await one<{ id: string; brand_id: string; status: string }>(
      `select id, brand_id, status from scan_runs order by created_at desc limit 1`,
    );
    expect(scan).not.toBeNull();
    expect(scan!.status).toBe("running");

    // getLatestScanForBrand only offers finished audits, so a broken one is
    // never shown as a report.
    const latest = await repository.getLatestScanForBrand(scan!.brand_id);
    expect(latest).toBeNull();
  });

  it("marks the scan finished once every panel is stored", async () => {
    const repository = await import("@/lib/db/repository");
    const { importAuditExport } = await import("@/lib/audit/import-export");

    const result = await importAuditExport(audit, { scanType: "free" });

    const scan = await repository.getScanRun(result.scanRunId);
    expect(scan?.status).toBe("completed");
    const latest = await repository.getLatestScanForBrand(result.brandId);
    expect(latest?.scan.id).toBe(result.scanRunId);
  });
});
