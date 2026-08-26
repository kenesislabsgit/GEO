import { redirect } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { getSessionUser } from "@/lib/auth/session";
import { getAccountEntitlements } from "@/lib/billing/account";
import { createCheckoutSession } from "@/lib/billing/create-checkout";
import { isPaidSubscription } from "@/lib/billing/is-paid";
import type { PlanId } from "@/lib/billing/entitlements";
import {
  GROWTH_WAITLIST_HREF,
  PRO_CONTACT_HREF,
  isSelfServePlan,
  type BillingInterval,
} from "@/lib/billing/pricing";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { routes } from "@/lib/routes";

export const metadata = { title: "Starting checkout" };

function parseStartParams(input: {
  plan?: string;
  interval?: string;
}): { plan: PlanId; interval: BillingInterval } | null {
  if (
    input.plan !== "founder" &&
    input.plan !== "growth" &&
    input.plan !== "agency"
  ) {
    return null;
  }
  if (input.interval !== "monthly" && input.interval !== "yearly") {
    return null;
  }
  return { plan: input.plan, interval: input.interval };
}

function requestOrigin(headerList: Headers): string {
  const envOrigin = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (envOrigin) return envOrigin;
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host");
  const proto = headerList.get("x-forwarded-proto") ?? "http";
  if (!host) {
    throw new Error("Checkout origin is missing");
  }
  return `${proto}://${host}`;
}

export default async function CheckoutStartPage({
  searchParams,
}: {
  searchParams: Promise<{
    plan?: string;
    interval?: string;
    returnTo?: string;
  }>;
}) {
  const user = await getSessionUser();
  if (!user) return null;

  const params = await searchParams;
  const parsed = parseStartParams(params);
  if (!parsed) {
    redirect(routes.billing());
  }

  if (!isSelfServePlan(parsed.plan)) {
    redirect(parsed.plan === "agency" ? PRO_CONTACT_HREF : GROWTH_WAITLIST_HREF);
  }

  const entitlements = await getAccountEntitlements(user.id);
  if (isPaidSubscription(entitlements)) {
    redirect(routes.billing());
  }

  let origin: string;
  try {
    origin = requestOrigin(await headers());
  } catch {
    return (
      <CheckoutStartError
        message="Checkout is not available right now. Contact support."
        retryHref={null}
      />
    );
  }

  const result = await createCheckoutSession({
    user,
    plan: parsed.plan,
    interval: parsed.interval,
    returnTo: params.returnTo,
    origin,
  });

  if (result.ok) {
    redirect(result.url);
  }

  return (
    <CheckoutStartError
      message={result.error}
      retryHref={routes.checkoutStart({
        plan: parsed.plan,
        interval: parsed.interval,
        ...(params.returnTo ? { returnTo: params.returnTo } : {}),
      })}
    />
  );
}

function CheckoutStartError({
  message,
  retryHref,
}: {
  message: string;
  retryHref: string | null;
}) {
  return (
    <div className="mx-auto max-w-lg space-y-4">
      <Alert variant="destructive">
        <AlertTitle>Could not start checkout</AlertTitle>
        <AlertDescription>{message}</AlertDescription>
      </Alert>
      <div className="flex flex-wrap gap-2">
        {retryHref ? (
          <Button asChild size="sm">
            <Link href={retryHref}>Try again</Link>
          </Button>
        ) : null}
        <Button asChild size="sm" variant="outline">
          <Link href={routes.billing()}>Back to billing</Link>
        </Button>
      </div>
    </div>
  );
}
