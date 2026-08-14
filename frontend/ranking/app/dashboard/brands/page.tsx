import Link from "next/link";
import { ArrowUpRight, Plus } from "lucide-react";
import { getSessionUser } from "@/lib/auth/session";
import { getAccountEntitlements } from "@/lib/billing/account";
import { PLAN_CONFIG } from "@/lib/billing/entitlements";
import { isPaidSubscription } from "@/lib/billing/is-paid";
import { listBrandsForOwner } from "@/lib/db/repository";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { routes } from "@/lib/routes";

export const metadata = { title: "Websites" };

export default async function BrandsPage() {
  const user = await getSessionUser();
  if (!user) return null;
  const [brands, entitlements] = await Promise.all([
    listBrandsForOwner(user.id),
    getAccountEntitlements(user.id),
  ]);
  const plan = PLAN_CONFIG[entitlements.plan];
  const isPaid = isPaidSubscription(entitlements);
  const atLimit = brands.length >= plan.features.brands;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Websites
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {brands.length} of {plan.features.brands} on{" "}
            {entitlements.planName} - company websites you monitor and audit.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {atLimit && brands.length > 0 ? (
            <Button asChild size="sm" variant="outline">
              <Link href={routes.billing()}>
                Upgrade for more websites
                <ArrowUpRight data-icon="inline-end" />
              </Link>
            </Button>
          ) : (
            <Button asChild size="sm">
              <Link
                href={
                  brands.length === 0
                    ? routes.newScan()
                    : `${routes.newScan()}#add-website`
                }
              >
                <Plus data-icon="inline-start" />
                Add website
              </Link>
            </Button>
          )}
          {brands.length > 0 ? (
            <Button asChild size="sm" variant="outline">
              <Link href={routes.newScan()}>
                New audit
                <ArrowUpRight data-icon="inline-end" />
              </Link>
            </Button>
          ) : null}
        </div>
      </div>

      {brands.length === 0 ? (
        <div className="rb-empty p-10 text-center">
          <p className="font-medium">No websites yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            Add your company website and run your first AI visibility audit.
          </p>
          <Button asChild size="sm" className="mt-5">
            <Link href={routes.newScan()}>Run an audit</Link>
          </Button>
        </div>
      ) : (
        <div className="rb-list">
          <div className="divide-y divide-border">
            {brands.map((brand) => (
              <Link
                key={brand.id}
                href={`/dashboard/brands/${brand.id}`}
                className="flex items-center justify-between gap-4 bg-card px-5 py-4 transition-colors hover:bg-muted/50"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{brand.name}</p>
                  <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                    {brand.canonical_domain}
                  </p>
                </div>
                <Badge
                  variant="secondary"
                  className="shrink-0 rounded-full text-[11px] capitalize"
                >
                  {brand.visibility}
                </Badge>
              </Link>
            ))}
          </div>
        </div>
      )}

      {!isPaid && atLimit ? (
        <p className="text-sm text-muted-foreground">
          The Free plan tracks one website.{" "}
          <Link
            href={routes.billing()}
            className="font-medium text-[color:var(--rb-accent)] hover:underline"
          >
            Upgrade
          </Link>{" "}
          to monitor up to {PLAN_CONFIG.growth.features.brands} with Pro+.
        </p>
      ) : null}
    </div>
  );
}
