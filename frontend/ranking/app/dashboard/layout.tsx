import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionUser, isAdminEmail } from "@/lib/auth/session";
import { REQUEST_PATH_HEADER } from "@/lib/auth/redirects";
import Link from "next/link";
import { getAccountEntitlements } from "@/lib/billing/account";
import {
  countUnreadAlerts,
  getUserOnboarding,
  listBrandsForOwner,
} from "@/lib/db/repository";
import { routes, safeReturnTo } from "@/lib/routes";
import { DashboardShell } from "@/components/dashboard/shell";

export const metadata = {
  robots: { index: false, follow: false },
};

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  if (!user) {
    const returnTo = safeReturnTo(
      (await headers()).get(REQUEST_PATH_HEADER),
    );
    redirect(returnTo ? routes.login({ returnTo }) : routes.login());
  }
  const [account, unreadAlerts, onboarding, brands] = await Promise.all([
    getAccountEntitlements(user.id),
    countUnreadAlerts(user.id),
    getUserOnboarding(user.id),
    listBrandsForOwner(user.id),
  ]);
  const paid =
    account.plan !== "free" &&
    (account.status === "active" || account.status === "trialing");
  const setupPending = paid && !onboarding?.completed;
  return (
    <DashboardShell
      email={user.email}
      isAdmin={isAdminEmail(user.email)}
      planName={paid ? account.planName : "Free"}
      paid={paid}
      unreadAlerts={unreadAlerts}
      brands={brands.map((brand) => ({
        id: brand.id,
        name: brand.name,
        domain: brand.canonical_domain,
      }))}
    >
      {setupPending ? (
        <Link
          href={routes.onboarding}
          className="mb-6 flex items-center justify-between rounded-full border border-transparent bg-[color:var(--arc-accent-soft)] px-5 py-3 text-sm transition-colors hover:border-[color:var(--arc-accent)]/40"
        >
          <span>
            <span className="font-medium">Finish setting up your plan</span>
            <span className="ml-2 text-muted-foreground">
              Competitors, questions and monitoring - a few minutes.
            </span>
          </span>
          <span className="font-medium text-[color:var(--arc-accent)]">
            Continue setup
          </span>
        </Link>
      ) : null}
      {children}
    </DashboardShell>
  );
}
