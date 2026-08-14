import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { authorizeAudit } from "@/lib/billing/enforce";
import { FREE_AUDIT_PROVIDER } from "@/lib/constants";
import {
  getBrandByDomainForOwner,
  getBrandById,
  getPrompts,
  upsertBrand,
} from "@/lib/db/repository";
import { one } from "@/lib/db/pg";
import { enqueueScan } from "@/lib/scans/queue";
import { hashIp } from "@/lib/security/hash";
import { limitAuditStart } from "@/lib/rate-limit";
import { normalizeDomain, UrlValidationError } from "@/lib/security/url";
import type { ScanInputSnapshot } from "@/types/database";

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
        "gemini",
        "perplexity",
        "bedrock_claude",
        "bedrock_nova",
        "bedrock_llama",
        "bedrock_mistral",
        "grok",
        "deepseek",
        "kimi",
        "groq",
        "minimax",
        "sarvam",
      ]),
    )
    .min(1)
    .optional(),
  limitPerAssistant: z.number().int().min(1).max(20).optional(),
  resume: z.boolean().optional(),
  /** Pro+ geo search: a market name, or omitted for auto-detect. */
  market: z.string().trim().max(40).optional(),
  /** Same key twice returns the same scan instead of paying for two. */
  idempotencyKey: z.string().trim().min(8).max(80).optional(),
});

/**
 * Validates, authorizes, and enqueues an audit, returning at once with the
 * id to poll. The audit itself runs on the worker fleet - never inside this
 * web process. Progress lives at /api/scans/<id>/progress.
 */
export async function POST(request: NextRequest) {
  const body = requestSchema.parse(await request.json());
  const user = await getSessionUser();
  // Every audit costs real money to run, so nobody runs one without an account.
  if (!user) {
    return NextResponse.json(
      { error: "Sign in to run an audit." },
      { status: 401 },
    );
  }

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "0.0.0.0";
  const rate = await limitAuditStart(user.id, ip);
  if (!rate.ok) {
    return NextResponse.json(
      { error: "Too many audit requests. Try again in a few minutes." },
      { status: 429 },
    );
  }

  // A confirmed email is what stops throwaway signups burning provider
  // credit. Google accounts arrive verified; password accounts confirm once.
  // Only enforced when email sending is configured - otherwise nobody could
  // ever verify and the whole product would lock itself.
  if (process.env.RESEND_API_KEY) {
    const row = await one<{ emailVerified: boolean }>(
      `select "emailVerified" from "user" where id = $1`,
      [user.id],
    );
    if (row && !row.emailVerified) {
      return NextResponse.json(
        {
          error: "Confirm your email address before running an audit.",
          code: "email_unverified",
        },
        { status: 403 },
      );
    }
  }

  const existingBrand = body.brandId ? await getBrandById(body.brandId) : null;
  if (body.brandId && (!existingBrand || existingBrand.owner_id !== user.id)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let requestedDomain: string;
  try {
    requestedDomain = normalizeDomain(body.domain);
  } catch (error) {
    if (error instanceof UrlValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }

  // What the plan allows, decided here and not by the page. A crafted
  // request gets clamped or refused; a normal one passes through unchanged.
  const mode = body.mode ?? (body.brandId ? "pro" : "free");
  const authorized = await authorizeAudit(user.id, {
    mode,
    assistants: body.assistants ?? [FREE_AUDIT_PROVIDER],
    limitPerAssistant: body.limitPerAssistant,
    creatingBrand: !existingBrand && !(await getBrandByDomainForOwner(requestedDomain, user.id)),
  });
  if (!authorized.ok) {
    return NextResponse.json(
      { error: authorized.error },
      { status: authorized.status },
    );
  }

  const brand =
    existingBrand ??
    (await getBrandByDomainForOwner(requestedDomain, user.id)) ??
    (await upsertBrand({
      owner_id: user.id,
      name: requestedDomain,
      canonical_domain: requestedDomain,
      slug: requestedDomain.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""),
      logo_url: null,
      description: null,
      category: null,
      target_audience: null,
      aliases: [requestedDomain],
      default_country: "US",
      default_language: "en",
      visibility: "public",
      claimed_at: null,
      metadata_confidence: null,
    }));

  // Pro audits of a brand with saved questions ask exactly those questions.
  // First audits have none yet, so the engine generates them.
  let prompts: Array<{ id: string; prompt: string }> = [];
  if (authorized.mode === "pro") {
    const active = await getPrompts(brand.id);
    prompts = active
      .slice(0, authorized.limitPerAssistant)
      .map((p) => ({ id: p.id, prompt: p.prompt }));
  }

  const snapshot: ScanInputSnapshot = {
    domain: requestedDomain,
    mode: authorized.mode,
    assistants: authorized.assistants,
    limit_per_assistant: prompts.length > 0 ? prompts.length : authorized.limitPerAssistant,
    prompts,
    country: brand.default_country?.toLowerCase() ?? null,
    language: brand.default_language?.toLowerCase() ?? null,
    geo_market: authorized.geoMarket,
    geo_market_name: body.market ?? null,
    ip_hash: hashIp(ip),
    plan: authorized.plan,
    question_count: prompts.length > 0 ? prompts.length : authorized.limitPerAssistant,
    methodology_version_requested: null,
    trigger_source: authorized.mode === "free" ? "free" : "manual",
    cost_ceiling_usd: Number(process.env.SCAN_COST_CEILING_USD ?? "2.50"),
    resume: body.resume ?? false,
  };

  const result = await enqueueScan({
    brand,
    initiatedBy: user.id,
    scanType: authorized.mode === "pro" ? "manual" : "free",
    snapshot,
    idempotencyKey: body.idempotencyKey ?? null,
    checksLimit: authorized.checksLimit,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status },
    );
  }
  return NextResponse.json({
    scanRunId: result.scan.id,
    brandId: brand.id,
    alreadyRunning: result.alreadyRunning,
  });
}
