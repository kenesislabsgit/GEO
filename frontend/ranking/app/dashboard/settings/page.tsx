import { headers } from "next/headers";
import { auth } from "@/lib/auth/auth";
import { getSessionUser } from "@/lib/auth/session";
import { q } from "@/lib/db/pg";
import { ExportDeleteForms } from "@/components/dashboard/export-delete-forms";
import { SecuritySettings } from "@/components/dashboard/security-settings";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await getSessionUser();
  if (!user) return null;

  // Which ways this account can sign in. "credential" means a password.
  const accounts = await q<{ providerId: string }>(
    `select "providerId" from account where "userId" = $1`,
    [user.id],
  );
  const hasPassword = accounts.some((a) => a.providerId === "credential");
  const hasGoogle = accounts.some((a) => a.providerId === "google");

  const profile = (
    await q<{ name: string | null; emailVerified: boolean }>(
      `select name, "emailVerified" from "user" where id = $1`,
      [user.id],
    )
  )[0];

  const requestHeaders = await headers();
  const sessions = await auth.api
    .listSessions({ headers: requestHeaders })
    .catch(() => []);
  const currentSession = await auth.api
    .getSession({ headers: requestHeaders })
    .catch(() => null);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          Settings
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Account, sign-in security, data export, and deletion.
        </p>
      </div>

      <SecuritySettings
        name={profile?.name ?? ""}
        email={user.email}
        emailVerified={Boolean(profile?.emailVerified)}
        hasPassword={hasPassword}
        hasGoogle={hasGoogle}
        sessions={sessions.map((s) => ({
          token: s.token,
          createdAt:
            s.createdAt instanceof Date
              ? s.createdAt.toISOString()
              : String(s.createdAt),
          userAgent: s.userAgent ?? null,
          current: s.token === currentSession?.session?.token,
        }))}
      />

      <ExportDeleteForms />
    </div>
  );
}
