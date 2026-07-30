import { redirect } from "next/navigation";
import { getSessionUser, isAdminEmail } from "@/lib/auth/session";
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
  return (
    <DashboardShell email={user.email} isAdmin={isAdminEmail(user.email)}>
      {children}
    </DashboardShell>
  );
}
