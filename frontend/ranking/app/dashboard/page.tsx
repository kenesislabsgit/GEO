import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  ArrowUpRight,
  Calendar,
  Gauge,
  Globe,
  Layers,
  MessageSquare,
  Zap,
} from "lucide-react";
import { getSessionUser } from "@/lib/auth/session";
import { getAccountEntitlements } from "@/lib/billing/account";
import {
  accountOverviewSeries,
  listBrandsForOwner,
  listScansForBrands,
  scoresForBrand,
} from "@/lib/db/repository";
import { PLAN_CONFIG } from "@/lib/billing/entitlements";
import { Button } from "@/components/ui/button";
import {
  ProviderAnswersChart,
  ProviderAnswersLegend,
  TrendChart,
  type ProviderBarRow,
} from "@/components/dashboard/overview-charts";
import { roundForDisplay } from "@/lib/scores/format";
import { routes } from "@/lib/routes";
import {
  getUsageWarningLevel,
  usageNudgeCopy,
} from "@/lib/billing/usage-warnings";

/**
 * Account dashboard in the reference style: pill-chip header, a hairline
 * KPI band with deltas, one big stacked provider chart, and two trend
 * panels - every number from stored audit data, nothing recomputed.
 */

const SCAN_STATUS_COLOR: Record<string, string> = {
  completed: "text-[color:var(--arc-green)]",
  partial: "text-[color:var(--arc-amber)]",
  running: "text-[color:var(--arc-accent)]",
  queued: "text-muted-foreground",
  cancel_requested: "text-muted-foreground",
  timed_out: "text-destructive",
  failed: "text-destructive",
  cancelled: "text-muted-foreground",
};

function providerBucket(provider: string): keyof Omit<ProviderBarRow, "label"> {
  if (provider.startsWith("openai")) return "openai";
  if (provider === "claude" || provider === "bedrock_claude") return "claude";
  return "others";
}

function Delta({
  value,
  suffix,
  goodWhenUp = true,
}: {
  value: number | null;
  suffix: string;
  goodWhenUp?: boolean;
}) {
  if (value === null || value === 0) {
    return (
      <p className="mt-3 text-[13px] text-muted-foreground">
        no change {suffix}
      </p>
    );
  }
  const good = goodWhenUp ? value > 0 : value < 0;
  return (
    <p className="mt-3 text-[13px] text-muted-foreground">
      <span
        className={good ? "text-[color:var(--arc-green)]" : "text-destructive"}
      >
        {value > 0 ? "+" : ""}
        {value}
      </span>{" "}
      {suffix}
    </p>
  );
}

