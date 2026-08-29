import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { getAccountEntitlements } from "@/lib/billing/account";
import { isPaidSubscription } from "@/lib/billing/is-paid";
import { getBrandById, scoresForBrand } from "@/lib/db/repository";
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
  const [scores, entitlements] = await Promise.all([
    scoresForBrand(brand.id),
    getAccountEntitlements(user.id),
  ]);
  const isPaid = isPaidSubscription(entitlements);
  const chartData = scores
    .slice()
    .reverse()
    .map((s) => ({
      date: new Date(s.created_at).toLocaleDateString(),
      score: roundForDisplay(Number(s.overall_score)),
    }));
  // Scores from different methodology versions are not directly comparable;
  // when history spans a version change, say so instead of drawing one
  // silent line through both.
  const versions = Array.from(
    new Set(scores.map((s) => s.methodology_version ?? "unversioned")),
  );
  const mixedVersions = versions.length > 1;

  return (
    <div className="space-y-6">
      <BrandPageHeader
        brandId={brand.id}
        brandName={brand.name}
        title="Score history"
        description="How your AI Visibility Score has moved across scans. AI answers are non-deterministic, so single runs vary - judge the trend, not one audit."
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
          {mixedVersions ? (
            <div className="rounded-lg border border-[color:var(--arc-amber)]/40 bg-[color:var(--arc-amber)]/10 px-4 py-3 text-sm">
              This history spans methodology versions ({versions.join(", ")}).
              Scores are comparable within a version; treat changes across the
              boundary as a new baseline, not a movement.
            </div>
          ) : null}
          <div className="arc-panel p-5">
            <ScoreHistoryChart data={chartData} />
          </div>
          <div className="arc-list">
            <div className="divide-y divide-border">
              {scores.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between bg-card px-5 py-3 text-sm"
                >
                  <span className="text-muted-foreground">
                    {new Date(s.created_at).toLocaleString()}
                  </span>
                  <div className="flex items-center gap-4">
                    {mixedVersions ? (
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {s.methodology_version ?? "unversioned"}
                      </span>
                    ) : null}
                    <span className="font-mono text-xs text-muted-foreground">
                      mention {roundForDisplay(Number(s.mention_rate) * 100)}%
                    </span>
                    <span className="font-semibold">
                      {roundForDisplay(Number(s.overall_score))}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
