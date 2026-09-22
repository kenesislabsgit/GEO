import { NextResponse } from "next/server";
import { getOnboardingUser } from "@/lib/auth/session";
import { canonicalDashboardRedirect, verificationRedirect } from "@/lib/auth/redirects";
import { listBrandsForOwner } from "@/lib/db/repository";
import { routes, safeReturnTo } from "@/lib/routes";

export const runtime = "nodejs";

// Where to send someone who has just signed in. Claiming a report is no
// longer a login side effect - ownership needs domain verification, so a
// pending claim just lands on the claim page to start it.

async function resolveRedirect(input: {
  userId: string;
  emailVerified: boolean;
  claim: string | null;
  returnTo: string | null;
}): Promise<string> {
  if (!input.emailVerified) {
    const destination = input.claim && /^[a-z0-9-]{1,80}$/.test(input.claim)
      ? `/claim/${input.claim}` : input.returnTo;
    return verificationRedirect(destination);
  }
  if (input.claim && /^[a-z0-9-]{1,80}$/.test(input.claim)) {
    return `/claim/${input.claim}`;
  }
  const returnTo = safeReturnTo(input.returnTo);
  if (returnTo) return canonicalDashboardRedirect(returnTo);

  // New accounts with nothing to show yet go straight into the signed-in
  // scan flow - never the public homepage hero.
  const brands = await listBrandsForOwner(input.userId);
  if (brands.length === 0) return canonicalDashboardRedirect(routes.newScan());
  return canonicalDashboardRedirect(routes.dashboard);
}

export async function POST(request: Request) {
  const user = await getOnboardingUser(request.headers);
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    claim?: unknown;
    returnTo?: unknown;
  };
  const redirect = await resolveRedirect({
    userId: user.id,
    emailVerified: user.emailVerified,
    claim: typeof body.claim === "string" ? body.claim : null,
    returnTo: typeof body.returnTo === "string" ? body.returnTo : null,
  });
  return NextResponse.json({ redirect });
}

export async function GET(request: Request) {
  const user = await getOnboardingUser(request.headers);
  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url), 303);
  }
  const url = new URL(request.url);
  const redirect = await resolveRedirect({
    userId: user.id,
    emailVerified: user.emailVerified,
    claim: url.searchParams.get("claim"),
    returnTo: url.searchParams.get("returnTo"),
  });
  return NextResponse.redirect(new URL(redirect, request.url), 303);
}