export default async function DashboardPage() {
  const user = await getSessionUser();
  if (!user) return null;
  const entitlements = await getAccountEntitlements(user.id);
  const brands = await listBrandsForOwner(user.id);
  if (brands.length === 0) redirect(routes.newScan());
  const plan = PLAN_CONFIG[entitlements.plan];

  const [series, ...brandScores] = await Promise.all([
    accountOverviewSeries(user.id),
    ...brands.map((brand) => scoresForBrand(brand.id)),
  ]);
  const brandCards = brands.map((brand, index) => ({
    brand,
    latest: brandScores[index][0],
    previous: brandScores[index][1],
  }));
  const recentScans = (
    await listScansForBrands(brands.map((brand) => brand.id))
  ).slice(0, 6);
  const brandNameById = new Map(brands.map((brand) => [brand.id, brand.name]));

  // ── KPIs, from stored snapshots ───────────────────────────────────────────
  const withLatest = brandCards.filter((card) => card.latest);
  const avg = (values: number[]) =>
    values.length
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : null;
  const avgScore = avg(
    withLatest.map((card) => Number(card.latest!.overall_score)),
  );
  const prevAvgScore = avg(
    brandCards
      .filter((card) => card.previous)
      .map((card) => Number(card.previous!.overall_score)),
  );
  const avgMention = avg(
    withLatest.map((card) => Number(card.latest!.mention_rate) * 100),
  );
  const prevAvgMention = avg(
    brandCards
      .filter((card) => card.previous)
      .map((card) => Number(card.previous!.mention_rate) * 100),
  );
  const scoreDelta =
    avgScore !== null && prevAvgScore !== null
      ? roundForDisplay(avgScore - prevAvgScore)
      : null;
  const mentionDelta =
    avgMention !== null && prevAvgMention !== null
      ? roundForDisplay(avgMention - prevAvgMention)
      : null;

  const usagePct = Math.min(
    100,
    Math.round(
      (entitlements.providerChecksUsed /
        Math.max(plan.features.providerChecksPerMonth, 1)) *
        100,
    ),
  );
  const usageLevel = getUsageWarningLevel(
    entitlements.providerChecksUsed,
    plan.features.providerChecksPerMonth,
  );
  const usageNudge = usageNudgeCopy(usageLevel);

  // ── Chart data ────────────────────────────────────────────────────────────
  const barsByScan = new Map<string, ProviderBarRow & { at: number }>();
  for (const row of series.scans) {
    const key = row.scan_id;
    const existing =
      barsByScan.get(key) ??
      ({
        label: `${row.brand_name.slice(0, 10)} · ${new Date(row.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`,
        at: new Date(row.created_at).getTime(),
        openai: 0,
        claude: 0,
        others: 0,
      } as ProviderBarRow & { at: number });
    existing[providerBucket(row.provider)] += row.answers;
    barsByScan.set(key, existing);
  }
  const providerBars = [...barsByScan.values()]
    .sort((a, b) => a.at - b.at)
    .map((row) => ({
      label: row.label,
      openai: row.openai,
      claude: row.claude,
      others: row.others,
    }));

  const scoreTrend = series.snapshots.map((snapshot) => ({
    date: new Date(snapshot.created_at).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    }),
    value: roundForDisplay(snapshot.overall_score),
  }));
  const mentionTrend = series.snapshots.map((snapshot) => ({
    date: new Date(snapshot.created_at).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    }),
    value: roundForDisplay(snapshot.mention_rate * 100),
  }));
  const scoreAvg =
    scoreTrend.length > 1
      ? roundForDisplay(avg(scoreTrend.map((row) => row.value)) ?? 0)
      : null;
  const mentionAvg =
    mentionTrend.length > 1
      ? roundForDisplay(avg(mentionTrend.map((row) => row.value)) ?? 0)
      : null;

  const kpis = [
    {
      icon: Gauge,
      label: "Visibility score",
      value: avgScore !== null ? String(roundForDisplay(avgScore)) : " - ",
      delta: (
        <Delta value={scoreDelta} suffix="vs. previous audits" />
      ),
    },
    {
      icon: MessageSquare,
      label: "Mention rate",
      value: avgMention !== null ? `${roundForDisplay(avgMention)}%` : " - ",
      delta: (
        <Delta value={mentionDelta} suffix="pts vs. previous audits" />
      ),
    },
    {
      icon: Globe,
      href: routes.brands,
      label: "Websites tracked",
      value: String(entitlements.brandCount),
      delta: (
        <p className="mt-3 text-[13px] text-muted-foreground">
          of {plan.features.brands} on {entitlements.planName}
        </p>
      ),
    },
    {
      icon: Zap,
      href: routes.billing(),
      label: "Provider checks",
      value: String(entitlements.providerChecksUsed),
      delta: (
        <p className="mt-3 text-[13px] text-muted-foreground">
          <span className="text-foreground">{usagePct}%</span>{" "}
          of {plan.features.providerChecksPerMonth} this month
        </p>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      {usageNudge ? (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-border bg-muted/40 px-4 py-3"
        >
          <p className="text-sm text-muted-foreground">{usageNudge}</p>
          <Link
            href={routes.billing()}
            className="shrink-0 text-[13px] font-medium text-[color:var(--arc-accent)] hover:underline"
          >
            See plans
          </Link>
        </div>
      ) : null}

      {/* ── Header row: title left, pill chips right ───────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-xl font-semibold tracking-tight">
          Dashboard
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <span className="arc-chip text-muted-foreground">
            <Layers className="size-3.5" />
            Plan:{" "}
            <span className="font-medium text-foreground">
              {entitlements.planName}
            </span>
          </span>
          <span className="arc-chip text-muted-foreground">
            <Calendar className="size-3.5" />
            Checks:{" "}
            <span className="font-medium text-foreground">
              {entitlements.providerChecksUsed} /{" "}
              {plan.features.providerChecksPerMonth}
            </span>
          </span>
          <Button asChild size="sm">
            <Link href={routes.newScan()}>
              Run an audit
              <ArrowUpRight data-icon="inline-end" />
            </Link>
          </Button>
        </div>
      </div>

      {/* ── KPI band: hairline-divided cells with icon bubbles ─────────── */}
      <div className="arc-panel grid grid-cols-1 divide-y divide-border sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
        {kpis.map(({ icon: Icon, label, value, delta, href }) => {
          const body = (
            <>
              <div className="flex items-center gap-3">
                <span className="flex size-10 items-center justify-center rounded-full bg-[color:var(--arc-accent)] text-white">
                  <Icon className="size-4.5" />
                </span>
                <div>
                  <p className="text-[13px] text-muted-foreground">{label}</p>
                  <p className="arc-tabular text-2xl font-semibold tracking-tight">
                    {value}
                  </p>
                </div>
              </div>
              {delta}
            </>
          );
          return href ? (
            <Link
              key={label}
              href={href}
              className="px-6 py-5 transition-colors hover:bg-muted/30"
            >
              {body}
            </Link>
          ) : (
            <div key={label} className="px-6 py-5">
              {body}
            </div>
          );
        })}
      </div>

      {/* ── Main chart: answers per audit, stacked by provider ─────────── */}
      <section className="arc-panel">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-4">
          <h2 className="text-[15px] font-semibold tracking-tight">
            Provider answers
          </h2>
          <div className="flex flex-wrap items-center gap-4">
            <ProviderAnswersLegend />
            <span className="arc-chip text-muted-foreground">
              <Calendar className="size-3.5" />
              Range:{" "}
              <span className="font-medium text-foreground">
                Last {providerBars.length} audits
              </span>
            </span>
          </div>
        </div>
        <div className="px-4 pt-5 pb-3">
          <ProviderAnswersChart data={providerBars} />
        </div>
      </section>

      {/* ── Two trend panels ───────────────────────────────────────────── */}
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="arc-panel">
          <div className="flex items-center justify-between gap-3 border-b border-border px-6 py-4">
            <h2 className="text-[15px] font-semibold tracking-tight">
              Visibility score
            </h2>
            {scoreAvg !== null ? (
              <span className="arc-chip text-muted-foreground">
                Avg{" "}
                <span className="font-medium text-foreground">{scoreAvg}</span>
              </span>
            ) : null}
          </div>
          <div className="px-4 pt-5 pb-3">
            <TrendChart data={scoreTrend} label="Score" average={scoreAvg} />
          </div>
        </section>
        <section className="arc-panel">
          <div className="flex items-center justify-between gap-3 border-b border-border px-6 py-4">
            <h2 className="text-[15px] font-semibold tracking-tight">
              Mention rate
            </h2>
            {mentionAvg !== null ? (
              <span className="arc-chip text-muted-foreground">
                Avg{" "}
                <span className="font-medium text-foreground">
                  {mentionAvg}%
                </span>
              </span>
            ) : null}
          </div>
          <div className="px-4 pt-5 pb-3">
            <TrendChart
              data={mentionTrend}
              label="Mention rate"
              average={mentionAvg}
              color="green"
            />
          </div>
        </section>
      </div>

      {/* ── Websites and recent audits ─────────────────────────────────── */}
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="arc-panel">
          <div className="flex items-center justify-between gap-3 border-b border-border px-6 py-4">
            <h2 className="text-[15px] font-semibold tracking-tight">
              Websites
            </h2>
            <Link
              href={routes.brands}
              className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              View all
              <ArrowRight className="size-3.5" />
            </Link>
          </div>
          <div className="divide-y divide-border">
            {brandCards.map(({ brand, latest, previous }) => {
              const current = latest
                ? roundForDisplay(Number(latest.overall_score))
                : null;
              const prior = previous
                ? roundForDisplay(Number(previous.overall_score))
                : null;
              const delta =
                current !== null && prior !== null
                  ? Math.round((current - prior) * 10) / 10
                  : null;
              return (
                <Link
                  key={brand.id}
                  href={routes.brand(brand.id)}
                  className="flex items-center justify-between gap-4 px-6 py-3.5 transition-colors hover:bg-muted/40"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-[13px] font-semibold uppercase">
                      {brand.name[0] ?? "?"}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {brand.name}
                      </p>
                      <p className="truncate font-mono text-xs text-muted-foreground">
                        {brand.canonical_domain}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    {delta !== null && delta !== 0 ? (
                      <span
                        className={`text-[13px] ${
                          delta > 0
                            ? "text-[color:var(--arc-green)]"
                            : "text-destructive"
                        }`}
                      >
                        {delta > 0 ? "+" : ""}
                        {delta}
                      </span>
                    ) : null}
                    <span className="arc-tabular text-xl font-semibold tracking-tight">
                      {current ?? " - "}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>

        <section className="arc-panel">
          <div className="flex items-center justify-between gap-3 border-b border-border px-6 py-4">
            <h2 className="text-[15px] font-semibold tracking-tight">
              Recent audits
            </h2>
            <Link
              href={routes.scans}
              className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              View all
              <ArrowRight className="size-3.5" />
            </Link>
          </div>
          <div className="divide-y divide-border">
            {recentScans.length === 0 ? (
              <p className="px-6 py-8 text-sm text-muted-foreground">
                No audits yet.
              </p>
            ) : (
              recentScans.map((scan) => (
                <Link
                  key={scan.id}
                  href={routes.scanProgress(scan.id)}
                  className="flex items-center justify-between gap-4 px-6 py-3.5 transition-colors hover:bg-muted/40"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {brandNameById.get(scan.brand_id) ?? "Website"}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground capitalize">
                      {scan.scan_type === "free" ? "Free audit" : scan.scan_type}
                      {" · "}
                      {new Date(scan.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <span
                    className={`arc-chip capitalize ${SCAN_STATUS_COLOR[scan.status] ?? "text-muted-foreground"}`}
                  >
                    {scan.status.replaceAll("_", " ")}
                  </span>
                </Link>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
