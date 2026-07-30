import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * End-to-end check of the free report, using a real audit export produced by a
 * live OpenAI-with-web-search run. It imports the export the way the audit
 * runner does, then builds the public report the page renders, so every panel
 * on the free page is proven to have real data behind it.
 */

let tempDir: string;
let report: import("@/lib/reports/public-dto").PublicReportDTO;

beforeAll(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), "rbai-free-"));
  process.env.LOCAL_STORE_PATH = path.join(tempDir, "local-store.json");

  const { importAuditExport } = await import("@/lib/audit/import-export");
  const repo = await import("@/lib/db/repository");
  const { toPublicReportDTO } = await import("@/lib/reports/public-dto");

  const audit = JSON.parse(
    await readFile(
      path.join(process.cwd(), "tests/fixtures/free-audit-export.json"),
      "utf8",
    ),
  );

  const imported = await importAuditExport(audit, {
    ownerId: null,
    scanType: "free",
    initiatedBy: null,
  });

  const brand = await repo.getBrandById(imported.brandId);
  const scan = await repo.getScanRun(imported.scanRunId);
  const [prompts, results, score, recommendations] = await Promise.all([
    repo.getPrompts(imported.brandId),
    repo.getQueryResults(imported.scanRunId),
    repo.getScoreForScan(imported.scanRunId),
    repo.getRecommendations(imported.brandId),
  ]);

  report = toPublicReportDTO({
    brand: brand!,
    scan: scan!,
    score,
    prompts,
    results,
    recommendations,
  });
});

afterAll(async () => {
  delete process.env.LOCAL_STORE_PATH;
  await rm(tempDir, { recursive: true, force: true });
});

describe("free report page data", () => {
  it("asks five buyer questions through the web-search provider", () => {
    expect(report.promptMatrix.length).toBe(5);
    expect(report.scan.providerIds).toContain("openai_search");
  });

  it("shows the position and who was recommended ahead, per question", () => {
    const answered = report.promptMatrix.filter(
      (row) => row.beatenBy.length > 0,
    );
    expect(answered.length).toBeGreaterThan(0);

    const mentioned = report.promptMatrix.find((row) => row.mentioned);
    if (mentioned) expect(mentioned.position).toBeGreaterThan(0);

    // A brand recommended first cannot also have been beaten by anyone.
    for (const row of report.promptMatrix) {
      if (row.position === 1) expect(row.beatenBy).toHaveLength(0);
    }
  });

  it("lists recommended competitors with their evidence status", () => {
    expect(report.competitorPreview.length).toBeGreaterThan(0);
    for (const competitor of report.competitorPreview) {
      expect(competitor.name).toBeTruthy();
      expect(["verified", "answer_only_unverified"]).toContain(
        competitor.evidenceStatus,
      );
    }
  });

  it("investigates one competitor and can quote its pages", () => {
    expect(report.investigatedCompetitor).not.toBeNull();
    expect(report.investigatedCompetitor!.website).toMatch(/^https?:\/\//);
    expect(report.investigatedCompetitor!.pages.length).toBeGreaterThan(0);
    // Pages with real text lead, so the panel never opens on a bare link.
    expect(report.investigatedCompetitor!.pages[0]!.excerpt?.trim()).toBeTruthy();
  });

  it("shows the cited sources and whether they name the brand", () => {
    expect(report.sources.length).toBeGreaterThan(0);
    expect(report.sourceSummary.total).toBeGreaterThanOrEqual(
      report.sources.length,
    );
    for (const source of report.sources) {
      expect(source.url).toMatch(/^https?:\/\//);
      expect(source.citedInAnswers).toBeGreaterThan(0);
    }
    // The check ran, so at least one source has a definite answer either way.
    expect(
      report.sources.some((source) => typeof source.mentionsBrand === "boolean"),
    ).toBe(true);
  });

  it("carries one written action", () => {
    expect(report.recommendation).not.toBeNull();
    expect(report.recommendation!.title.length).toBeGreaterThan(20);
    expect(report.recommendation!.explanation.length).toBeGreaterThan(20);
  });
});
