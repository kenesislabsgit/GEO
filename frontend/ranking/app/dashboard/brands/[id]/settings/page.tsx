import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { getBrandById } from "@/lib/db/repository";
import { BrandPageHeader } from "@/components/dashboard/brand-page-header";
import { getAccountEntitlements } from "@/lib/billing/account";
import { isPaidSubscription } from "@/lib/billing/is-paid";
import { BrandMonitoringForm } from "@/components/dashboard/brand-monitoring-form";

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

  return (
    <div className="space-y-6">
      <BrandPageHeader
        brandId={brand.id}
        brandName={brand.name}
        title="Settings"
        description="Monitoring schedule, market, and alert preferences for this website. Changes apply from the next scheduled audit."
        isPaid={isPaid}
      />
      <BrandMonitoringForm brandId={brand.id} isPaid={isPaid} />
    </div>
  );
}
