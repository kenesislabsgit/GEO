import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { claimOrCopyBrand, getBrandBySlug } from "@/lib/db/repository";
import { routes } from "@/lib/routes";

/**
 * Claim entry point used by public report CTAs. Anonymous visitors are sent
 * to signup with the claim preserved; signed-in users claim immediately.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  const { slug } = await context.params;
  const user = await getSessionUser();

  if (!user) {
    return NextResponse.redirect(
      new URL(routes.login({ claim: slug }), request.url),
    );
  }

  const brand = await getBrandBySlug(slug);
  if (!brand) {
    return NextResponse.redirect(new URL(routes.brands, request.url));
  }

  // If nobody owns this report it becomes theirs. If someone else owns it, they
  // get their own record for the same website instead of being turned away.
  let claimed = brand;
  try {
    claimed = (await claimOrCopyBrand(brand.id, user.id)) ?? brand;
  } catch {
    return NextResponse.redirect(
      new URL(`${routes.brands}?claimError=${encodeURIComponent(slug)}`, request.url),
    );
  }

  return NextResponse.redirect(
    new URL(
      `${routes.brands}?claimed=${encodeURIComponent(claimed.slug)}`,
      request.url,
    ),
  );
}
