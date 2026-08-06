import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuditExport } from "@/lib/audit/import-export";

/**
 * The store path is read when lib/db/local-store is first imported, so the
 * temporary location has to be set before that happens: every import here is
 * dynamic and runs inside the test.
 */
describe("an import that dies partway through", () => {
  let tempDir = "";
  let storePath = "";
  let audit: AuditExport;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "geo-partial-"));
    storePath = path.join(tempDir, "local-store.json");
    process.env.LOCAL_STORE_PATH = storePath;
    vi.resetModules();
    audit = JSON.parse(
      await readFile(
        path.join(process.cwd(), "tests/fixtures/free-audit-export.json"),
        "utf8",
      ),
    ) as AuditExport;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    delete process.env.LOCAL_STORE_PATH;
    await rm(tempDir, { recursive: true, force: true });
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

    const store = JSON.parse(await readFile(storePath, "utf8")) as {
      scan_runs: Array<{ id: string; brand_id: string; status: string }>;
    };
    const scan = store.scan_runs.at(-1);
    expect(scan).toBeDefined();
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
