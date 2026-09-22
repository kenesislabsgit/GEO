import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { getBrandById } from "@/lib/db/repository";
import { BrandPageHeader } from "@/components/dashboard/brand-page-header";
import { getAccountEntitlements } from "@/lib/billing/account";
import { isPaidSubscription } from "@/lib/billing/is-paid";
import { BrandMonitoringForm } from "@/components/dashboard/brand-monitoring-form";
import { PLAN_CONFIG } from "@/lib/billing/entitlements";
import { ReportVisibilityToggle } from "@/components/dashboard/report-visibility-toggle";

export const metadata = { title: "Website settings" };

export default async function BrandSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getSessionUser();
  if (!user) return null;
  const { id } = await params;
  const brand = await getBrandById(id);
  if (!brand || brand.owner_id !== user.id) notFound();
  const entitlements = await getAccountEntitlements(user.id);
  const isPaid = isPaidSubscription(entitlements);
  const canEdit =
    entitlements.providerChecksUsed <
    PLAN_CONFIG[entitlements.plan].features.providerChecksPerMonth;

  return (
    <div className="space-y-6">
      <BrandPageHeader
        brandId={brand.id}
        brandName={brand.name}
        title="Settings"
        description="Monitoring schedule, market, and alert preferences for this website. Changes apply from the next scheduled audit."
        isPaid={isPaid}
      />
      <section id="visibility" className="arc-panel scroll-mt-24 space-y-3 p-6">
        <h2 className="text-sm font-semibold">
          Report visibility: {brand.visibility}
        </h2>
        <p className="text-sm text-muted-foreground">
          {brand.visibility === "private"
            ? "Only you can access this website’s reports."
            : "Anyone with the link can read report previews. Search engines may index them."}
        </p>
        <ReportVisibilityToggle
          brandId={brand.id}
          visibility={brand.visibility}
          canMakePrivate={isPaid}
        />
      </section>
      <BrandMonitoringForm
        key={brand.id}
        brandId={brand.id}
        isPaid={isPaid}
        canEdit={canEdit}
      />
    </div>
  );
}
