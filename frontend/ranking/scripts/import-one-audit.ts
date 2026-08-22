/**
 * Land a locally-produced audit in the database exactly as the worker would.
 *
 * The worker spawns the Python engine and then imports its export inside one
 * transaction, against a brand and a scan run the queue created first. This
 * repeats those three steps for an audit that was run by hand, so what lands
 * is indistinguishable from a scan started in the app.
 */
import "@/worker/env";
import { readFile } from "node:fs/promises";
import { importAuditExport, type AuditExport } from "@/lib/audit/import-export";
import { PLAN_CONFIG, type PlanId } from "@/lib/billing/entitlements";
import { one } from "@/lib/db/pg";
import { updateScanRun, upsertBrand } from "@/lib/db/repository";
import { enqueueScan, settleReservation } from "@/lib/scans/queue";
import { domainToSlug } from "@/lib/utils/slug";
import type { ScanInputSnapshot } from "@/types/database";

async function main() {
  const [exportPath, email, domain] = process.argv.slice(2);
  if (!exportPath || !email || !domain) {
    throw new Error("usage: tsx scripts/import-one-audit.ts <export.json> <email> <domain>");
  }

  const audit = JSON.parse(await readFile(exportPath, "utf8")) as AuditExport;
  if (!audit.brand?.domain) audit.brand = { ...audit.brand, domain };

  const user = await one<{ id: string; email: string }>(
    `select id, email from "user" where email = $1`,
    [email],
  );
  if (!user) throw new Error(`no account for ${email}`);

  const subscription = await one<{ plan: string; status: string }>(
    `select plan, status from subscriptions where user_id = $1`,
    [user.id],
  );
  const plan = (subscription?.plan ?? "free") as PlanId;
  const features = PLAN_CONFIG[plan].features;
  console.log(`account ${user.email} on ${PLAN_CONFIG[plan].name} (${subscription?.status})`);

  const brand = await upsertBrand({
    owner_id: user.id,
    name: audit.brand?.name ?? domain,
    canonical_domain: domain,
    slug: domainToSlug(domain),
    logo_url: null,
    description: audit.brand?.description ?? null,
    category: audit.brand?.category ?? null,
    target_audience: audit.brand?.target_audience ?? null,
    aliases: audit.brand?.aliases?.filter(Boolean) ?? [audit.brand?.name ?? domain],
    default_country: "us",
    default_language: "en",
    visibility: "private",
    claimed_at: new Date().toISOString(),
    metadata_confidence: null,
  });
  console.log(`brand ${brand.id} ${brand.canonical_domain} owner=${brand.owner_id}`);

  const assistants = (audit.scan?.provider_ids ?? []) as ScanInputSnapshot["assistants"];
  const snapshot: ScanInputSnapshot = {
    domain,
    mode: plan === "free" ? "free" : "pro",
    assistants,
    limit_per_assistant: 0,
    prompts: [],
    country: "us",
    language: "en",
    geo_market: false,
    geo_market_name: null,
    ip_hash: null,
    plan,
    question_count: (audit.prompt_matrix ?? []).length,
    methodology_version_requested: null,
    trigger_source: "operator_import",
    cost_ceiling_usd: null,
    resume: false,
  };

  const enqueued = await enqueueScan({
    brand,
    initiatedBy: user.id,
    scanType: "manual",
    snapshot,
    checksLimit: features.providerChecksPerMonth,
  });
  if (!enqueued.ok) throw new Error(`enqueue refused: ${enqueued.status} ${enqueued.error}`);
  const scan = enqueued.scan;
  console.log(`scan run ${scan.id} status=${scan.status}`);

  const result = await importAuditExport(audit, {
    scanRunId: scan.id,
    brandId: brand.id,
    ownerId: brand.owner_id,
    visibility: brand.visibility ?? "private",
    scanType: "manual",
    initiatedBy: user.id,
    recordFreeScan: false,
    ipHash: null,
    country: "us",
    language: "en",
  });

  const costUsd = Number(result.actualCostUsd ?? 0);
  await settleReservation(scan, result.actualUnits, costUsd);
  await updateScanRun(scan.id, {
    step: "done",
    progress: 100,
    estimated_cost_usd: costUsd,
  });

  console.log("imported:", JSON.stringify(result, null, 1));
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
