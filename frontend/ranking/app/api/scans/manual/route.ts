import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { getAccountEntitlements } from "@/lib/billing/account";
import {
  EntitlementError,
  PLAN_CONFIG,
  type PlanId,
} from "@/lib/billing/entitlements";
import {
  createScanRun,
  getBrandById,
  getPrompts,
  getScanRun,
} from "@/lib/db/repository";
import { enqueueScan } from "@/lib/jobs/inngest";
import { METHODOLOGY_VERSION } from "@/lib/constants";
import { providerKeyMissing } from "@/lib/ai/providers/demo";
import { withIdempotency } from "@/lib/rate-limit";
import type { ProviderId } from "@/types/database";

const schema = z.object({
  brandId: z.string().min(8),
  providers: z
    .array(
      z.enum([
        "openai",
        "openai_search",
        "claude",
        "gemini",
        "perplexity",
        "bedrock_claude",
        "bedrock_nova",
        "bedrock_llama",
        "bedrock_mistral",
      ]),
    )
    .min(1)
    .optional(),
  country: z.string().length(2).optional(),
  language: z.string().length(2).optional(),
});

function resolveProviders(
  plan: PlanId,
  requested: ProviderId[] | undefined,
): ProviderId[] {
  const allowed = PLAN_CONFIG[plan].features.providers;
  if (!requested || requested.length === 0) return [...allowed];
  const invalid = requested.filter((p) => !allowed.includes(p));
  if (invalid.length > 0) {
    throw new EntitlementError(
      `${invalid.join(", ")} is not available on the ${PLAN_CONFIG[plan].name} plan.`,
    );
  }
  return requested;
}

export async function POST(request: Request) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = schema.parse(await request.json());
    const brand = await getBrandById(body.brandId);
    if (!brand || brand.owner_id !== user.id) {
      return NextResponse.json({ error: "Brand not found" }, { status: 404 });
    }

    const entitlements = await getAccountEntitlements(user.id);
    const plan = entitlements.plan;
    const isPaid =
      plan !== "free" &&
      (entitlements.status === "active" || entitlements.status === "trialing");

    // Free (or lapsed) accounts run the public-tier scan: one provider.
    // Repeat audits of the same website are allowed — the monthly check
    // allowance below is what limits how much anyone can run.
    if (!isPaid) {
      if (body.providers && body.providers.length > 1) {
        return NextResponse.json(
          {
            error: "Multi-provider scans require a paid plan.",
            code: "upgrade_required",
          },
          { status: 402 },
        );
      }
    }

    const providers = isPaid
      ? resolveProviders(plan, body.providers)
      : (["openai"] satisfies ProviderId[]);

    const prompts = await getPrompts(brand.id);
    if (prompts.length === 0) {
      return NextResponse.json(
        { error: "No tracked questions for this brand yet. Run a scan from a claimed report first." },
        { status: 400 },
      );
    }

    // Hard server-side allowance check: the whole scan must fit.
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

    const idempotent = await withIdempotency(`manual-scan:${brand.id}`, 120);
    if (!idempotent) {
      return NextResponse.json(
        { error: "A scan is already in progress for this brand.", code: "in_progress" },
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
      country: isPaid ? (body.country ?? null) : null,
      language: isPaid ? (body.language ?? null) : null,
    });

    await enqueueScan(scan.id);
    const created = await getScanRun(scan.id);
    return NextResponse.json({
      scanRunId: created?.id ?? scan.id,
      estimatedChecks,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid scan request." },
        { status: 400 },
      );
    }
    const message =
      error instanceof EntitlementError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Scan failed";
    const status = error instanceof EntitlementError ? 402 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
