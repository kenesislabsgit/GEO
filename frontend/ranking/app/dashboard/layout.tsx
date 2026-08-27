import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionUser, isAdminEmail } from "@/lib/auth/session";
import { REQUEST_PATH_HEADER } from "@/lib/auth/redirects";
import { getAccountEntitlements } from "@/lib/billing/account";
import {
  countUnreadAlerts,
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
  const [account, unreadAlerts, brands] = await Promise.all([
    getAccountEntitlements(user.id),
    countUnreadAlerts(user.id),
    listBrandsForOwner(user.id),
  ]);
  const paid =
    account.plan !== "free" &&
    (account.status === "active" || account.status === "trialing");
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
      {children}
    </DashboardShell>
  );
}
