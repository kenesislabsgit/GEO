import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { importAuditExport, type AuditExport } from "@/lib/audit/import-export";
import { FREE_AUDIT_PROVIDER } from "@/lib/constants";

export const runtime = "nodejs";

const execFileAsync = promisify(execFile);

const requestSchema = z.object({
  domain: z.string().min(3),
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
});

export async function POST(request: NextRequest) {
  const configuredToken = process.env.AUDIT_RUN_TOKEN ?? process.env.AUDIT_IMPORT_TOKEN;
  if (configuredToken) {
    const providedToken =
      request.headers.get("x-audit-run-token") ??
      request.headers.get("x-audit-import-token");
    if (providedToken !== configuredToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "Set AUDIT_RUN_TOKEN before enabling audit runs in production." },
      { status: 403 },
    );
  }

  const body = requestSchema.parse(await request.json());
  const geoRoot = process.env.GEO_AUDIT_ROOT ?? "D:\\seo\\GEO";
  const pythonCommand = process.env.GEO_AUDIT_PYTHON ?? "python";
  const assistants = body.assistants ?? [FREE_AUDIT_PROVIDER];

  const args = [
    "-m",
    "geo_audit",
    "run",
    body.domain,
    "--assistants",
    ...assistants,
    "--limit-per-assistant",
    String(body.limitPerAssistant ?? 5),
    "--analyzer-batch-size",
    "5",
    "--provider-concurrency",
    "5",
    "--max-pages",
    "6",
    "--competitor-max-pages",
    "0",
    "--top-n",
    "5",
    "--skip-audit-recommendations",
    "--skip-final-report",
  ];

  try {
    const { stdout, stderr } = await execFileAsync(pythonCommand, args, {
      cwd: geoRoot,
      timeout: Number(process.env.AUDIT_RUN_TIMEOUT_MS ?? 15 * 60 * 1000),
      maxBuffer: 20 * 1024 * 1024,
      windowsHide: true,
      env: process.env,
    });
    const runSummary = parseRunSummary(stdout);
    const exportPath = path.resolve(geoRoot, runSummary.audit_export_path);
    const audit = JSON.parse(await readFile(exportPath, "utf8")) as AuditExport;
    const importResult = await importAuditExport(audit);
    return NextResponse.json({
      ...importResult,
      run: runSummary,
      stderr: stderr.trim() || null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Audit run failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function parseRunSummary(stdout: string): {
  audit_export_path: string;
  run_dir?: string;
  final_report_path?: string;
  responses_collected?: number;
  collection_errors?: number;
  overall_score?: number;
} {
  const lines = stdout.trim().split(/\r?\n/).reverse();
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as { audit_export_path?: string };
      if (parsed.audit_export_path) {
        return parsed as ReturnType<typeof parseRunSummary>;
      }
    } catch {
      // Continue scanning earlier lines.
    }
  }
  throw new Error("Audit run completed without an audit_export_path summary.");
}
