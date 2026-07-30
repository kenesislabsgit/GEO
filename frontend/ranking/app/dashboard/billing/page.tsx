import { getSessionUser } from "@/lib/auth/session";
import { getAccountEntitlements } from "@/lib/billing/account";
import { getSubscription } from "@/lib/db/repository";
import { PLAN_CONFIG } from "@/lib/billing/entitlements";
import { Badge } from "@/components/ui/badge";
import { BillingActions } from "@/components/billing/billing-actions";

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string; returnTo?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) return null;
  const params = await searchParams;
  const entitlements = await getAccountEntitlements(user.id);
  const subscription = await getSubscription(user.id);
  const plan = PLAN_CONFIG[entitlements.plan];
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
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          Billing
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Usage limits always apply, including during trials.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rb-panel p-5">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Current plan
          </p>
          <div className="mt-2 flex items-center gap-2.5">
            <p className="text-2xl font-semibold tracking-tight">
              {plan.name}
            </p>
            <Badge variant="secondary" className="rounded-full capitalize">
              {entitlements.status}
            </Badge>
          </div>
          {subscription?.current_period_end ? (
            <p className="mt-2 text-sm text-muted-foreground">
              Current period ends{" "}
              {new Date(subscription.current_period_end).toLocaleDateString()}
            </p>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              No active subscription — you&apos;re on the free tier.
            </p>
          )}
        </div>
        <div className="rb-panel p-5">
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
        email={user.email}
        highlightedPlan={params.plan}
        hasSubscription={Boolean(subscription)}
        returnTo={params.returnTo ?? null}
      />
    </div>
  );
}
