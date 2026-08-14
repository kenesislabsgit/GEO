import { spawn, type ChildProcess } from "node:child_process";
import { access, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { importAuditExport, type AuditExport } from "@/lib/audit/import-export";
import { acquireSiteRead } from "@/lib/audit/site-read-cache";
import {
  AUDIT_PROVIDER_CONCURRENCY,
  AUDIT_SEARCH_BATCH_SIZE,
  FREE_AUDIT_ACTION_COUNT,
  FREE_AUDIT_COMPETITORS_CRAWLED,
  FREE_AUDIT_COMPETITOR_PAGES,
  FREE_AUDIT_SEARCH_CONTEXT,
  PRO_AUDIT_SEARCH_CONTEXT,
} from "@/lib/constants";
import { getBrandById, updateScanRun } from "@/lib/db/repository";
import { recordScanEvent, settleReservation } from "@/lib/scans/queue";
import { log } from "@/lib/log";
import type { ScanInputSnapshot, ScanRun } from "@/types/database";

/**
 * Runs one claimed audit: spawn the Python engine, stream its progress into
 * the database, import the export inside one transaction, settle the usage
 * reservation. This file lives in the worker on purpose - the web app must
 * never spawn Python.
 */

export type RunningAudit = {
  /** Resolves when the audit fully finishes (import included) or fails. */
  done: Promise<{ ok: true } | { ok: false; message: string; reason: string }>;
  /** Kill the Python process (cancellation / shutdown). */
  kill: () => void;
};

/**
 * Only what the engine needs crosses the process boundary. The worker's own
 * environment (DATABASE_URL, auth secrets, billing keys) stays here.
 */
function pythonEnv(snapshot: ScanInputSnapshot): Record<string, string | undefined> {
  const allowPrefixes = [
    "OPENAI_",
    "LLM_",
    "ANTHROPIC_",
    "CLAUDE_",
    "GEMINI_",
    "GOOGLE_API_KEY",
    "AWS_",
    "BEDROCK_",
    "GEO_BEDROCK_",
    "AGENTCORE_",
    "GATEWAY_",
    "FIRECRAWL_",
    "PERPLEXITY_",
    "XAI_",
    "GROK_",
    "DEEPSEEK_",
    "MOONSHOT_",
    "KIMI_",
    "GROQ_",
    "MINIMAX_",
    "SARVAM_",
  ];
  // Process basics the interpreter needs to start at all.
  const passthrough = [
    "PATH",
    "PATHEXT",
    "SYSTEMROOT",
    "SystemRoot",
    "COMSPEC",
    "TEMP",
    "TMP",
    "HOME",
    "USERPROFILE",
    "LANG",
    "LC_ALL",
    "PYTHONPATH",
    "VIRTUAL_ENV",
  ];
  const env: Record<string, string | undefined> = {
    PYTHONIOENCODING: "utf-8",
    NODE_ENV: process.env.NODE_ENV,
  };
  for (const [key, value] of Object.entries(process.env)) {
    if (
      passthrough.includes(key) ||
      allowPrefixes.some((prefix) => key.startsWith(prefix))
    ) {
      env[key] = value;
    }
  }
  if (snapshot.country) {
    env.OPENAI_SEARCH_COUNTRY = snapshot.country.toUpperCase();
  }
  return env;
}

export function startAuditRun(scan: ScanRun): RunningAudit {
  let child: ChildProcess | null = null;
  let killed = false;

  const kill = () => {
    killed = true;
    if (child && !child.killed) {
      child.kill("SIGTERM");
      // Python may be mid-provider-call; give it a moment then force.
      setTimeout(() => {
        if (child && !child.killed) child.kill("SIGKILL");
      }, 10_000).unref();
    }
  };

  const done = (async (): Promise<
    { ok: true } | { ok: false; message: string; reason: string }
  > => {
    const snapshot = scan.input_snapshot as ScanInputSnapshot | null;
    if (!snapshot) {
      return {
        ok: false,
        message: "Scan has no input snapshot.",
        reason: "missing_snapshot",
      };
    }
    const brand = await getBrandById(scan.brand_id);
    if (!brand) {
      return { ok: false, message: "Brand no longer exists.", reason: "missing_brand" };
    }

    const geoRoot =
      process.env.GEO_AUDIT_ROOT ?? path.resolve(process.cwd(), "../../GEO");
    const pythonCommand = process.env.GEO_AUDIT_PYTHON ?? "python";
    const domain = snapshot.domain;
    const mode = snapshot.mode;

    try {
      await access(path.join(geoRoot, "geo_audit"));
    } catch {
      return {
        ok: false,
        message: `Audit engine not found at ${geoRoot}. Set GEO_AUDIT_ROOT.`,
        reason: "engine_missing",
      };
    }

    const note = (step: string, progress: number) => {
      void updateScanRun(scan.id, { step, progress }).catch(() => {});
    };

    const args = [
      "-m",
      "geo_audit",
      "run",
      domain,
      "--assistants",
      ...snapshot.assistants,
      "--limit-per-assistant",
      String(snapshot.limit_per_assistant),
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
      "--skip-final-report",
    ];
    if (snapshot.cost_ceiling_usd && snapshot.cost_ceiling_usd > 0) {
      args.push("--max-cost-usd", String(snapshot.cost_ceiling_usd));
    }
    if (mode === "pro" && snapshot.geo_market) {
      args.push("--market", snapshot.geo_market_name?.trim() || "auto");
    }
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

    // The user's saved questions, asked verbatim. Without this file the
    // engine generates its own from the website.
    let questionsDir: string | null = null;
    if (snapshot.prompts.length > 0) {
      questionsDir = await mkdtemp(path.join(os.tmpdir(), "rbai-questions-"));
      const questionsPath = path.join(questionsDir, "questions.json");
      await writeFile(
        questionsPath,
        JSON.stringify(snapshot.prompts.map((p) => p.prompt)),
        "utf8",
      );
      args.push("--questions-file", questionsPath);
    }

    let releaseSiteRead: () => Promise<void> = async () => {};
    let publishSiteRead: (runDir: string) => Promise<void> = async () => {};

    try {
      const resumeFrom =
        snapshot.resume && mode === "pro"
          ? await findLatestReusableRun(geoRoot, domain)
          : null;
      if (resumeFrom) {
        args.push("--resume-from", resumeFrom);
        note("resume_free_audit", 30);
      } else {
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

      const proc = spawn(pythonCommand, args, {
        cwd: geoRoot,
        windowsHide: true,
        env: pythonEnv(snapshot) as NodeJS.ProcessEnv,
      });
      child = proc;

      let stdoutBuffer = "";
      let stderrBuffer = "";
      type RunSummary = {
        audit_export_path?: string;
        run_dir?: string;
        estimated_cost_usd?: number;
      };
      let runSummary = null as RunSummary | null;

      proc.stdout?.on("data", (chunk: Buffer) => {
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
                estimated_cost_usd:
                  typeof parsed.estimated_cost_usd === "number"
                    ? parsed.estimated_cost_usd
                    : undefined,
              };
            }
            if (typeof parsed.step === "string") {
              const progress =
                typeof parsed.progress === "number" ? parsed.progress : 0;
              note(parsed.step, progress);
              void recordScanEvent(scan.id, {
                step: parsed.step,
                progress,
                message:
                  typeof parsed.message === "string" ? parsed.message : null,
                assistant:
                  typeof parsed.assistant === "string" ? parsed.assistant : null,
                questions: Array.isArray(parsed.questions)
                  ? parsed.questions.filter(
                      (item): item is string => typeof item === "string",
                    )
                  : [],
              }).catch(() => {});
            }
          } catch {
            // Plain log line; nothing to record.
          }
        }
      });

      proc.stderr?.on("data", (chunk: Buffer) => {
        stderrBuffer += chunk.toString("utf8");
        // Keep the tail; a crashing pipeline can be chatty.
        if (stderrBuffer.length > 20_000) {
          stderrBuffer = stderrBuffer.slice(-20_000);
        }
      });

      const exitCode = await new Promise<number | null>((resolve) => {
        child?.on("error", () => resolve(null));
        child?.on("close", (code) => resolve(code));
      });

      if (killed) {
        await releaseSiteRead();
        return { ok: false, message: "Audit cancelled.", reason: "cancelled" };
      }
      if (exitCode !== 0) {
        await releaseSiteRead();
        // stderr can contain paths and stack traces. It goes to the worker
        // log, not to the scan row users read.
        log.error("audit_engine_failed", {
          scanId: scan.id,
          exitCode,
          stderrTail: stderrBuffer.slice(-2_000),
        });
        return {
          ok: false,
          message: "The audit engine stopped before finishing.",
          reason: exitCode === null ? "spawn_error" : `exit_${exitCode}`,
        };
      }

      if (runSummary?.run_dir) {
        await publishSiteRead(path.resolve(geoRoot, runSummary.run_dir));
      }
      await releaseSiteRead();

      if (!runSummary?.audit_export_path) {
        return {
          ok: false,
          message: "Audit completed without a result file.",
          reason: "missing_export",
        };
      }

      note("frontend_import", 99);
      const exportPath = path.resolve(geoRoot, runSummary.audit_export_path);
      const audit = JSON.parse(await readFile(exportPath, "utf8")) as AuditExport;
      if (!audit.brand?.domain) {
        audit.brand = { ...audit.brand, domain };
      }
      const result = await importAuditExport(audit, {
        scanRunId: scan.id,
        brandId: scan.brand_id,
        ownerId: brand.owner_id ?? scan.initiated_by,
        visibility: brand.visibility ?? "public",
        scanType: scan.scan_type,
        initiatedBy: scan.initiated_by,
        recordFreeScan: mode !== "pro",
        ipHash: snapshot.ip_hash,
        country: snapshot.country,
        language: snapshot.language,
        curatedPrompts: snapshot.prompts.length > 0 ? snapshot.prompts : undefined,
      });

      const costUsd =
        runSummary.estimated_cost_usd ?? result.actualCostUsd ?? 0;
      await settleReservation(scan, result.actualUnits, costUsd);
      await updateScanRun(scan.id, {
        step: "done",
        progress: 100,
        estimated_cost_usd: costUsd,
      }).catch(() => {});
      return { ok: true };
    } catch (error) {
      await releaseSiteRead();
      log.error("audit_run_failed", {
        scanId: scan.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        ok: false,
        message:
          error instanceof Error && looksSafeForUsers(error.message)
            ? error.message
            : "The audit failed unexpectedly.",
        reason: "run_error",
      };
    } finally {
      if (questionsDir) {
        await rm(questionsDir, { recursive: true, force: true }).catch(() => {});
      }
    }
  })();

  return { done, kill };
}

/** Error messages that are safe to show users (no paths, no internals). */
function looksSafeForUsers(message: string): boolean {
  return !/[\\/]|Traceback|Error:|ENOENT|EACCES|spawn/i.test(message);
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
