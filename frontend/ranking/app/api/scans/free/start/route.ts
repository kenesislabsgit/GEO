import { NextResponse } from "next/server";
import { z } from "zod";
import { domainInputSchema } from "@/lib/security/url";
import { verifyTurnstile } from "@/lib/security/turnstile";
import { hashIp } from "@/lib/security/hash";
import { limitDomainBurst, limitIp, withIdempotency } from "@/lib/rate-limit";
import { readWebsiteShared } from "@/lib/ai/website/shared-understanding";
import { generateBuyerPrompts } from "@/lib/ai/prompts/generate";
import { brandUnderstandingSchema } from "@/lib/ai/schemas/analysis";
import { providerKeyMissing } from "@/lib/ai/providers/demo";
import { METHODOLOGY_VERSION } from "@/lib/constants";
import { domainToSlug } from "@/lib/utils/slug";
import {
  createScanRun,
  recordFreeScan,
  replaceCompetitors,
  replacePrompts,
  upsertBrand,
} from "@/lib/db/repository";
import { enqueueScan } from "@/lib/jobs/inngest";

const startSchema = z.object({
  domain: z.string(),
  turnstileToken: z.string().optional().nullable(),
  understanding: brandUnderstandingSchema.optional(),
  categoryOverride: z.string().optional(),
});

export async function POST(request: Request) {
  try {
    const json = await request.json();
    const parsed = startSchema.parse(json);
    const domain = domainInputSchema.parse(parsed.domain);

    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      "0.0.0.0";

    const turnstileOk = await verifyTurnstile(parsed.turnstileToken, ip);
    if (!turnstileOk) {
      return NextResponse.json(
        { error: "Turnstile verification failed." },
        { status: 403 },
      );
    }

    const ipLimit = await limitIp(ip);
    if (!ipLimit.success) {
      return NextResponse.json(
        { error: "Too many free scans from this network. Try again later." },
        { status: 429 },
      );
    }

    // A short breather per website so one site can't be hammered, while still
    // letting different people audit the same website.
    const domainLimit = await limitDomainBurst(domain);
    if (!domainLimit.success) {
      return NextResponse.json(
        {
          error:
            "This website is being audited right now. Please try again in a couple of minutes.",
        },
        { status: 429 },
      );
    }

    const idempotent = await withIdempotency(`free-scan:${domain}`, 60);
    if (!idempotent) {
      return NextResponse.json(
        { error: "A scan for this domain is already starting. Please wait." },
        { status: 409 },
      );
    }

    // Reuses a recent read of this website when one exists. The questions and
    // the audit below are generated fresh for this visitor.
    const understanding =
      parsed.understanding ?? (await readWebsiteShared(domain)).understanding;
    if (parsed.categoryOverride) {
      understanding.category = parsed.categoryOverride;
    }

    // Anonymous audits always get their own record, so two visitors auditing the
    // same website at the same time never overwrite each other's questions.
    const brand = await upsertBrand({
      owner_id: null,
      name: understanding.name,
      canonical_domain: domain,
      slug: domainToSlug(domain),
      logo_url: null,
      description: understanding.description,
      category: understanding.category,
      target_audience: understanding.targetAudience,
      aliases: understanding.aliases,
      default_country: "US",
      default_language: "en",
      visibility: "public",
      claimed_at: null,
      metadata_confidence: understanding.confidence,
    });

    const prompts = await generateBuyerPrompts({
      brand: understanding,
      country: "US",
      language: "en",
    });

    await replacePrompts(
      brand.id,
      prompts.map((p) => ({
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

    const demoMode = providerKeyMissing("openai");
    const scan = await createScanRun({
      brand_id: brand.id,
      initiated_by: null,
      scan_type: "free",
      status: "queued",
      provider_ids: ["openai"],
      total_queries: prompts.length,
      completed_queries: 0,
      started_at: null,
      completed_at: null,
      error_summary: null,
      methodology_version: METHODOLOGY_VERSION,
      demo_mode: demoMode,
      cancelled_at: null,
      country: null,
      language: null,
    });

    await recordFreeScan({
      domain: parsed.domain,
      normalized_domain: domain,
      ip_hash: hashIp(ip),
      scan_run_id: scan.id,
    });

    await enqueueScan(scan.id);

    return NextResponse.json({
      cached: false,
      scanRunId: scan.id,
      slug: brand.slug,
      demoMode,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to start scan";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
