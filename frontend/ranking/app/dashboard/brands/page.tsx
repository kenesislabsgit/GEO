import Link from "next/link";
import { ArrowUpRight, Plus } from "lucide-react";
import { getSessionUser } from "@/lib/auth/session";
import { getAccountEntitlements } from "@/lib/billing/account";
import { PLAN_CONFIG } from "@/lib/billing/entitlements";
import { isPaidSubscription } from "@/lib/billing/is-paid";
import {
  getBrandMonitoringSettings,
  listBrandsForOwner,
} from "@/lib/db/repository";
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
  const monitoring = new Map(
    await Promise.all(
      brands.map(
        async (brand) =>
          [brand.id, await getBrandMonitoringSettings(brand.id)] as const,
      ),
    ),
  );
  const enabledBrands = brands.filter(
    (brand) => monitoring.get(brand.id)?.enabled,
  );
  const monitoringLabel = (brand: (typeof brands)[number]) => {
    const settings = monitoring.get(brand.id);
    if (!settings?.enabled) return "Monitoring off";
    if (!isPaid || !plan.features.weeklyMonitoring)
      return "Monitoring paused · upgrade your plan";
    const position = enabledBrands.filter(
      (other) => other.created_at <= brand.created_at,
    ).length;
    if (position > plan.features.brands)
      return "Monitoring paused · website limit reached";
    if (entitlements.providerChecksUsed >= plan.features.providerChecksPerMonth)
      return "Monitoring paused · no checks remaining";
    const questions = settings.monitoringQuestions ?? [];
    if (
      questions.length !== 5 ||
      questions.some((question) => question.trim().length < 5) ||
      new Set(questions.map((question) => question.trim().toLowerCase()))
        .size !== 5
    )
      return "Finish monitoring setup";
    return "Monitoring scheduled";
  };
  const atLimit = brands.length >= plan.features.brands;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Websites
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {brands.length} of {plan.features.brands} on {entitlements.planName}{" "}
            - company websites you monitor and audit.
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
              <Link href={routes.addWebsite}>
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

      {brands.length > plan.features.brands ? (
        <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
          Your saved websites exceed this plan&apos;s {plan.features.brands}
          -website limit. Existing reports remain available; adding websites is
          blocked. Review paused websites below, or upgrade to cover more
          websites.
        </p>
      ) : null}
      {brands.length === 0 ? (
        <div className="arc-empty p-10 text-center">
          <p className="font-medium">No websites yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            Add your company website and run your first AI visibility audit.
          </p>
          <Button asChild size="sm" className="mt-5">
            <Link href={routes.addWebsite}>Add a website</Link>
          </Button>
        </div>
      ) : (
        <div className="arc-list">
          <div className="divide-y divide-border">
            {brands.map((brand) => (
              <div
                key={brand.id}
                className="flex items-center justify-between gap-4 bg-card px-5 py-4 transition-colors hover:bg-muted/50"
              >
                <div className="min-w-0">
                  <Link
                    href={routes.brand(brand.id)}
                    className="block min-h-6 truncate font-medium hover:underline"
                  >
                    {brand.name}
                  </Link>
                  <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                    {brand.canonical_domain}
                  </p>
                  <Link
                    href={routes.brand(brand.id) + "/settings"}
                    className="mt-1 inline-flex min-h-11 items-center text-xs text-muted-foreground underline"
                  >
                    {monitoringLabel(brand)}
                  </Link>
                </div>
                <Badge
                  variant="secondary"
                  className="shrink-0 rounded-full text-[11px] capitalize"
                >
                  {brand.visibility}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      )}

      {!isPaid && atLimit ? (
        <p className="text-sm text-muted-foreground">
          The Free plan tracks one website.{" "}
          <Link
            href={routes.billing()}
            className="font-medium text-[color:var(--arc-accent)] hover:underline"
          >
            Upgrade
          </Link>{" "}
          to monitor up to {PLAN_CONFIG.agency.features.brands} with Pro.
        </p>
      ) : null}
    </div>
  );
}
