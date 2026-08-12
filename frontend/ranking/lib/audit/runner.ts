import { spawn } from "node:child_process";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { importAuditExport, type AuditExport } from "@/lib/audit/import-export";
import { acquireSiteRead } from "@/lib/audit/site-read-cache";
import {
  AUDIT_PROVIDER_CONCURRENCY,
  AUDIT_SEARCH_BATCH_SIZE,
  FREE_AUDIT_ACTION_COUNT,
  FREE_AUDIT_COMPETITORS_CRAWLED,
  FREE_AUDIT_COMPETITOR_PAGES,
  FREE_AUDIT_QUESTION_COUNT,
  FREE_AUDIT_SEARCH_CONTEXT,
  PRO_AUDIT_SEARCH_CONTEXT,
} from "@/lib/constants";
import {
  createScanRun,
  getActiveScanForBrand,
  updateScanRun,
  upsertBrand,
} from "@/lib/db/repository";
import type { Brand, ProviderId } from "@/types/database";

/**
 * Runs an audit detached from the request that asked for it.
 *
 * The audit used to live inside the browser's open connection: a reload, a
 * closed tab or a request timeout killed the Python run and threw away the
 * money already spent — this was observed, not theorised. Now the run belongs
 * to the server process, its progress is written to the scan_runs row, and
 * the page polls that row. The page can go away and come back; the audit
 * does not care.
 *
 * The run still dies with the server process. Moving it to a separate worker
 * is the production step; this removes the browser from the failure story.
 */

export type StartAuditOptions = {
  domain: string;
  mode: "free" | "pro";
  assistants: ProviderId[];
  limitPerAssistant?: number;
  userId: string;
  brand: Brand | null;
  resume?: boolean;
};

export type StartAuditResult = {
  scanRunId: string;
  brandId: string;
  alreadyRunning: boolean;
};

export async function startDetachedAudit(
  options: StartAuditOptions,
): Promise<StartAuditResult> {
  // The run needs a brand row to hang off before Python starts. The import at
  // the end updates this same record — same owner, same domain — so nothing
  // is duplicated.
  const brand =
    options.brand ??
    (await upsertBrand({
      owner_id: options.userId,
      name: options.domain,
      canonical_domain: options.domain,
      slug: options.domain.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""),
      logo_url: null,
      description: null,
      category: null,
      target_audience: null,
      aliases: [options.domain],
      default_country: "US",
      default_language: "en",
      visibility: "public",
      claimed_at: null,
      metadata_confidence: null,
    }));

  // One run per website at a time. Clicking twice, or reloading and clicking
  // again, joins the run already going instead of paying for a second one.
  const active = await getActiveScanForBrand(brand.id);
  if (active) {
    return { scanRunId: active.id, brandId: brand.id, alreadyRunning: true };
  }

  const scan = await createScanRun({
    brand_id: brand.id,
    initiated_by: options.userId,
    scan_type: options.mode === "pro" ? "manual" : "free",
    status: "running",
    provider_ids: options.assistants,
    total_queries: 0,
    completed_queries: 0,
    started_at: new Date().toISOString(),
    completed_at: null,
    error_summary: null,
    methodology_version: "pending",
    demo_mode: false,
    cancelled_at: null,
    country: "us",
    language: "en",
    step: "starting",
    progress: 1,
  });

  // Deliberately not awaited: the request that started the audit returns
  // immediately with the id to poll.
  void runAudit(scan.id, brand, options).catch(async (error) => {
    await updateScanRun(scan.id, {
      status: "failed",
      step: "failed",
      error_summary:
        error instanceof Error ? error.message : "Audit failed to start.",
    }).catch(() => {});
  });

  return { scanRunId: scan.id, brandId: brand.id, alreadyRunning: false };
}

