import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth";
import {
  claimOrCopyBrand,
  getBrandBySlug,
  listBrandsForOwner,
} from "@/lib/db/repository";
import { routes, safeReturnTo } from "@/lib/routes";

export const runtime = "nodejs";

// Where to send someone who has just signed in, and the one side effect that
// must happen at that moment: attaching a report they audited anonymously to
// the account they just made. Both login methods land here — the email form
// calls POST, Google comes back through GET — so the rules live once.

async function resolveRedirect(input: {
  userId: string;
  claim: string | null;
  returnTo: string | null;
}): Promise<string> {
  if (input.claim) {
    const brand = await getBrandBySlug(input.claim);
    if (brand) await claimOrCopyBrand(brand.id, input.userId);
    return `${routes.brands}?claimed=${encodeURIComponent(input.claim)}`;
  }
  const returnTo = safeReturnTo(input.returnTo);
  if (returnTo) return returnTo;

  // New accounts with nothing to show yet go straight into the signed-in
  // scan flow — never the public homepage hero.
  const brands = await listBrandsForOwner(input.userId);
  if (brands.length === 0) return routes.newScan();
  return routes.dashboard;
}

async function sessionUserId(request: Request): Promise<string | null> {
  const session = await auth.api
    .getSession({ headers: request.headers })
    .catch(() => null);
  return session?.user?.id ?? null;
}

export async function POST(request: Request) {
  const userId = await sessionUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    claim?: unknown;
    returnTo?: unknown;
  };
  const redirect = await resolveRedirect({
    userId,
    claim: typeof body.claim === "string" ? body.claim : null,
    returnTo: typeof body.returnTo === "string" ? body.returnTo : null,
  });
  return NextResponse.json({ redirect });
}

export async function GET(request: Request) {
  const userId = await sessionUserId(request);
  if (!userId) {
    return NextResponse.redirect(new URL("/login", request.url), 303);
  }
  const url = new URL(request.url);
  const redirect = await resolveRedirect({
    userId,
    claim: url.searchParams.get("claim"),
    returnTo: url.searchParams.get("returnTo"),
  });
  return NextResponse.redirect(new URL(redirect, request.url), 303);
}
