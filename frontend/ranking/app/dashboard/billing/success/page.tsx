import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { routes } from "@/lib/routes";
import { ConfirmSubscription } from "./confirm-subscription";

export const metadata = { title: "Confirming your subscription" };

function safePath(value: string | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return null;
  }
  return value;
}

/**
 * Where Dodo sends people back after checkout. Nothing in the URL is
 * believed: the webhook writes the subscription into the database, and this
 * page simply waits until the database says so.
 */
export default async function BillingSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string; status?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect(routes.login({ returnTo: routes.billingSuccess() }));
  const params = await searchParams;

  // The one thing the redirect may tell us is that the person cancelled —
  // showing the cancelled state is harmless even if the parameter lies,
  // because no entitlement is granted or removed by it.
  if (params.status === "cancelled" || params.status === "canceled") {
    redirect(routes.billing({ status: "cancelled" }));
  }

  return (
    <ConfirmSubscription returnTo={safePath(params.returnTo)} />
  );
}
