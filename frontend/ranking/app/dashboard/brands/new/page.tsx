import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getSessionUser } from "@/lib/auth/session";
import { getAccountEntitlements } from "@/lib/billing/account";
import {
  PLAN_CONFIG,
  defaultScanProviders,
} from "@/lib/billing/entitlements";
import { isPaidSubscription } from "@/lib/billing/is-paid";
import { FREE_AUDIT_PROVIDER } from "@/lib/constants";
import { listBrandsForOwner } from "@/lib/db/repository";
import { AddBrandScanForm } from "@/components/dashboard/add-brand-scan-form";
import { routes } from "@/lib/routes";

export const metadata = { title: "Add a website" };

/**
 * Adding a website is its own page - the same focused experience as the
 * very first audit: type the domain, start the audit, watch it run right
 * here. No scrolling to the bottom of another page.
 */
export default async function AddWebsitePage({
  searchParams,
}: {
  searchParams: Promise<{ domain?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) return null;
  const [entitlements, brands, params] = await Promise.all([
    getAccountEntitlements(user.id),
    listBrandsForOwner(user.id),
    searchParams,
  ]);
  const plan = PLAN_CONFIG[entitlements.plan];
  const isPaid = isPaidSubscription(entitlements);
  const brandLimitReached = brands.length >= plan.features.brands;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <div>
        <Link
          href={routes.brands}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Websites
        </Link>
        <h1 className="font-heading mt-3 text-2xl font-semibold tracking-tight">
          Add a website
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {brandLimitReached
            ? `Your ${entitlements.planName} plan tracks ${plan.features.brands} website${plan.features.brands === 1 ? "" : "s"} (${brands.length} in use).`
            : `Website ${brands.length + 1} of ${plan.features.brands} on ${entitlements.planName}. The first audit starts as soon as you add it.`}
        </p>
      </div>

      <AddBrandScanForm
        isPaid={isPaid}
        brandLimitReached={brandLimitReached}
        providers={
          isPaid ? defaultScanProviders(entitlements.plan) : [FREE_AUDIT_PROVIDER]
        }
        initialDomain={params.domain}
      />
    </div>
  );
}
