import Link from "next/link";
import { ArrowRight, Plus } from "lucide-react";
import { getSessionUser } from "@/lib/auth/session";
import {
  getScoreForScan,
  listBrandsForOwner,
  listScansForBrands,
  scoresForBrand,
} from "@/lib/db/repository";
import { routes } from "@/lib/routes";
import { providerDisplayName } from "@/lib/constants";
import { ProviderLogo } from "@/components/providers/provider-logo";
import { roundForDisplay } from "@/lib/scores/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/utils";
import type { ScanStatus } from "@/types/database";

export const metadata = { title: "Audit history" };

const STATUS_STYLES: Record<ScanStatus, string> = {
  completed: "bg-[color:var(--rb-green)]/10 text-[color:var(--rb-green)]",
  partial: "bg-[color:var(--rb-amber)]/15 text-[color:var(--rb-amber)]",
  failed: "bg-destructive/10 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
  running: "bg-[color:var(--rb-accent-soft)] text-[color:var(--rb-accent)]",
  queued: "bg-muted text-muted-foreground",
  cancel_requested: "bg-muted text-muted-foreground",
  timed_out: "bg-destructive/10 text-destructive",
};

export default async function ScansPage() {
  const user = await getSessionUser();
  if (!user) return null;

  const brands = await listBrandsForOwner(user.id);
  const brandMap = new Map(brands.map((b) => [b.id, b]));
  const scans = await listScansForBrands(brands.map((b) => b.id));

  // Score + delta per scan (scores ordered newest-first per brand)
  const scoresByBrand = new Map<
    string,
    Awaited<ReturnType<typeof scoresForBrand>>
  >();
  for (const brand of brands) {
    scoresByBrand.set(brand.id, await scoresForBrand(brand.id));
  }

  const rows = await Promise.all(
    scans.map(async (scan) => {
      const score = await getScoreForScan(scan.id);
      const brandScores = scoresByBrand.get(scan.brand_id) ?? [];
      const idx = score
        ? brandScores.findIndex((s) => s.scan_run_id === scan.id)
        : -1;
      const previous = idx >= 0 ? brandScores[idx + 1] : undefined;
      const current = score ? roundForDisplay(Number(score.overall_score)) : null;
      const delta =
        current !== null && previous
          ? Math.round(
              (current - roundForDisplay(Number(previous.overall_score))) * 10,
            ) / 10
          : null;
      return { scan, score: current, delta };
    }),
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Audit history
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every AI visibility audit across your websites, newest first.
          </p>
        </div>
        <Button asChild size="sm">
          <Link href={routes.newScan()}>
            <Plus data-icon="inline-start" />
            New audit
          </Link>
        </Button>
      </div>

      {rows.length === 0 ? (
        <div className="rb-empty p-10 text-center">
          <p className="font-medium">No audits yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            Run your first audit to start measuring your website&apos;s AI visibility.
          </p>
          <Button asChild size="sm" className="mt-5">
            <Link href={routes.newScan()}>
              Run an audit
              <ArrowRight data-icon="inline-end" />
            </Link>
          </Button>
        </div>
      ) : (
        <div className="rb-list overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left text-xs font-medium tracking-wide text-muted-foreground uppercase">
                <th className="px-4 py-2.5">Website</th>
                <th className="px-4 py-2.5">Date</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5">Providers</th>
                <th className="px-4 py-2.5 text-right">Questions</th>
                <th className="px-4 py-2.5 text-right">Checks</th>
                <th className="px-4 py-2.5 text-right">Score</th>
                <th className="px-4 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-card">
              {rows.map(({ scan, score, delta }) => {
                const brand = brandMap.get(scan.brand_id);
                if (!brand) return null;
                const providerCount = scan.provider_ids.length || 1;
                return (
                  <tr key={scan.id} className="transition-colors hover:bg-muted/40">
                    <td className="max-w-44 truncate px-4 py-3 font-medium">
                      {brand.name}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                      {formatDateTime(scan.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        variant="secondary"
                        className={`rounded-full text-[11px] capitalize ${STATUS_STYLES[scan.status]}`}
                      >
                        {scan.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      <span className="flex items-center gap-2">
                        {scan.provider_ids.map((provider) => (
                          <span key={provider} title={providerDisplayName(provider)}>
                            <ProviderLogo provider={provider} />
                          </span>
                        ))}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground">
                      {Math.round(scan.total_queries / providerCount)}
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground">
                      {scan.completed_queries}/{scan.total_queries}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {score !== null ? (
                        <span className="font-semibold">
                          {score}
                          {delta !== null && delta !== 0 ? (
                            <span
                              className={`ml-1.5 text-xs font-medium ${
                                delta > 0
                                  ? "text-[color:var(--rb-green)]"
                                  : "text-destructive"
                              }`}
                            >
                              {delta > 0 ? "+" : ""}
                              {delta}
                            </span>
                          ) : null}
                        </span>
                      ) : (
                        <span className="text-muted-foreground"> - </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {scan.status === "completed" ||
                      scan.status === "partial" ? (
                        <Link
                          href={routes.brand(brand.id)}
                          className="text-[color:var(--rb-accent)] hover:underline"
                        >
                          Report
                        </Link>
                      ) : scan.status === "queued" ||
                        scan.status === "running" ? (
                        <Link
                          href={routes.scanProgress(scan.id)}
                          className="text-[color:var(--rb-accent)] hover:underline"
                        >
                          Progress
                        </Link>
                      ) : null}
                      <Link
                        href={routes.newScan(brand.id)}
                        className="ml-3 text-muted-foreground hover:text-foreground hover:underline"
                      >
                        Rescan
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
