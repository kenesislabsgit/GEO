import { FilterField } from "@/components/ui/filter-field";
import { auditStatusLabel } from "@/lib/audit/coverage";
import Link from "next/link";
import { ArrowRight, Plus } from "lucide-react";
import { getSessionUser } from "@/lib/auth/session";
import {
  listBrandsForOwner,
  listScanHistoryForBrands,
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
  completed: "bg-[color:var(--arc-green)]/10 text-[color:var(--arc-green)]",
  partial: "bg-[color:var(--arc-amber)]/15 text-[color:var(--arc-amber)]",
  failed: "bg-destructive/10 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
  running: "bg-[color:var(--arc-accent-soft)] text-[color:var(--arc-accent)]",
  queued: "bg-muted text-muted-foreground",
  cancel_requested: "bg-muted text-muted-foreground",
  timed_out: "bg-destructive/10 text-destructive",
};

export default async function ScansPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    website?: string;
    status?: string;
    after?: string;
  }>;
}) {
  const filters = await searchParams;
  const user = await getSessionUser();
  if (!user) return null;

  const brands = await listBrandsForOwner(user.id);
  const brandMap = new Map(brands.map((b) => [b.id, b]));
  const scans = await listScanHistoryForBrands(brands.map((b) => b.id));
  const rows = scans
    .map((scan) => ({ ...scan, status: scan.status === "completed" && scan.successful_checks < scan.requested_checks ? "partial" as const : scan.status }))
    .filter(
      (scan) =>
        (!filters.website || scan.brand_id === filters.website) &&
        (!filters.status || scan.status === filters.status) &&
        (!filters.after || scan.created_at.slice(0, 10) >= filters.after) &&
        (!filters.q ||
          `${brandMap.get(scan.brand_id)?.name} ${scan.methodology_version}`
            .toLowerCase()
            .includes(filters.q.toLowerCase())),
    )
    .map((scan) => ({
      scan,
      score:
        scan.overall_score === null
          ? null
          : roundForDisplay(scan.overall_score),
      delta:
        scan.sample_key &&
        scan.sample_key === scan.previous_sample_key &&
        scan.overall_score !== null &&
        scan.previous_score !== null
          ? roundForDisplay(scan.overall_score - scan.previous_score)
          : null,
    }));

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
          <Link href={routes.newScan(brands[0]?.id)}>
            <Plus data-icon="inline-start" />
            New audit
          </Link>
        </Button>
      </div>

      <form className="flex flex-wrap gap-2" role="search">
        <FilterField label="Search audit history" wide><input
          aria-label="Search audit history"
          name="q"
          defaultValue={filters.q}
          placeholder="Search audit history"
          className="h-11 w-full min-w-0 shrink-0 rounded-md border border-border bg-background px-3 text-sm"
        /></FilterField>
        <FilterField label="Website"><select
          aria-label="Filter history website"
          name="website"
          defaultValue={filters.website}
          className="h-11 max-w-full rounded-md border border-border bg-background px-2 text-sm"
        >
          <option value="">All websites</option>
          {brands.map((brand) => (
            <option key={brand.id} value={brand.id}>
              {brand.name}
            </option>
          ))}
        </select></FilterField>
        <FilterField label="Status"><select
          aria-label="Filter audit status"
          name="status"
          defaultValue={filters.status}
          className="h-11 rounded-md border border-border bg-background px-2 text-sm"
        >
          <option value="">All statuses</option>
          {Object.keys(STATUS_STYLES).map((status) => (
            <option key={status} value={status}>{auditStatusLabel(status)}</option>
          ))}
        </select></FilterField>
        <FilterField label="Audits on or after"><input
          aria-label="Audits on or after"
          type="date"
          name="after"
          defaultValue={filters.after}
          className="h-11 min-w-0 rounded-md border border-border bg-background px-2 text-sm"
        /></FilterField>
        <Button type="submit" variant="outline">
          Filter
        </Button>
        <Link
          href={routes.scans}
          className="inline-flex min-h-11 items-center px-2 text-sm underline"
        >
          Clear
        </Link>
      </form>
      <p className="text-xs text-muted-foreground">
        AI answers can vary between audits. Swipe the table to see all columns.
      </p>
      {rows.length === 0 ? (
        <div className="arc-empty p-10 text-center">
          <p className="font-medium">No matching audits</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            Try clearing the filters, or run an audit if this account has no
            saved history.
          </p>
          <Button asChild size="sm" className="mt-5">
            <Link href={routes.newScan()}>
              Run an audit
              <ArrowRight data-icon="inline-end" />
            </Link>
          </Button>
        </div>
      ) : (
        <div className="arc-list overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left text-xs font-medium tracking-wide text-muted-foreground uppercase">
                <th className="px-4 py-2.5">Website</th>
                <th className="px-4 py-2.5">Date</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5">AI assistants</th>
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
                return (
                  <tr
                    key={scan.id}
                    className="transition-colors hover:bg-muted/40"
                  >
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
                        {auditStatusLabel(scan.status)}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      <span className="flex items-center gap-2">
                        {scan.provider_ids.map((provider) => (
                          <span
                            key={provider}
                            title={providerDisplayName(provider)}
                          >
                            <ProviderLogo provider={provider} />
                          </span>
                        ))}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground">
                      {scan.question_count ?? "Unavailable"}
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground">
                      {scan.status === "completed" ? "Completed" : (
                        <details className="min-w-40 text-xs">
                          <summary className="cursor-pointer py-2">{scan.successful_checks} answers available</summary>
                          <p>{scan.requested_checks} checks requested · {scan.failed_checks} failed · {Math.max(0, scan.requested_checks - scan.successful_checks - scan.failed_checks)} unavailable</p>
                        </details>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {score !== null ? (
                        <span className="font-semibold">
                          {score}
                          {delta !== null && delta !== 0 ? (
                            <span
                              className={`ml-1.5 text-xs font-medium ${
                                delta > 0
                                  ? "text-[color:var(--arc-green)]"
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
                          href={routes.publicReport(brand.slug, scan.id)}
                          className="text-[color:var(--arc-accent)] hover:underline"
                        >
                          Results
                        </Link>
                      ) : scan.status === "queued" ||
                        scan.status === "running" ||
                        scan.status === "cancel_requested" ||
                        scan.status === "cancelled" ||
                        scan.status === "timed_out" ||
                        scan.status === "failed" ? (
                        <Link
                          href={routes.scanProgress(scan.id)}
                          className="text-[color:var(--arc-accent)] hover:underline"
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
