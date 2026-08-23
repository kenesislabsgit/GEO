import { getSessionUser } from "@/lib/auth/session";
import { getAccountEntitlements } from "@/lib/billing/account";
import { getLatestSubscription } from "@/lib/db/repository";
import { PLAN_CONFIG } from "@/lib/billing/entitlements";
import { Badge } from "@/components/ui/badge";
import { BillingActions } from "@/components/billing/billing-actions";

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{
    plan?: string;
    returnTo?: string;
    status?: string;
    interval?: string;
  }>;
}) {
  const user = await getSessionUser();
  if (!user) return null;
  const params = await searchParams;
  const entitlements = await getAccountEntitlements(user.id);
  // Latest subscription whatever its status: a past_due plan must show as
  // past_due with a working Manage button, not silently read as "free".
  const subscription = await getLatestSubscription(user.id);
  const plan = PLAN_CONFIG[subscription?.plan ?? "free"];
  const planStatus = subscription?.status ?? entitlements.status;
  const usagePct = Math.min(
    100,
    Math.round(
      (entitlements.providerChecksUsed /
        Math.max(plan.features.providerChecksPerMonth, 1)) *
        100,
    ),
  );

  return (
    <div className="space-y-8">
      {params.status === "cancelled" ? (
        <div className="rounded-lg border border-border bg-[color:var(--arc-mist)] px-4 py-3 text-sm">
          <p className="font-medium">Checkout was cancelled</p>
          <p className="mt-0.5 text-muted-foreground">
            No subscription was activated and nothing was charged. Pick a plan
            below whenever you&apos;re ready.
          </p>
        </div>
      ) : null}
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          Billing
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Usage limits always apply, including during trials.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="arc-panel p-5">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Current plan
          </p>
          <div className="mt-2 flex items-center gap-2.5">
            <p className="text-2xl font-semibold tracking-tight">
              {plan.name}
            </p>
            <Badge variant="secondary" className="rounded-full capitalize">
              {planStatus}
            </Badge>
          </div>
          {subscription?.current_period_end ? (
            <p className="mt-2 text-sm text-muted-foreground">
              Current period ends{" "}
              {new Date(subscription.current_period_end).toLocaleDateString()}
            </p>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              No active subscription - you&apos;re on the free tier.
            </p>
          )}
        </div>
        <div className="arc-panel p-5">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Provider checks this month
          </p>
          <p className="mt-2 text-2xl font-semibold tracking-tight">
            {entitlements.providerChecksUsed}
            <span className="text-sm font-normal text-muted-foreground">
              {" "}
              / {plan.features.providerChecksPerMonth}
            </span>
          </p>
          <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full rounded-full ${usagePct >= 90 ? "bg-destructive" : "bg-foreground"}`}
              style={{ width: `${usagePct}%` }}
            />
          </div>
        </div>
      </div>

      <BillingActions
        highlightedPlan={params.plan}
        highlightedInterval={
          params.interval === "yearly" || params.interval === "monthly"
            ? params.interval
            : undefined
        }
        hasSubscription={Boolean(subscription)}
        returnTo={params.returnTo ?? null}
      />
    </div>
  );
}
