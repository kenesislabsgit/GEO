import { getSessionUser } from "@/lib/auth/session";
import { getAccountEntitlements } from "@/lib/billing/account";
import { PLAN_CONFIG } from "@/lib/billing/entitlements";
import {
  getLatestScanForBrand,
  getPrompts,
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
  const isPaid =
    entitlements.plan !== "free" &&
    (entitlements.status === "active" || entitlements.status === "trialing");
  const brandLimitReached =
    brands.length >= plan.features.brands && plan.features.brands > 0;

  const scans = await listScansForBrands(brands.map((b) => b.id));

  const brandOptions: ScanBrandOption[] = await Promise.all(
    brands.map(async (brand) => {
      const prompts = await getPrompts(brand.id);
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
        prompts: prompts.map((p) => ({
          id: p.id,
          prompt: p.prompt,
          type: p.prompt_type,
          country: p.country,
          language: p.language,
        })),
        lastScanAt: lastScan?.created_at ?? null,
        recentlyScanned: Boolean(cached),
        lastCompletedScanAt: cached?.scan.created_at ?? null,
      };
    }),
  );

  return (
    <div className="space-y-8">
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

      {brands.length === 0 ? (
        <AddBrandScanForm
          isPaid={isPaid}
          brandLimitReached={false}
          providers={isPaid ? [...plan.features.providers] : [FREE_AUDIT_PROVIDER]}
          initialDomain={params.domain}
        />
      ) : (
        <>
          <NewScanForm
            brands={brandOptions}
            preselectedBrandId={params.brand ?? null}
            plan={{
              id: entitlements.plan,
              name: entitlements.planName,
              isPaid,
              allowedProviders: plan.features.providers,
              countries: plan.features.countries,
              languages: plan.features.languages,
              checksLimit: plan.features.providerChecksPerMonth,
              checksUsed: entitlements.providerChecksUsed,
            }}
          />
          {isPaid && !brandLimitReached ? (
            <div className="border-t border-border pt-8">
              <h2 className="mb-4 text-sm font-semibold tracking-tight">
                Or add another website
              </h2>
              <AddBrandScanForm
                isPaid={isPaid}
                brandLimitReached={false}
                providers={[...plan.features.providers]}
              />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
