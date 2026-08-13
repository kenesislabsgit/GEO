import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { authorizeAudit } from "@/lib/billing/enforce";
import { startDetachedAudit } from "@/lib/audit/runner";
import { FREE_AUDIT_PROVIDER } from "@/lib/constants";
import { getBrandByDomainForOwner, getBrandById } from "@/lib/db/repository";
import { one } from "@/lib/db/pg";
import { normalizeDomain, UrlValidationError } from "@/lib/security/url";

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
      ]),
    )
    .min(1)
    .optional(),
  limitPerAssistant: z.number().int().min(1).max(20).optional(),
  resume: z.boolean().optional(),
  /** Pro+ geo search: a market name, or omitted for auto-detect. */
  market: z.string().trim().max(40).optional(),
});

/**
 * Starts an audit and returns at once with the id to poll. The run belongs to
 * the server, not to this request: reloading or leaving the page does not
 * touch it. Progress lives at /api/scans/<id>/progress.
 */
export async function POST(request: NextRequest) {
  const body = requestSchema.parse(await request.json());
  const mode = body.mode ?? (body.brandId ? "pro" : "free");
  const user = await getSessionUser();
  // Every audit costs real money to run, so nobody runs one without an account.
  if (!user) {
    return NextResponse.json(
      { error: "Sign in to run an audit." },
      { status: 401 },
    );
  }
  // A confirmed email is what stops throwaway signups burning provider
  // credit. Google accounts arrive verified; password accounts confirm once.
  // Only enforced when email sending is configured — otherwise nobody could
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
  const brand =
    existingBrand ??
    (await getBrandByDomainForOwner(requestedDomain, user.id));

  // What the plan allows, decided here and not by the page. A crafted
  // request gets clamped or refused; a normal one passes through unchanged.
  const authorized = await authorizeAudit(user.id, {
    mode,
    assistants: body.assistants ?? [FREE_AUDIT_PROVIDER],
    limitPerAssistant: body.limitPerAssistant,
  });
  if (!authorized.ok) {
    return NextResponse.json(
      { error: authorized.error },
      { status: authorized.status },
    );
  }

  const started = await startDetachedAudit({
    domain: requestedDomain,
    mode: authorized.mode,
    assistants: authorized.assistants,
    limitPerAssistant: authorized.limitPerAssistant,
    userId: user.id,
    brand,
    resume: body.resume,
    geoMarket: authorized.geoMarket,
    geoMarketName: body.market,
  });

  return NextResponse.json(started);
}
