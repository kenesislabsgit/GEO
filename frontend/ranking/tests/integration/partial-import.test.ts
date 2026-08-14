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

  it("rolls the whole import back when any step fails", async () => {
    // A Windows file lock once killed an import between the answers and the
    // score, and the dashboard showed a completed audit with empty panels.
    // The import is one transaction now: a failure anywhere means nothing at
    // all was written — no brand, no scan, no half-replaced prompts.
    const repository = await import("@/lib/db/repository");
    const { importAuditExport } = await import("@/lib/audit/import-export");
    const failure = new Error("EPERM: operation not permitted, rename");
    (failure as NodeJS.ErrnoException).code = "EPERM";
    vi.spyOn(repository, "upsertScore").mockRejectedValueOnce(failure);

    await expect(importAuditExport(audit, { scanType: "free" })).rejects.toThrow(
      /EPERM/,
    );

    const { one } = await import("@/lib/db/pg");
    const scan = await one<{ id: string }>(
      `select id from scan_runs order by created_at desc limit 1`,
    );
    expect(scan).toBeNull();
    const brand = await one<{ id: string }>(`select id from brands limit 1`);
    expect(brand).toBeNull();
    const prompts = await one<{ id: string }>(
      `select id from tracked_prompts limit 1`,
    );
    expect(prompts).toBeNull();
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
