import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowRight, ArrowUpRight, CheckCircle2 } from "lucide-react";
import { getSessionUser } from "@/lib/auth/session";
import {
  getBrandById,
  getLatestCompletedScanForBrand,
  getQueryResults,
  getRecommendationsForScan,
  scoresForBrand,
} from "@/lib/db/repository";
import { getAccountEntitlements } from "@/lib/billing/account";
import { hasFeature } from "@/lib/billing/entitlements";
import { isPaidSubscription } from "@/lib/billing/is-paid";
import { roundForDisplay } from "@/lib/ai/scoring/score";
import { providerDisplayName } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BrandNav } from "@/components/dashboard/brand-nav";
import { RescanButton } from "@/components/dashboard/rescan-button";
import { ReportVisibilityToggle } from "@/components/dashboard/report-visibility-toggle";
import { routes } from "@/lib/routes";
import { CompetitorLLMChart } from "@/components/dashboard/competitor-llm-chart";
import { AuditCompleteBanner } from "@/components/dashboard/audit-complete-banner";
import type { CompetitorWithLLM } from "@/components/dashboard/competitor-llm-chart";

type CompetitorSignal = {
  name?: string;
  mentions?: number;
  average_rank?: number | null;
  share_of_voice?: number;
  answer_evidence?: Array<{ answer_excerpt?: string; source_urls?: string[] }>;
  website_evidence?: unknown[];
  verified_mentions?: unknown[];
};

