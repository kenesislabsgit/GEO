import { Bell, TrendingDown, TrendingUp, Users } from "lucide-react";
import { getSessionUser } from "@/lib/auth/session";
import { listAlerts } from "@/lib/db/repository";
import { Badge } from "@/components/ui/badge";

function alertIcon(type: string) {
  if (type.includes("drop")) return TrendingDown;
  if (type.includes("gain") || type.includes("improve")) return TrendingUp;
  if (type.includes("competitor")) return Users;
  return Bell;
}

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
          Material score changes, competitor movements, and citation shifts
          from scheduled monitoring.
        </p>
      </div>
      {alerts.length === 0 ? (
        <div className="rb-empty p-10 text-center">
          <Bell className="mx-auto size-5 text-muted-foreground" />
          <p className="mt-3 font-medium">No alerts yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            Scheduled monitoring creates alerts when your score moves, a
            competitor overtakes you, or a citation appears or disappears.
          </p>
        </div>
      ) : (
        <div className="rb-list">
          <div className="divide-y divide-border">
            {alerts.map((alert) => {
              const Icon = alertIcon(alert.type);
              return (
                <div key={alert.id} className="flex gap-4 bg-card px-5 py-4">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted">
                    <Icon className="size-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{alert.title}</p>
                      <Badge
                        variant="secondary"
                        className="rounded-full text-[11px] capitalize"
                      >
                        {alert.type.replaceAll("_", " ")}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {alert.body}
                    </p>
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      {new Date(alert.created_at).toLocaleString()}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
