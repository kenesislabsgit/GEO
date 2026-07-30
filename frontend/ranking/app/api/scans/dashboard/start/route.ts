import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { getAccountEntitlements } from "@/lib/billing/account";
import {
  assertCanCreateBrand,
  EntitlementError,
  PLAN_CONFIG,
} from "@/lib/billing/entitlements";
import { readWebsiteShared } from "@/lib/ai/website/shared-understanding";
import { generateBuyerPrompts } from "@/lib/ai/prompts/generate";
import { brandUnderstandingSchema } from "@/lib/ai/schemas/analysis";
import { providerKeyMissing } from "@/lib/ai/providers/demo";
import { METHODOLOGY_VERSION } from "@/lib/constants";
import { domainInputSchema } from "@/lib/security/url";
import { domainToSlug } from "@/lib/utils/slug";
import { withIdempotency } from "@/lib/rate-limit";
import {
  claimOrCopyBrand,
  createScanRun,
  getBrandByDomainForOwner,
  getPrompts,
  listBrandsForOwner,
  recordFreeScan,
  replaceCompetitors,
  replacePrompts,
  upsertBrand,
} from "@/lib/db/repository";
import { enqueueScan } from "@/lib/jobs/inngest";
import { hashIp } from "@/lib/security/hash";
import type { ProviderId } from "@/types/database";

const schema = z.object({
  domain: z.string().min(1),
  understanding: brandUnderstandingSchema.optional(),
  categoryOverride: z.string().optional(),
});

/**
 * Signed-in entry point for adding/claiming a brand and starting a scan
 * without leaving the dashboard. Never used by the anonymous homepage flow.
 */
export async function POST(request: Request) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = schema.parse(await request.json());
    const domain = domainInputSchema.parse(body.domain);

    const entitlements = await getAccountEntitlements(user.id);
    const plan = entitlements.plan;
    const isPaid =
      plan !== "free" &&
      (entitlements.status === "active" || entitlements.status === "trialing");

    // This person's own record for the website. Someone else auditing the same
    // website is not a conflict — they simply have their own record.
    let brand = await getBrandByDomainForOwner(domain, user.id);

    // New website for this user — enforce the plan's website limit.
    if (!brand) {
      const owned = await listBrandsForOwner(user.id);
      assertCanCreateBrand({
        ...entitlements,
        brandCount: owned.length,
      });
    }

    // Reuses a recent read of this website if one exists; the questions and the
    // audit itself are still generated for this user.
    const understanding =
      body.understanding ?? (await readWebsiteShared(domain)).understanding;
    if (body.categoryOverride) {
      understanding.category = body.categoryOverride;
    }

    brand = await upsertBrand({
      owner_id: user.id,
      name: understanding.name,
      canonical_domain: domain,
      slug: brand?.slug ?? domainToSlug(domain),
      logo_url: brand?.logo_url ?? null,
      description: understanding.description,
      category: understanding.category,
      target_audience: understanding.targetAudience,
      aliases: understanding.aliases,
      default_country: brand?.default_country ?? "US",
      default_language: brand?.default_language ?? "en",
      visibility: brand?.visibility ?? "public",
      claimed_at: brand?.claimed_at ?? new Date().toISOString(),
      metadata_confidence: understanding.confidence,
    });

    if (!brand.owner_id || brand.owner_id !== user.id) {
      brand = (await claimOrCopyBrand(brand.id, user.id)) ?? brand;
    }

    let prompts = await getPrompts(brand.id);
    if (prompts.length === 0) {
      const generated = await generateBuyerPrompts({
        brand: understanding,
        country: "US",
        language: "en",
      });
      prompts = await replacePrompts(
        brand.id,
        generated.map((p) => ({
          prompt: p.prompt,
          prompt_type: p.promptType,
          buyer_stage: p.buyerStage,
          country: p.country,
          language: p.language,
          active: true,
          is_custom: false,
          rationale: p.rationale,
        })),
      );
    }

    if (understanding.likelyCompetitors.length > 0) {
      await replaceCompetitors(
        brand.id,
        understanding.likelyCompetitors.slice(0, 5).map((c) => ({
          name: c.name,
          domain: c.domain,
          aliases: [c.name],
        })),
      );
    }

    const providers: ProviderId[] = isPaid
      ? [...PLAN_CONFIG[plan].features.providers]
      : ["openai"];

    const estimatedChecks = prompts.length * providers.length;
    const limit = PLAN_CONFIG[plan].features.providerChecksPerMonth;
    const remaining = limit - entitlements.providerChecksUsed;
    if (estimatedChecks > remaining) {
      return NextResponse.json(
        {
          error: `This scan needs ${estimatedChecks} AI checks but only ${Math.max(remaining, 0)} remain this month.`,
          code: "usage_exceeded",
          estimatedChecks,
          remaining: Math.max(remaining, 0),
        },
        { status: 402 },
      );
    }

    const idempotent = await withIdempotency(
      `dashboard-scan:${user.id}:${domain}`,
      120,
    );
    if (!idempotent) {
      return NextResponse.json(
        {
          error: "A scan for this domain is already starting. Please wait.",
          code: "in_progress",
        },
        { status: 409 },
      );
    }

    const scan = await createScanRun({
      brand_id: brand.id,
      initiated_by: user.id,
      scan_type: isPaid ? "manual" : "free",
      status: "queued",
      provider_ids: providers,
      total_queries: estimatedChecks,
      completed_queries: 0,
      started_at: null,
      completed_at: null,
      error_summary: null,
      methodology_version: METHODOLOGY_VERSION,
      demo_mode: providers.some((p) => providerKeyMissing(p)),
      cancelled_at: null,
      country: null,
      language: null,
    });

    if (!isPaid) {
      const ip =
        request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        request.headers.get("x-real-ip") ||
        "0.0.0.0";
      await recordFreeScan({
        domain: body.domain,
        normalized_domain: domain,
        ip_hash: hashIp(ip),
        scan_run_id: scan.id,
      });
    }

    await enqueueScan(scan.id);

    return NextResponse.json({
      scanRunId: scan.id,
      brandId: brand.id,
      slug: brand.slug,
      estimatedChecks,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid domain or request." },
        { status: 400 },
      );
    }
    if (error instanceof EntitlementError) {
      return NextResponse.json(
        { error: error.message, code: "brand_limit" },
        { status: 402 },
      );
    }
    const message =
      error instanceof Error ? error.message : "Failed to start scan";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
