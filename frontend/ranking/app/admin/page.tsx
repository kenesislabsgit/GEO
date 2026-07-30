import { redirect } from "next/navigation";
import { getSessionUser, isAdminEmail } from "@/lib/auth/session";
import { adminStats, usingLocalDb } from "@/lib/db/repository";
import { MarketingShell } from "@/components/site/marketing-shell";
import { Badge } from "@/components/ui/badge";

export const metadata = {
  robots: { index: false, follow: false },
};

export default async function AdminPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!isAdminEmail(user.email) && process.env.NODE_ENV === "production") {
    redirect("/dashboard");
  }
  // In development, allow any signed-in user if ADMIN_EMAILS unset.
  if (process.env.ADMIN_EMAILS && !isAdminEmail(user.email)) {
    redirect("/dashboard");
  }

  const stats = await adminStats();

  const cards: Array<[string, string | number]> = [
    ["Users", stats.users],
    ["Brands", stats.brands],
    ["Active subscriptions", stats.activeSubscriptions],
    ["Scans today", stats.scansToday],
    ["Failed scans", stats.failedScans],
    ["Est. API cost", `$${stats.estimatedCost.toFixed(2)}`],
    ["Free scans", stats.freeScanCount],
  ];

  return (
    <MarketingShell>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          Admin
        </h1>
        <Badge variant="secondary" className="rounded-full">
          {usingLocalDb() ? "Local demo store" : "Supabase"}
        </Badge>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Cost and abuse monitoring.
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map(([label, value]) => (
          <div
            key={label}
            className="rb-panel p-5"
          >
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {label}
            </p>
            <p className="mt-2 text-2xl font-semibold tracking-tight">
              {value}
            </p>
          </div>
        ))}
        <div className="rb-panel p-5">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Provider usage
          </p>
          {Object.keys(stats.providerUsage).length === 0 ? (
            <p className="mt-2 text-2xl font-semibold tracking-tight">—</p>
          ) : (
            <div className="mt-2.5 space-y-1.5">
              {Object.entries(stats.providerUsage).map(([provider, count]) => (
                <div
                  key={provider}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="capitalize">{provider}</span>
                  <span className="font-mono text-muted-foreground">
                    {count}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mt-8 rb-panel p-6">
        <h2 className="font-semibold tracking-tight">Operational controls</h2>
        <ul className="mt-3 space-y-2">
          {[
            "Disable providers via app_settings.providers_disabled in Supabase",
            "Retry failed scans from scan_runs where status = failed",
            "Free-scan abuse: inspect free_scan_requests grouped by ip_hash",
            "Revenue estimate uses active subscription plan list prices",
          ].map((item) => (
            <li
              key={item}
              className="flex gap-2.5 text-sm text-muted-foreground"
            >
              <span className="mt-2 size-1 shrink-0 rounded-full bg-foreground/40" />
              {item}
            </li>
          ))}
        </ul>
      </div>
    </MarketingShell>
  );
}
