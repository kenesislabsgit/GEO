import { redirect } from "next/navigation";
import { getSessionUser, isAdminEmail } from "@/lib/auth/session";
import { getAccountEntitlements } from "@/lib/billing/account";
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
  const account = await getAccountEntitlements(user.id);
  const paid =
    account.plan !== "free" &&
    (account.status === "active" || account.status === "trialing");
  return (
    <DashboardShell
      email={user.email}
      isAdmin={isAdminEmail(user.email)}
      planName={paid ? account.planName : "Free"}
      paid={paid}
    >
      {children}
    </DashboardShell>
  );
}
