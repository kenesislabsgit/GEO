import { getSessionUser } from "@/lib/auth/session";
import { listAlerts } from "@/lib/db/repository";
import { AlertList } from "@/components/dashboard/alert-list";

export const metadata = { title: "Alerts" };

export default async function AlertsPage() {
  const user = await getSessionUser();
  if (!user) return null;
  const alerts = await listAlerts(user.id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          Alerts
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          AI responses can vary; these alerts highlight repeated changes across
          recent audits to help you track visibility, competitors, and cited
          sources over time.
        </p>
      </div>
      <AlertList alerts={alerts} />
    </div>
  );
}
