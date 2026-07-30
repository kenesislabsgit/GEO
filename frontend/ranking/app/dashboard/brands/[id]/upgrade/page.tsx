import { notFound, redirect } from "next/navigation";
import { UpgradeAuditProgress } from "@/components/dashboard/upgrade-audit-progress";
import { getSessionUser } from "@/lib/auth/session";
import { getAccountEntitlements } from "@/lib/billing/account";
import { isPaidSubscription } from "@/lib/billing/is-paid";
import { PLAN_CONFIG } from "@/lib/billing/entitlements";
import { getBrandById } from "@/lib/db/repository";
import { routes } from "@/lib/routes";

export default async function UpgradeAuditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getSessionUser();
  if (!user) return null;
  const { id } = await params;
  const [brand, entitlements] = await Promise.all([
    getBrandById(id),
    getAccountEntitlements(user.id),
  ]);
  if (!brand || brand.owner_id !== user.id) notFound();
  if (!isPaidSubscription(entitlements)) {
    redirect(
      routes.billing({
        plan: "founder",
        returnTo: routes.brandUpgrade(brand.id),
      }),
    );
  }

  return (
    <UpgradeAuditProgress
      brandId={brand.id}
      domain={brand.canonical_domain}
      providers={[...PLAN_CONFIG[entitlements.plan].features.providers]}
    />
  );
}
