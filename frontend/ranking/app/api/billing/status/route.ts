import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { getSubscription, getUserOnboarding } from "@/lib/db/repository";

/**
 * What the signed-in user's subscription actually is, straight from the
 * database the webhook writes into. The payment success page polls this —
 * query parameters from the checkout redirect are never trusted.
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const [subscription, onboarding] = await Promise.all([
    getSubscription(user.id),
    getUserOnboarding(user.id),
  ]);
  return NextResponse.json({
    plan: subscription?.plan ?? "free",
    status: subscription?.status ?? "inactive",
    currentPeriodEnd: subscription?.current_period_end ?? null,
    onboardingComplete: Boolean(onboarding?.completed),
  });
}