async function runAudit(
  scanRunId: string,
  brand: Brand,
  options: StartAuditOptions,
): Promise<void> {
  const geoRoot =
    process.env.GEO_AUDIT_ROOT ?? path.resolve(process.cwd(), "../../GEO");
  const pythonCommand = process.env.GEO_AUDIT_PYTHON ?? "python";
  const domain = brand.canonical_domain;
  const mode = options.mode;

  // Progress writes are fire-and-forget: a slow database write must never
  // stall the pipe the runner is writing events into.
  const note = (step: string, progress: number) => {
    void updateScanRun(scanRunId, { step, progress }).catch(() => {});
  };

  const fail = async (message: string) => {
    await updateScanRun(scanRunId, {
      status: "failed",
      step: "failed",
      error_summary: message,
    }).catch(() => {});
  };

  const args = [
    "-m",
    "geo_audit",
    "run",
    domain,
    "--assistants",
    ...options.assistants,
    "--limit-per-assistant",
    String(options.limitPerAssistant ?? FREE_AUDIT_QUESTION_COUNT),
    "--analyzer-batch-size",
    "5",
    "--provider-concurrency",
    String(AUDIT_PROVIDER_CONCURRENCY),
    "--openai-search-batch-size",
    String(AUDIT_SEARCH_BATCH_SIZE),
    "--search-context-size",
    mode === "pro" ? PRO_AUDIT_SEARCH_CONTEXT : FREE_AUDIT_SEARCH_CONTEXT,
    "--max-pages",
    mode === "pro" ? "10" : "6",
    "--competitor-max-pages",
    String(mode === "pro" ? 3 : FREE_AUDIT_COMPETITOR_PAGES),
    "--top-n",
    "5",
    // final_report.md is written to disk and never read: the dashboard builds
    // every screen from audit_export.json.
    "--skip-final-report",
  ];
  if (mode !== "pro") {
    args.push(
      "--free-preview",
      "--max-competitors-crawled",
      String(FREE_AUDIT_COMPETITORS_CRAWLED),
      "--max-recommendations",
      String(FREE_AUDIT_ACTION_COUNT),
      "--skip-web-presence",
    );
  }

  let releaseSiteRead: () => Promise<void> = async () => {};
  let publishSiteRead: (runDir: string) => Promise<void> = async () => {};

  try {
    const resumeFrom =
      options.resume && mode === "pro"
        ? await findLatestReusableRun(geoRoot, domain)
        : null;
    if (resumeFrom) {
      args.push("--resume-from", resumeFrom);
      note("resume_free_audit", 30);
    } else {
      // Reading the website is the only part shared between people auditing
      // the same site. Everything after it is generated for this audit.
      const siteRead = await acquireSiteRead(geoRoot, domain, {
        onWait: () => note("crawl_user_site", 3),
      });
      releaseSiteRead = siteRead.release;
      publishSiteRead = siteRead.publish;
      if (siteRead.snapshotPath) {
        args.push("--reuse-snapshot", siteRead.snapshotPath);
      }
      note("crawl_user_site", siteRead.snapshotPath ? 12 : 4);
    }

    try {
      await access(path.join(geoRoot, "geo_audit"));
    } catch {
      await releaseSiteRead();
      await fail(
        `Audit runner not found at ${geoRoot}. Set GEO_AUDIT_ROOT to the GEO directory holding geo_audit.`,
      );
      return;
    }

    const child = spawn(pythonCommand, args, {
      cwd: geoRoot,
      windowsHide: true,
      env: process.env,
    });

    let stdoutBuffer = "";
    let stderrBuffer = "";
    let runSummary: { audit_export_path?: string; run_dir?: string } | null =
      null;

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBuffer += chunk.toString("utf8");
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as Record<string, unknown>;
          if (
            parsed.event === "complete" &&
            typeof parsed.audit_export_path === "string"
          ) {
            runSummary = {
              audit_export_path: parsed.audit_export_path,
              run_dir:
                typeof parsed.run_dir === "string" ? parsed.run_dir : undefined,
            };
          }
          if (typeof parsed.step === "string") {
            note(
              parsed.step,
              typeof parsed.progress === "number" ? parsed.progress : 0,
            );
          }
        } catch {
          // Plain log line; nothing to record.
        }
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderrBuffer += chunk.toString("utf8");
    });

    await new Promise<void>((resolve) => {
      child.on("error", async (error) => {
        await releaseSiteRead();
        await fail(error.message);
        resolve();
      });

      child.on("close", async (code) => {
        try {
          if (code !== 0) {
            await releaseSiteRead();
            await fail(
              stderrBuffer.trim() || `Audit runner exited with code ${code}`,
            );
            return;
          }

          if (runSummary?.run_dir) {
            await publishSiteRead(path.resolve(geoRoot, runSummary.run_dir));
          }
          await releaseSiteRead();

          if (!runSummary?.audit_export_path) {
            await fail("Audit completed without audit_export_path.");
            return;
          }

          note("frontend_import", 99);
          const exportPath = path.resolve(geoRoot, runSummary.audit_export_path);
          const audit = JSON.parse(
            await readFile(exportPath, "utf8"),
          ) as AuditExport;
          if (!audit.brand?.domain) {
            audit.brand = { ...audit.brand, domain };
          }
          await importAuditExport(audit, {
            scanRunId,
            brandId: brand.id,
            ownerId: brand.owner_id ?? options.userId,
            visibility: brand.visibility ?? "public",
            scanType: mode === "pro" ? "manual" : "free",
            initiatedBy: options.userId,
            recordFreeScan: mode !== "pro",
          });
          await updateScanRun(scanRunId, { step: "done", progress: 100 }).catch(
            () => {},
          );
        } catch (error) {
          await fail(
            error instanceof Error ? error.message : "Frontend import failed",
          );
        } finally {
          resolve();
        }
      });
    });
  } catch (error) {
    await releaseSiteRead();
    await fail(error instanceof Error ? error.message : "Audit failed.");
  }
}

async function findLatestReusableRun(
  geoRoot: string,
  domain: string,
): Promise<string | null> {
  const outputRoot = path.resolve(geoRoot, "outputs");
  const suffix = `-${domain.toLowerCase()}`;
  const entries = await readdir(outputRoot, { withFileTypes: true }).catch(
    () => [],
  );
  const candidates = entries
    .filter(
      (entry) => entry.isDirectory() && entry.name.toLowerCase().endsWith(suffix),
    )
    .map((entry) => path.join(outputRoot, entry.name))
    .sort()
    .reverse();

  for (const candidate of candidates) {
    try {
      await Promise.all(
        [
          "website_snapshot.json",
          "website_evidence.json",
          "company_profile.json",
          "customer_prompts.json",
          "ai_recommendations_raw.json",
        ].map((name) => access(path.join(candidate, name))),
      );
      return candidate;
    } catch {
      // Try the next completed run.
    }
  }
  return null;
}
