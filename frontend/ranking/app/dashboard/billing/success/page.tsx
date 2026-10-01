import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { routes } from "@/lib/routes";
import { ConfirmSubscription } from "./confirm-subscription";

export const metadata = { title: "Payment status" };

function safePath(value: string | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return null;
  }
  return value;
}

/**
 * Redirect references identify an attempt, but only Dodo's authenticated
 * payment and subscription records determine its outcome.
 */
export default async function BillingSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{
    returnTo?: string;
    status?: string;
    subscription_id?: string;
    payment_id?: string;
    session_id?: string;
    checkout_session_id?: string;
  }>;
}) {
  const params = await searchParams;
  const user = await getSessionUser();
  if (!user) {
    const query = new URLSearchParams();
    for (const key of ["subscription_id", "payment_id", "session_id", "checkout_session_id"] as const) {
      if (params[key]) query.set(key, params[key]);
    }
    const next = safePath(params.returnTo);
    if (next) query.set("returnTo", next);
    redirect(routes.login({ returnTo: `${routes.billingSuccess()}?${query}` }));
  }

  // The subscription id from the redirect is a hint for server-side
  // verification against Dodo's API, never a grant by itself.
  return (
    <ConfirmSubscription
      returnTo={safePath(params.returnTo)}
      subscriptionId={params.subscription_id ?? null}
      paymentId={params.payment_id ?? null}
      sessionId={params.session_id ?? params.checkout_session_id ?? null}
    />
  );
}
