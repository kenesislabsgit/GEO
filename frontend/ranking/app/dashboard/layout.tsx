import { redirect } from "next/navigation";
import { getSessionUser, isAdminEmail } from "@/lib/auth/session";
import Link from "next/link";
import { getAccountEntitlements } from "@/lib/billing/account";
import { countUnreadAlerts, getUserOnboarding } from "@/lib/db/repository";
import { routes } from "@/lib/routes";
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
  if (!user) redirect("/login");
  const [account, unreadAlerts, onboarding] = await Promise.all([
    getAccountEntitlements(user.id),
    countUnreadAlerts(user.id),
    getUserOnboarding(user.id),
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
    >
      {setupPending ? (
        <Link
          href={routes.onboarding}
          className="mb-6 flex items-center justify-between rounded-lg border border-[color:var(--rb-blue)]/30 bg-[color:var(--rb-blue-soft)] px-4 py-3 text-sm transition-colors hover:border-[color:var(--rb-blue)]/50"
        >
          <span>
            <span className="font-medium">Finish setting up your plan</span>
            <span className="ml-2 text-muted-foreground">
              Competitors, questions and monitoring — a few minutes.
            </span>
          </span>
          <span className="font-medium text-[color:var(--rb-blue)]">
            Continue setup
          </span>
        </Link>
      ) : null}
      {children}
    </DashboardShell>
  );
}
