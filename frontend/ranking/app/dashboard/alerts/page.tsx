import { getSessionUser } from "@/lib/auth/session";
import {
  listAlerts,
  listBrandsForOwner,
  listScanHistoryForBrands,
} from "@/lib/db/repository";
import { AlertList } from "@/components/dashboard/alert-list";

export const metadata = { title: "Alerts" };

export default async function AlertsPage() {
  const user = await getSessionUser();
  if (!user) return null;
  const alerts = await listAlerts(user.id);
  const brands = await listBrandsForOwner(user.id);
  const history = await listScanHistoryForBrands(
    brands.map((brand) => brand.id),
  );
  const explainedAlerts = alerts.map((alert) => {
    const meta =
      alert.metadata &&
      typeof alert.metadata === "object" &&
      !Array.isArray(alert.metadata)
        ? alert.metadata
        : {};
    const scanId =
      alert.scan_run_id ??
      (typeof meta.scanId === "string" ? meta.scanId : undefined);
    const run = history.find((row) => row.id === scanId);
    const earlier = run
      ? history
          .filter(
            (row) =>
              row.brand_id === run.brand_id &&
              row.overall_score !== null &&
              row.created_at < run.created_at,
          )
          .slice(0, 2)
      : [];
    const comparison = ["score_change", "mention_lost"].includes(alert.type);
    const verified =
      run?.sample_key &&
      earlier.length === 2 &&
      earlier.every((row) => row.sample_key === run.sample_key);
    return {
      ...alert,
      scan_run_id: scanId,
      website_name: brands.find((brand) => brand.id === alert.brand_id)?.name,
      comparison_notice:
        comparison && !verified
          ? "The baseline’s questions, providers, coverage or methodology differ or cannot be verified. Treat these as separate audit snapshots, not a confirmed performance change."
          : undefined,
    };
  });

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
      <AlertList alerts={explainedAlerts} />
    </div>
  );
}
