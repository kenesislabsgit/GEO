import { getSessionUser } from "@/lib/auth/session";
import { usingLocalDb } from "@/lib/db/repository";
import { Badge } from "@/components/ui/badge";
import { ExportDeleteForms } from "@/components/dashboard/export-delete-forms";

export default async function SettingsPage() {
  const user = await getSessionUser();
  if (!user) return null;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          Settings
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Account, data export, and deletion.
        </p>
      </div>

      <div className="rb-panel">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <p className="text-sm font-medium">Email</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {user.email}
            </p>
          </div>
        </div>
        <div className="flex items-center justify-between px-5 py-4">
          <div>
            <p className="text-sm font-medium">Data persistence</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Where your account data is stored.
            </p>
          </div>
          <Badge variant="secondary" className="rounded-full">
            {usingLocalDb() ? "Local demo store" : "Supabase"}
          </Badge>
        </div>
      </div>

      <ExportDeleteForms />
    </div>
  );
}
