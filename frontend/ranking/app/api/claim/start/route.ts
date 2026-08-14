import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import {
  startVerification,
  TXT_PREFIX,
  WELL_KNOWN_PATH,
} from "@/lib/claims/verification";
import { getBrandBySlug } from "@/lib/db/repository";
import { limitAction } from "@/lib/rate-limit";
import { normalizeDomain, UrlValidationError } from "@/lib/security/url";

const schema = z.object({
  slug: z.string().min(1).max(80).optional(),
  domain: z.string().min(3).max(200).optional(),
});

/** Begin proving you control a domain. Returns the token to publish. */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }
  const rate = await limitAction("claim-start", user.id, 10, 3600);
  if (!rate.success) {
    return NextResponse.json(
      { error: "Too many verification requests. Try again later." },
      { status: 429 },
    );
  }
  const body = schema.parse(await request.json());

  let domain: string | null = null;
  let brandId: string | null = null;
  if (body.slug) {
    const brand = await getBrandBySlug(body.slug);
    if (!brand) {
      return NextResponse.json({ error: "Report not found." }, { status: 404 });
    }
    domain = brand.canonical_domain;
    brandId = brand.owner_id === null ? brand.id : null;
  } else if (body.domain) {
    try {
      domain = normalizeDomain(body.domain);
    } catch (error) {
      if (error instanceof UrlValidationError) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }
  }
  if (!domain) {
    return NextResponse.json(
      { error: "Provide a report or a domain." },
      { status: 400 },
    );
  }

  const verification = await startVerification(user.id, domain, brandId);
  return NextResponse.json({
    verificationId: verification.id,
    domain,
    txtRecord: `${TXT_PREFIX}${verification.token}`,
    wellKnownUrl: `https://${domain}${WELL_KNOWN_PATH}`,
    wellKnownContent: verification.token,
    expiresAt: verification.expires_at,
  });
}
