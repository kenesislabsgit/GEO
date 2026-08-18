import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin/guard";
import { adminRecentScans, adminStats } from "@/lib/db/repository";
import { MarketingShell } from "@/components/site/marketing-shell";
import { Badge } from "@/components/ui/badge";
import { AdminControls } from "./admin-controls";

export const metadata = {
  robots: { index: false, follow: false },
};

export default async function AdminPage() {
  const admin = await requireAdmin();
  if (!admin.ok) redirect(admin.status === 401 ? "/login" : "/dashboard");

  const [stats, recentScans] = await Promise.all([
    adminStats(),
    adminRecentScans(25),
  ]);

  const cards: Array<[string, string | number]> = [
    ["Users", stats.users],
    ["Brands", stats.brands],
    ["Active subscriptions", stats.activeSubscriptions],
    ["Scans today", stats.scansToday],
    ["Free scans (all time)", stats.freeScanCount],
    ["Ledger spend", `$${stats.estimatedCost.toFixed(2)}`],
    ["Scan spend", `$${stats.scanSpendUsd.toFixed(2)}`],
  ];

  const queueCards: Array<[string, string | number, boolean?]> = [
    ["Queued", stats.queue.queued],
    ["Running", stats.queue.running],
    ["Stale (no heartbeat)", stats.queue.stale, stats.queue.stale > 0],
    ["Failed", stats.queue.failed],
    ["Timed out", stats.queue.timedOut],
    ["Cancelled", stats.queue.cancelled],
    ["Completed", stats.queue.completed],
  ];

  return (
    <MarketingShell>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          Admin
        </h1>
        <Badge
          variant={stats.queue.workerSeenRecently ? "secondary" : "destructive"}
          className="rounded-full"
        >
          {stats.queue.workerSeenRecently
            ? "Worker healthy"
            : "No worker heartbeat in 10 min"}
        </Badge>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Queue health, spend, billing failures, and operational controls.
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map(([label, value]) => (
          <div key={label} className="arc-panel p-5">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {label}
            </p>
            <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
          </div>
        ))}
        <div className="arc-panel p-5">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Provider usage
          </p>
          {Object.keys(stats.providerUsage).length === 0 ? (
            <p className="mt-2 text-2xl font-semibold tracking-tight"> - </p>
          ) : (
            <div className="mt-2.5 space-y-1.5">
              {Object.entries(stats.providerUsage).map(([provider, count]) => (
                <div
                  key={provider}
                  className="flex items-center justify-between text-sm"
                >
                  <span>{provider}</span>
                  <span className="font-mono text-muted-foreground">{count}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <h2 className="mt-10 font-semibold tracking-tight">Audit queue</h2>
      <div className="mt-3 grid gap-4 sm:grid-cols-3 lg:grid-cols-7">
        {queueCards.map(([label, value, alarm]) => (
          <div
            key={label}
            className={`arc-panel p-4 ${alarm ? "border-destructive" : ""}`}
          >
            <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              {label}
            </p>
            <p className="mt-1 text-xl font-semibold">{value}</p>
          </div>
        ))}
      </div>

      <AdminControls />

      <h2 className="mt-10 font-semibold tracking-tight">Recent scans</h2>
      <div className="arc-panel mt-3 overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground">
              <th className="px-4 py-2.5">Brand</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5">Trigger</th>
              <th className="px-4 py-2.5">Attempts</th>
              <th className="px-4 py-2.5">Created</th>
              <th className="px-4 py-2.5">Scan id</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/70">
            {recentScans.map((scan) => (
              <tr key={scan.id}>
                <td className="px-4 py-2.5">{scan.brand_name}</td>
                <td className="px-4 py-2.5">{scan.status}</td>
                <td className="px-4 py-2.5">
                  {scan.trigger_source ?? scan.scan_type}
                </td>
                <td className="px-4 py-2.5">{scan.attempts}</td>
                <td className="px-4 py-2.5 text-muted-foreground">
                  {new Date(scan.created_at).toLocaleString()}
                </td>
                <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                  {scan.id}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mt-10 font-semibold tracking-tight">
        Billing webhook failures
      </h2>
      {stats.webhookFailures.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">None recorded.</p>
      ) : (
        <div className="arc-panel mt-3 divide-y divide-border/70">
          {stats.webhookFailures.map((event) => (
            <div key={event.event_id} className="px-4 py-3 text-sm">
              <span className="font-mono text-xs">{event.event_type}</span>
              <span className="ml-3 text-muted-foreground">{event.error}</span>
            </div>
          ))}
        </div>
      )}

      <h2 className="mt-10 font-semibold tracking-tight">Admin activity</h2>
      {stats.recentAdminActions.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">No actions yet.</p>
      ) : (
        <div className="arc-panel mt-3 divide-y divide-border/70">
          {stats.recentAdminActions.map((entry, index) => (
            <div key={index} className="flex justify-between px-4 py-2.5 text-sm">
              <span>
                {entry.action}
                {entry.target ? (
                  <span className="ml-2 font-mono text-xs text-muted-foreground">
                    {entry.target}
                  </span>
                ) : null}
              </span>
              <span className="text-muted-foreground">
                {entry.admin_email} · {new Date(entry.created_at).toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </MarketingShell>
  );
}
