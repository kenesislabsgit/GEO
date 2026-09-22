import Link from "next/link";
import { redirect } from "next/navigation";
import { normalizeDomain } from "@/lib/security/url";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { routes } from "@/lib/routes";
import { getSessionUser } from "@/lib/auth/session";
import { getAccountEntitlements } from "@/lib/billing/account";
import { isPaidSubscription } from "@/lib/billing/is-paid";
import { PLAN_CONFIG, defaultScanProviders } from "@/lib/billing/entitlements";
import {
  getLatestScanForBrand,
  listQuestionSetsForBrands,
  listBrandsForOwner,
  listScansForBrands,
} from "@/lib/db/repository";
import {
  NewScanForm,
  type ScanBrandOption,
} from "@/components/dashboard/new-scan-form";
import { AddBrandScanForm } from "@/components/dashboard/add-brand-scan-form";
import {
  FREE_AUDIT_PROVIDER,
  FREE_AUDIT_QUESTION_COUNT,
  FREE_SCAN_CACHE_DAYS,
  PRO_AUDIT_QUESTION_COUNT,
} from "@/lib/constants";

export const metadata = { title: "New audit" };

export default async function NewScanPage({
  searchParams,
}: {
  searchParams: Promise<{ brand?: string; domain?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) return null;
  const params = await searchParams;

  const [entitlements, brands] = await Promise.all([
    getAccountEntitlements(user.id),
    listBrandsForOwner(user.id),
  ]);
  const plan = PLAN_CONFIG[entitlements.plan];
  if (params.domain?.trim() && brands.length > 0) {
    let domain = params.domain.trim();
    try { domain = normalizeDomain(domain); } catch { /* The add form shows validation errors. */ }
    const existing = brands.find((brand) => brand.canonical_domain === domain);
    redirect(existing
      ? routes.newScan(existing.id)
      : `${routes.addWebsite}?domain=${encodeURIComponent(params.domain)}`);
  }
  const isPaid = isPaidSubscription(entitlements);
  const brandLimitReached =
    brands.length >= plan.features.brands && plan.features.brands > 0;

  const scans = await listScansForBrands(brands.map((b) => b.id));
  let questionSets: Awaited<ReturnType<typeof listQuestionSetsForBrands>> = [];
  try {
    questionSets = await listQuestionSetsForBrands(brands.map((b) => b.id));
  } catch (error) {
    console.error("Could not load earlier audit questions", error);
  }

  const brandOptions: ScanBrandOption[] = await Promise.all(
    brands.map(async (brand) => {
      const lastScan = scans.find((s) => s.brand_id === brand.id);
      // Informational only: shows when this website was last audited by
      // this account. It no longer blocks a repeat audit.
      const cached = isPaid
        ? null
        : await getLatestScanForBrand(brand.id, FREE_SCAN_CACHE_DAYS);
      return {
        id: brand.id,
        name: brand.name,
        domain: brand.canonical_domain,
        category: brand.category,
        slug: brand.slug,
        visibility: brand.visibility,
        questionSets: questionSets
          .filter((set) => set.brandId === brand.id)
          .map((set) => ({
            scanId: set.scanId,
            createdAt: set.createdAt,
            questions: set.questions,
          })),
        lastScanAt: lastScan?.created_at ?? null,
        recentlyScanned: Boolean(cached),
        lastCompletedScanAt: cached?.scan.created_at ?? null,
      };
    }),
  );

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            New audit
          </h1>
          {/* Was hardcoded to "five-question", which is only the free size. */}
          <p className="mt-1 text-sm text-muted-foreground">
            {brands.length === 0
              ? `Add your website and run a ${isPaid ? PRO_AUDIT_QUESTION_COUNT : FREE_AUDIT_QUESTION_COUNT}-question AI visibility audit.`
              : "Choose a website and compare how AI providers answer buyer questions."}
          </p>
        </div>
        {brands.length > 0 && !brandLimitReached ? (
          <Button asChild size="sm" variant="outline">
            <Link href={routes.addWebsite}>
              <Plus data-icon="inline-start" />
              Add a new website
            </Link>
          </Button>
        ) : null}
      </div>

      {brands.length === 0 ? (
        <AddBrandScanForm
          userId={user.id}
          isPaid={isPaid}
          brandLimitReached={false}
          providers={
            isPaid ? defaultScanProviders(entitlements.plan) : [FREE_AUDIT_PROVIDER]
          }
          initialDomain={params.domain}
        />
      ) : (
        <>
          <NewScanForm
            userId={user.id}
            brands={brandOptions}
            preselectedBrandId={params.brand ?? null}
            plan={{
              id: entitlements.plan,
              name: entitlements.planName,
              isPaid,
              allowedProviders: plan.features.providers,
              providersPerScan: plan.features.providersPerScan,
              countries: plan.features.countries,
              languages: plan.features.languages,
              checksLimit: plan.features.providerChecksPerMonth,
              checksUsed: entitlements.providerChecksUsed,
            }}
          />

        </>
      )}
    </div>
  );
}
