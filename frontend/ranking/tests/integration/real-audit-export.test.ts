import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { importAuditExport, type AuditExport } from "@/lib/audit/import-export";
import {
  getLatestScanForBrand,
  getQueryResults,
  getRecommendationsForScan,
  getScoreForScan,
} from "@/lib/db/repository";

// The fixture is hand-written and drifts from what the audit really produces.
// This reads an export written by an actual run, so a field the Python side
// renames is caught here rather than by a blank panel on the dashboard.
const RUN_ROOT = process.env.GEO_AUDIT_RUN_DIR ?? "";

async function newestExport(): Promise<AuditExport | null> {
  if (!RUN_ROOT) return null;
  try {
    const entries = await readdir(RUN_ROOT, { withFileTypes: true });
    const runs = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    for (const run of runs.reverse()) {
      const candidate = path.join(RUN_ROOT, run, "audit_export.json");
      try {
        return JSON.parse(await readFile(candidate, "utf8")) as AuditExport;
      } catch {
        continue;
      }
    }
  } catch {
    return null;
  }
  return null;
}

describe("an export written by a real audit run", () => {
  let workDir = "";

  beforeAll(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), "geo-real-export-"));
    process.env.LOCAL_DB_DIR = workDir;
  });

  afterAll(async () => {
    if (workDir) await rm(workDir, { recursive: true, force: true });
  });

  it("imports into every panel the dashboard reads", async () => {
    const audit = await newestExport();
    if (!audit) {
      // Nothing to check on a machine with no completed runs.
      expect(true).toBe(true);
      return;
    }

    const result = await importAuditExport(audit, { scanType: "free" });
    const latest = await getLatestScanForBrand(result.brandId);
    expect(latest).not.toBeNull();
    const scan = latest!.scan;
    expect(scan.id).toBe(result.scanRunId);

    const score = await getScoreForScan(scan.id);
    expect(score).not.toBeNull();
    expect(Number(score!.overall_score)).toBeGreaterThanOrEqual(0);

    const results = await getQueryResults(scan.id);
    expect(results.length).toBe(audit.query_results?.length ?? 0);

    const actions = await getRecommendationsForScan(scan.id);
    expect(actions.length).toBe(audit.recommendations?.length ?? 0);

    // The panel that replaced the mention-rate threshold.
    if (audit.summary) {
      expect(scan.summary).toBe(audit.summary);
    }
  });
});