export default async function WebsiteReportSummary({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getSessionUser();
  if (!user) return null;
  const { id } = await params;
  const brand = await getBrandById(id);
  if (!brand || brand.owner_id !== user.id) notFound();

  const [scores, entitlements, latestScan] = await Promise.all([
    scoresForBrand(brand.id),
    getAccountEntitlements(user.id),
    getLatestCompletedScanForBrand(brand.id),
  ]);
  const [results, actions] = latestScan
    ? await Promise.all([
        getQueryResults(latestScan.id),
        getRecommendationsForScan(latestScan.id),
      ])
    : [[], []];
  const latest = scores[0];
  const previous = scores[1];
  const isPaid = isPaidSubscription(entitlements);
  const mentionCount = results.filter((result) => result.brand_mentioned).length;
  const testedPromptIds = new Set(
    results.map((result) => result.tracked_prompt_id).filter(Boolean),
  );
  const providers = Array.from(new Set(results.map((result) => result.provider)));
  const sourceUrls = new Set(
    results.flatMap((result) =>
      [
        ...((result.citations as Array<{ url?: string }>) ?? []),
        ...((result.sources as Array<{ url?: string }>) ?? []),
      ]
        .map((citation) => citation.url)
        .filter((url): url is string => Boolean(url)),
    ),
  );
  const competitorSignals = (
    Array.isArray(latest?.competitor_scores)
      ? (latest.competitor_scores as CompetitorSignal[])
      : []
  ).filter((signal) => {
    const answers = signal.answer_evidence ?? [];
    return (
      answers.some((item) => Boolean(item.answer_excerpt?.trim())) &&
      ((signal.website_evidence?.length ?? 0) > 0 ||
        (signal.verified_mentions?.length ?? 0) > 0 ||
        answers.some((item) => (item.source_urls?.length ?? 0) > 0))
    );
  });
  const topCompetitor = competitorSignals[0];
  const topActions = actions
    .filter((action) => action.status === "open")
    .sort((a, b) => a.priority - b.priority)
    .slice(0, 3);
  const mentionRate = results.length ? mentionCount / results.length : 0;
  const verdict =
    mentionRate >= 0.6
      ? "Frequently recommended"
      : mentionRate > 0
        ? "Sometimes recommended"
        : "Not currently recommended";
  const score = latest ? roundForDisplay(Number(latest.overall_score)) : null;
  const scoreDelta =
    latest && previous
      ? roundForDisplay(Number(latest.overall_score) - Number(previous.overall_score))
      : null;

  // ── Compute per-LLM mention counts for each competitor from raw results ──
  // Each QueryResult has a provider + recommended_brands (JSON array of brand names/objects)
  const competitorsWithLLM: CompetitorWithLLM[] = competitorSignals.slice(0, 5).map((signal) => {
    const name = signal.name ?? "";
    const mentionsByProvider: Record<string, number> = {};
    for (const result of results) {
      const brands = Array.isArray(result.recommended_brands)
        ? (result.recommended_brands as Array<string | { name?: string }>)
        : [];
      const mentioned = brands.some((b) => {
        const bName = typeof b === "string" ? b : (b?.name ?? "");
        return bName.toLowerCase().includes(name.toLowerCase()) ||
          name.toLowerCase().includes(bName.toLowerCase());
      });
      if (mentioned) {
        mentionsByProvider[result.provider] = (mentionsByProvider[result.provider] ?? 0) + 1;
      }
    }
    return {
      name,
      mentions: signal.mentions ?? 0,
      average_rank: signal.average_rank,
      mentionsByProvider,
    };
  });

  return (
    <div className="space-y-7">
      <AuditCompleteBanner />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-heading truncate text-2xl font-semibold tracking-tight">
              {brand.name}
            </h1>
            <Badge variant="secondary" className="rounded-full text-[11px]">
              {isPaid ? "Pro report" : "Free report"}
            </Badge>
          </div>
          <p className="mt-1 font-mono text-sm text-muted-foreground">
            {brand.canonical_domain}
            {latestScan ? ` · audited ${new Date(latestScan.created_at).toLocaleDateString()}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <ReportVisibilityToggle
            brandId={brand.id}
            visibility={brand.visibility === "private" ? "private" : "public"}
            canMakePrivate={hasFeature(entitlements.plan, "publicPrivateReports")}
          />
          <Button asChild variant="outline" size="sm">
            <Link href={routes.publicReport(brand.slug)} target="_blank">
              {brand.visibility === "private" ? "Report" : "Public report"}
              <ArrowUpRight data-icon="inline-end" />
            </Link>
          </Button>
          <RescanButton brandId={brand.id} />
        </div>
      </div>

      <section className="rb-panel flex flex-wrap items-center justify-between gap-5 p-5">
        <div className="flex min-w-0 items-start gap-3">
          <span className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full ${mentionRate > 0 ? "bg-[color:var(--rb-green)]/10 text-[color:var(--rb-green)]" : "bg-[color:var(--rb-amber)]/10 text-[color:var(--rb-amber)]"}`}>
            {mentionRate > 0 ? <CheckCircle2 className="size-4" /> : <AlertTriangle className="size-4" />}
          </span>
          <div>
            <p className="text-xs font-medium uppercase text-muted-foreground">Executive verdict</p>
            <h2 className="mt-1 text-lg font-semibold">{verdict}</h2>
            {/* The audit writes this while it still has every finding in front
                of it. The line below is a threshold on one number, so it is
                the fallback for scans recorded before the summary existed. */}
            <p className="mt-1 text-sm text-muted-foreground">
              {latestScan?.summary?.trim()
                ? latestScan.summary
                : `Mentioned in ${mentionCount} of ${results.length} AI answers across ${testedPromptIds.size} buyer questions.`}
            </p>
          </div>
        </div>
        <p className="font-mono text-xs text-muted-foreground">
          {providers.length > 0
            ? providers.map(providerDisplayName).join(" · ")
            : "Run an audit to collect AI answers"}
        </p>
      </section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "AI visibility", value: score ?? "—", detail: scoreDelta ? `${scoreDelta > 0 ? "+" : ""}${scoreDelta} since last audit` : "Composite audit score" },
          { label: "AI mentions", value: `${mentionCount}/${results.length}`, detail: `${testedPromptIds.size} questions tested` },
          { label: "Top competitor", value: topCompetitor?.name ?? "—", detail: topCompetitor ? `${topCompetitor.mentions ?? 0} mentions` : "No competitor signals" },
          { label: "Sources found", value: String(sourceUrls.size), detail: isPaid ? "Grounded citations and verified mentions" : "Details available on Pro" },
        ].map((item) => (
          <div key={item.label} className="rb-panel min-w-0 p-4 sm:p-5">
            <p className="text-[11px] font-medium uppercase text-muted-foreground">{item.label}</p>
            <p className="rb-tabular mt-2 truncate text-xl font-semibold sm:text-2xl">{item.value}</p>
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{item.detail}</p>
          </div>
        ))}
      </div>

      <BrandNav brandId={brand.id} isPaid={isPaid} />

      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold">Who AI recommends instead</h2>
            {isPaid ? <Link href={routes.brandSection(brand.id, "competitors")} className="text-sm text-muted-foreground hover:text-foreground">View evidence</Link> : null}
          </div>
          <div className="rb-panel p-5">
            <CompetitorLLMChart
              competitors={competitorsWithLLM}
              allProviders={providers}
            />
          </div>
        </section>

        <section>
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Top website improvements</h2>
            <Link href={routes.brandSection(brand.id, "actions")} className="text-sm text-muted-foreground hover:text-foreground">View plan</Link>
          </div>
          <div className="mt-3 rb-list">
            {topActions.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-muted-foreground">No improvements generated yet.</p>
            ) : (
              <div className="divide-y divide-border">
                {topActions.map((action, index) => (
                  <Link key={action.id} href={routes.brandSection(brand.id, "actions")} className="flex gap-3 bg-card px-5 py-4 hover:bg-muted/40">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[color:var(--rb-blue-soft)] text-xs font-semibold text-[color:var(--rb-blue)]">{index + 1}</span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{action.title}</p>
                      <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{action.explanation}</p>
                    </div>
                    <ArrowRight className="ml-auto size-3.5 shrink-0 text-muted-foreground" />
                  </Link>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>

      {!isPaid ? (
        <div className="rb-panel-soft flex flex-wrap items-center justify-between gap-4 px-5 py-4">
          <div>
            <p className="text-sm font-medium">Free audit complete</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Upgrade for multi-provider comparison, full competitor evidence, sources, and history.
            </p>
          </div>
          <Button asChild size="sm"><Link href={routes.billing({ plan: "founder", returnTo: routes.brandUpgrade(brand.id) })}>Continue with Pro</Link></Button>
        </div>
      ) : null}
    </div>
  );
}
