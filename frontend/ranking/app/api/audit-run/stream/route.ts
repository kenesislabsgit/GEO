import { spawn } from "node:child_process";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { NextRequest } from "next/server";
import { z } from "zod";
import { importAuditExport, type AuditExport } from "@/lib/audit/import-export";
import { acquireSiteRead } from "@/lib/audit/site-read-cache";
import {
  AUDIT_SEARCH_BATCH_SIZE,
  FREE_AUDIT_ACTION_COUNT,
  FREE_AUDIT_COMPETITORS_CRAWLED,
  FREE_AUDIT_COMPETITOR_PAGES,
  FREE_AUDIT_PROVIDER,
  FREE_AUDIT_QUESTION_COUNT,
  FREE_AUDIT_SEARCH_CONTEXT,
  PRO_AUDIT_SEARCH_CONTEXT,
} from "@/lib/constants";
import { getSessionUser } from "@/lib/auth/session";
import { getBrandByDomainForOwner, getBrandById } from "@/lib/db/repository";

export const runtime = "nodejs";

const requestSchema = z.object({
  domain: z.string().min(3),
  brandId: z.string().min(8).optional(),
  mode: z.enum(["free", "pro"]).optional(),
  assistants: z
    .array(
      z.enum([
        "openai",
        "openai_search",
        "claude",
        "gemini",
        "bedrock_claude",
        "bedrock_nova",
        "bedrock_llama",
        "bedrock_mistral",
      ]),
    )
    .min(1)
    .optional(),
  limitPerAssistant: z.number().int().min(1).max(20).optional(),
  resume: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  const body = requestSchema.parse(await request.json());
  const mode = body.mode ?? (body.brandId ? "pro" : "free");
  const user = await getSessionUser();
  const existingBrand = body.brandId ? await getBrandById(body.brandId) : null;
  if (body.brandId && (!user || !existingBrand || existingBrand.owner_id !== user.id)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const requestedDomain = normalizeDomain(body.domain);
  // Any number of people may audit the same website. A signed-in user reuses
  // their own record for it; anonymous audits always get a fresh record, so two
  // visitors auditing the same site never overwrite each other's results.
  const domainBrand =
    existingBrand ??
    (user ? await getBrandByDomainForOwner(requestedDomain, user.id) : null);
  const geoRoot = process.env.GEO_AUDIT_ROOT ?? "D:\\seo\\GEO";
  const pythonCommand = process.env.GEO_AUDIT_PYTHON ?? "python";
  const assistants = body.assistants ?? [FREE_AUDIT_PROVIDER];
  const domain = domainBrand?.canonical_domain ?? requestedDomain;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      const args = [
        "-m",
        "geo_audit",
        "run",
        domain,
        "--assistants",
        ...assistants,
        "--limit-per-assistant",
        String(body.limitPerAssistant ?? FREE_AUDIT_QUESTION_COUNT),
        "--analyzer-batch-size",
        "5",
        "--provider-concurrency",
        "5",
        // Every question searches in parallel, each with a bounded search depth.
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
        // final_report.md is written to disk and never read: the dashboard
        // builds every screen from audit_export.json. Writing it cost a Pro
        // run 38 seconds and about three cents for a file nobody opens. The
        // report that is read is the summary inside the export.
        "--skip-final-report",
      ];
      if (mode !== "pro") {
        // The free audit reads the single most-recommended competitor's site so
        // it can write one specific, evidence-backed action. It still skips the
        // independent web-mention pass.
        args.push(
          "--free-preview",
          "--max-competitors-crawled",
          String(FREE_AUDIT_COMPETITORS_CRAWLED),
          "--max-recommendations",
          String(FREE_AUDIT_ACTION_COUNT),
          "--skip-web-presence",
        );
      }
      const resumePromise =
        body.resume && mode === "pro"
          ? findLatestReusableRun(geoRoot, domain)
          : Promise.resolve(null);

      send({
        event: "progress",
        step: "starting",
        progress: 1,
        message: "Starting audit runner",
      });

      let stdoutBuffer = "";
      let stderrBuffer = "";
      let runSummary: { audit_export_path?: string; run_dir?: string } | null = null;
      let releaseSiteRead: () => Promise<void> = async () => {};
      let publishSiteRead: (runDir: string) => Promise<void> = async () => {};
      const startChild = async () => {
        const resumeFrom = await resumePromise;
        if (resumeFrom) {
          args.push("--resume-from", resumeFrom);
          send({
            event: "progress",
            step: "resume_free_audit",
            progress: 30,
            message: "Continuing from the existing free audit",
          });
        } else {
          // Reading the website is the only part shared between people auditing
          // the same site. Everything after it is generated for this audit.
          const siteRead = await acquireSiteRead(geoRoot, domain, {
            onWait: (note) =>
              send({
                event: "progress",
                step: "crawl_user_site",
                progress: 3,
                message: note,
              }),
          });
          releaseSiteRead = siteRead.release;
          publishSiteRead = siteRead.publish;
          if (siteRead.snapshotPath) {
            args.push("--reuse-snapshot", siteRead.snapshotPath);
          }
          send({
            event: "progress",
            step: "crawl_user_site",
            progress: siteRead.snapshotPath ? 12 : 4,
            message: siteRead.note,
            reused_website_read: Boolean(siteRead.snapshotPath),
          });
        }
        const child = spawn(pythonCommand, args, {
          cwd: geoRoot,
          windowsHide: true,
          env: process.env,
        });

        child.stdout.on("data", (chunk: Buffer) => {
          stdoutBuffer += chunk.toString("utf8");
          const lines = stdoutBuffer.split(/\r?\n/);
          stdoutBuffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const parsed = JSON.parse(line) as Record<string, unknown>;
              if (parsed.event === "complete" && typeof parsed.audit_export_path === "string") {
                runSummary = {
                  audit_export_path: parsed.audit_export_path,
                  run_dir:
                    typeof parsed.run_dir === "string" ? parsed.run_dir : undefined,
                };
              }
              send(parsed);
            } catch {
              send({ event: "log", message: line });
            }
          }
        });

        child.stderr.on("data", (chunk: Buffer) => {
          stderrBuffer += chunk.toString("utf8");
        });

        child.on("error", async (error) => {
          await releaseSiteRead();
          send({ event: "error", message: error.message });
          controller.close();
        });

        child.on("close", async (code) => {
          if (code !== 0) {
            await releaseSiteRead();
            send({
              event: "error",
              message: stderrBuffer.trim() || `Audit runner exited with code ${code}`,
            });
            controller.close();
            return;
          }

          // Store this audit's website read so the next person auditing the same
          // site can reuse it instead of fetching the pages again.
          if (runSummary?.run_dir) {
            await publishSiteRead(path.resolve(geoRoot, runSummary.run_dir));
          }
          await releaseSiteRead();

          if (!runSummary?.audit_export_path) {
            send({
              event: "error",
              message: "Audit completed without audit_export_path.",
            });
            controller.close();
            return;
          }

          try {
            send({
              event: "progress",
              step: "frontend_import",
              progress: 99,
              message: "Saving report data to frontend",
            });
            const exportPath = path.resolve(geoRoot, runSummary.audit_export_path);
            const audit = JSON.parse(await readFile(exportPath, "utf8")) as AuditExport;
            const importResult = await importAuditExport(audit, {
              ownerId: domainBrand?.owner_id ?? user?.id ?? null,
              brandId: domainBrand?.id,
              visibility: domainBrand?.visibility ?? "public",
              scanType: mode === "pro" ? "manual" : "free",
              initiatedBy: user?.id ?? null,
              recordFreeScan: mode !== "pro",
            });
            send({
              event: "done",
              progress: 100,
              message: "Report ready",
              ...importResult,
              run: runSummary,
            });
          } catch (error) {
            send({
              event: "error",
              message: error instanceof Error ? error.message : "Frontend import failed",
            });
          } finally {
            controller.close();
          }
        });
      };

      void startChild().catch(async (error) => {
        await releaseSiteRead();
        send({
          event: "error",
          message: error instanceof Error ? error.message : "Could not start audit",
        });
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

async function findLatestReusableRun(geoRoot: string, domain: string): Promise<string | null> {
  const outputRoot = path.resolve(geoRoot, "outputs");
  const suffix = `-${domain.toLowerCase()}`;
  const entries = await readdir(outputRoot, { withFileTypes: true }).catch(() => []);
  const candidates = entries
    .filter((entry) => entry.isDirectory() && entry.name.toLowerCase().endsWith(suffix))
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

function normalizeDomain(value: string): string {
  const raw = value.trim().toLowerCase();
  try {
    const host = new URL(raw.includes("://") ? raw : `https://${raw}`).hostname;
    return host.startsWith("www.") ? host.slice(4) : host;
  } catch {
    return raw.replace(/^www\./, "");
  }
}
