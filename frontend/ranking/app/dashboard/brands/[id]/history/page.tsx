import { notFound } from "next/navigation";
import Link from "next/link";
import { routes } from "@/lib/routes";
import { getSessionUser } from "@/lib/auth/session";
import { getAccountEntitlements } from "@/lib/billing/account";
import { isPaidSubscription } from "@/lib/billing/is-paid";
import { getBrandById, scoresForBrand, listScanHistoryForBrands } from "@/lib/db/repository";
import { ScoreHistoryChart } from "@/components/dashboard/score-history-chart";
import { roundForDisplay } from "@/lib/scores/format";
import { BrandPageHeader } from "@/components/dashboard/brand-page-header";
import { BrandExportLinks } from "@/components/dashboard/brand-export-links";
import { ProReportLock } from "@/components/dashboard/pro-report-lock";

export default async function HistoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getSessionUser();
  if (!user) return null;
  const { id } = await params;
  const brand = await getBrandById(id);
  if (!brand || brand.owner_id !== user.id) notFound();
  const [scores, entitlements, history] = await Promise.all([
    scoresForBrand(brand.id),
    getAccountEntitlements(user.id),
    listScanHistoryForBrands([brand.id]),
  ]);
  const isPaid = isPaidSubscription(entitlements);
  const chartData = scores.slice().reverse().map((score) => ({
    id: score.scan_run_id,
    date: new Date(score.created_at).toLocaleDateString(),
    score: roundForDisplay(Number(score.overall_score)),
    sampleKey: history.find((run) => run.id === score.scan_run_id)?.sample_key ?? null,
    href: routes.brandSection(brand.id, "prompts") + "?scan=" + encodeURIComponent(score.scan_run_id),
  }));

  return (
    <div className="space-y-6">
      <BrandPageHeader
        brandId={brand.id}
        brandName={brand.name}
        title="Score history"
        description="Your scores over time. AI answers can vary between audits."
        isPaid={isPaid}
        newAudit
      />
      {!isPaid ? (
        <ProReportLock
          title="Unlock audit history"
          description="Track visibility changes, competitor movement, and source gains or losses across repeated audits."
          brandId={brand.id}
        />
      ) : scores.length === 0 ? (
        <div className="arc-empty p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No scored scans yet. Run a scan to start your history.
          </p>
        </div>
      ) : (
        <>
          <BrandExportLinks brandId={brand.id} />
          <div className="arc-panel p-5">
            <ScoreHistoryChart data={chartData} />
            <details className="mt-3 text-xs text-muted-foreground"><summary className="cursor-pointer py-2">About comparisons</summary><p>Lines connect complete audits with matching questions, assistants, market and scoring method. Separate points mark results that cannot be compared. Open an audit to see its coverage.</p></details>
          </div>
          <div className="arc-list">
            <div className="divide-y divide-border">
              {scores.map((s) => (
                <Link
                  key={s.id}
                  href={`${routes.brandSection(brand.id, "prompts")}?scan=${encodeURIComponent(s.scan_run_id)}`}
                  className="flex flex-wrap items-center justify-between gap-3 bg-card px-5 py-3 text-sm hover:bg-muted/50"
                >
                  <span className="text-muted-foreground">
                    {new Date(s.created_at).toLocaleString()}
                  </span>
                  <div className="flex items-center gap-4">

                    <span className="font-mono text-xs text-muted-foreground">
                      mention {roundForDisplay(Number(s.mention_rate) * 100)}%
                    </span>
                    <span className="font-semibold">
                      {roundForDisplay(Number(s.overall_score))}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
