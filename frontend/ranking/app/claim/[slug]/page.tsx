import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { getBrandBySlug } from "@/lib/db/repository";
import { MarketingShell } from "@/components/site/marketing-shell";
import { ClaimVerificationCard } from "./claim-verification-card";
import { routes } from "@/lib/routes";

export const metadata = { title: "Claim this report" };

/**
 * Claiming a company report now means proving control of its domain. This
 * page hands out the verification token and checks it - ownership never
 * moves on a click alone.
 */
export default async function ClaimPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const user = await getSessionUser();
  if (!user) {
    redirect(routes.login({ claim: slug, mode: "signup" }));
  }
  const brand = await getBrandBySlug(slug);
  if (!brand) notFound();
  if (brand.owner_id === user.id) {
    redirect(routes.brand(brand.id));
  }

  return (
    <MarketingShell narrow>
      <p className="rb-eyebrow">Claim report</p>
      <h1 className="font-heading mt-3 text-3xl font-semibold tracking-tight">
        Prove you control {brand.canonical_domain}
      </h1>
      <p className="mt-4 max-w-xl text-muted-foreground">
        Anyone can read a public report; owning it takes proof. Publish the
        verification token below on your domain, then check. The token stays
        valid for 48 hours.
      </p>
      <div className="mt-8">
        <ClaimVerificationCard slug={slug} domain={brand.canonical_domain} />
      </div>
    </MarketingShell>
  );
}
