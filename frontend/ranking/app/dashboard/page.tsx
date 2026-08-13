import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { getSessionUser } from "@/lib/auth/session";
import { getAccountEntitlements } from "@/lib/billing/account";
import {
  listBrandsForOwner,
  listScansForBrands,
  scoresForBrand,
} from "@/lib/db/repository";
import { PLAN_CONFIG } from "@/lib/billing/entitlements";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { roundForDisplay } from "@/lib/ai/scoring/score";
import { routes } from "@/lib/routes";
import {
  getUsageWarningLevel,
  usageWarningMessage,
} from "@/lib/billing/usage-warnings";

/**
 * Tiny server-rendered trend line — the last dozen scores as one stroke.
 * No chart library for a 72x20 line.
 */
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const width = 72;
  const height = 20;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width;
      const y = height - 2 - ((value - min) / span) * (height - 4);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      aria-hidden
      className="shrink-0"
    >
      <polyline
        points={points}
        fill="none"
        stroke="var(--rb-blue)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const SCAN_STATUS_COLOR: Record<string, string> = {
  completed: "text-[color:var(--rb-green)]",
  partial: "text-[color:var(--rb-amber)]",
  running: "text-[color:var(--rb-blue)]",
  queued: "text-muted-foreground",
  failed: "text-destructive",
  cancelled: "text-muted-foreground",
};

export default async function DashboardPage() {
  const user = await getSessionUser();
  if (!user) return null;
  const entitlements = await getAccountEntitlements(user.id);
  const brands = await listBrandsForOwner(user.id);
  if (brands.length === 0) redirect(routes.newScan());
  if (brands.length === 1) redirect(routes.brand(brands[0].id));
  const plan = PLAN_CONFIG[entitlements.plan];

  const brandCards = await Promise.all(
    brands.map(async (brand) => {
      const scores = await scoresForBrand(brand.id);
      return {
        brand,
        latest: scores[0],
        previous: scores[1],
        // Oldest-to-newest tail for the sparkline.
        trend: scores
          .slice(0, 12)
          .reverse()
          .map((snapshot) => Number(snapshot.overall_score))
          .filter((value) => Number.isFinite(value)),
      };
    }),
  );
  const recentScans = (
    await listScansForBrands(brands.map((brand) => brand.id))
  ).slice(0, 5);
  const brandNameById = new Map(brands.map((brand) => [brand.id, brand.name]));

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
  const usageMessage = usageWarningMessage(usageLevel);

  const stats = [
    {
      label: "Plan",
      value: entitlements.planName,
      detail: entitlements.status,
    },
    {
      label: "Websites",
      value: `${entitlements.brandCount}`,
      detail: `of ${plan.features.brands} allowed`,
    },
    {
      label: "Active prompts",
      value: `${entitlements.activePromptCount}`,
      detail: `of ${plan.features.activePrompts} allowed`,
    },
  ];

  return (
    <div className="space-y-10">
      {usageMessage ? (
        <Alert variant={usageLevel === "exhausted" ? "destructive" : "default"}>
          <AlertTitle>
            {usageLevel === "exhausted"
              ? "Usage limit reached"
              : "Usage warning"}
          </AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>{usageMessage}</span>
            {usageLevel === "exhausted" || usageLevel === "warn80" ? (
              <Button asChild size="sm" variant="outline">
                <Link href={routes.billing()}>View billing</Link>
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Overview
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your AI visibility at a glance.
          </p>
        </div>
        <Button asChild size="sm">
          <Link href={routes.newScan()}>
            Run an audit
            <ArrowUpRight data-icon="inline-end" />
          </Link>
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="rb-panel p-5"
          >
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {stat.label}
            </p>
            <p className="rb-tabular mt-2 text-2xl font-semibold tracking-tight capitalize">
              {stat.value}
            </p>
            <p className="mt-1 text-xs text-muted-foreground capitalize">
              {stat.detail}
            </p>
          </div>
        ))}
        <div className="rb-panel p-5">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Provider checks
          </p>
          <p className="rb-tabular mt-2 text-2xl font-semibold tracking-tight">
            {entitlements.providerChecksUsed}
            <span className="text-sm font-normal text-muted-foreground">
              {" "}
              / {plan.features.providerChecksPerMonth}
            </span>
          </p>
          <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full rounded-full ${usagePct >= 90 ? "bg-destructive" : "bg-foreground"}`}
              style={{ width: `${usagePct}%` }}
            />
          </div>
        </div>
      </div>

      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight">Websites</h2>
          <Link
            href={routes.brands}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            View all
            <ArrowRight className="size-3.5" />
          </Link>
        </div>
        {brandCards.length === 0 ? (
          <div className="mt-4 rb-empty p-10 text-center">
            <p className="font-medium">No brands yet</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
              Add your company website and run a scan from the dashboard — you
              stay signed in the whole time.
            </p>
            <Button asChild size="sm" className="mt-5">
              <Link href={routes.newScan()}>
                Run a scan
                <ArrowRight data-icon="inline-end" />
              </Link>
            </Button>
          </div>
        ) : (
          <div className="mt-4 rb-list">
            <div className="divide-y divide-border">
              {brandCards.map(({ brand, latest, previous, trend }) => {
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
                    className="flex items-center justify-between gap-4 bg-card px-5 py-4 transition-colors hover:bg-muted/50"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{brand.name}</p>
                      <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                        {brand.canonical_domain}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <Sparkline values={trend} />
                      {delta !== null && delta !== 0 ? (
                        <Badge
                          variant="secondary"
                          className={`rounded-full text-[11px] ${
                            delta > 0
                              ? "text-[color:var(--rb-green)]"
                              : "text-destructive"
                          }`}
                        >
                          {delta > 0 ? "+" : ""}
                          {delta}
                        </Badge>
                      ) : null}
                      <span className="rb-tabular text-2xl font-semibold tracking-tight">
                        {current ?? "—"}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {recentScans.length > 0 ? (
        <section>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold tracking-tight">
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
          <div className="mt-4 rb-list">
            <div className="divide-y divide-border">
              {recentScans.map((scan) => (
                <Link
                  key={scan.id}
                  href={routes.scanProgress(scan.id)}
                  className="flex items-center justify-between gap-4 bg-card px-5 py-3.5 transition-colors hover:bg-muted/50"
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
                    className={`text-xs font-medium capitalize ${SCAN_STATUS_COLOR[scan.status] ?? "text-muted-foreground"}`}
                  >
                    {scan.status.replaceAll("_", " ")}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
