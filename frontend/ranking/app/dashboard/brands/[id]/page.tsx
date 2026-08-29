import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowRight, ArrowUpRight, CheckCircle2, Globe } from "lucide-react";
import { getSessionUser } from "@/lib/auth/session";
import {
  getBrandById,
  getLatestCompletedScanForBrand,
  getPrompts,
  getQueryResults,
  getRecommendationsForScan,
  scoresForBrand,
} from "@/lib/db/repository";
import { getAccountEntitlements } from "@/lib/billing/account";
import { hasFeature, PLAN_CONFIG } from "@/lib/billing/entitlements";
import { isPaidSubscription } from "@/lib/billing/is-paid";
import { FREE_AUDIT_ACTION_COUNT } from "@/lib/constants";
import { roundForDisplay } from "@/lib/scores/format";
import { ProviderBadge } from "@/components/providers/provider-logo";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RescanButton } from "@/components/dashboard/rescan-button";
import { routes } from "@/lib/routes";
import { CompetitorLLMChart } from "@/components/dashboard/competitor-llm-chart";
import { AuditCompleteBanner } from "@/components/dashboard/audit-complete-banner";
import { ScoreBreakdown } from "@/components/dashboard/score-breakdown";
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

  const [scores, entitlements, latestScan, trackedPrompts] = await Promise.all([
    scoresForBrand(brand.id),
    getAccountEntitlements(user.id),
    getLatestCompletedScanForBrand(brand.id),
    getPrompts(brand.id),
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
  const evidencedSignals = (snapshot: unknown) =>
    (Array.isArray(snapshot) ? (snapshot as CompetitorSignal[]) : []).filter(
      (signal) => {
        const answers = signal.answer_evidence ?? [];
        return (
          answers.some((item) => Boolean(item.answer_excerpt?.trim())) &&
          ((signal.website_evidence?.length ?? 0) > 0 ||
            (signal.verified_mentions?.length ?? 0) > 0 ||
            answers.some((item) => (item.source_urls?.length ?? 0) > 0))
        );
      },
    );
  const competitorSignals = evidencedSignals(latest?.competitor_scores);
  // Competitors the previous audit surfaced that this one didn't - AI answers
  // churn between runs, and the report should show that instead of silently
  // swapping the list.
  const currentNames = new Set(
    competitorSignals.map((signal) => (signal.name ?? "").toLowerCase()),
  );
  const droppedCompetitors = evidencedSignals(previous?.competitor_scores)
    .filter(
      (signal) => signal.name && !currentNames.has(signal.name.toLowerCase()),
    )
    .slice(0, 4)
    .map((signal) => ({
      name: signal.name as string,
      previousMentions: signal.mentions ?? 0,
    }));
  const topCompetitor = competitorSignals[0];
  const topActions = actions
    .filter((action) => action.status === "open")
    .sort((a, b) => a.priority - b.priority)
    .slice(0, isPaid ? 3 : FREE_AUDIT_ACTION_COUNT);
  // The engine's stored per-question mention rate - never recomputed here.
  // Counting raw rows looked similar but measured question × provider pairs,
  // which drifts from the scored number as soon as providers differ.
  const mentionRate = latest ? Number(latest.mention_rate) : 0;
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

  // Market visibility lives on its own tab now; the summary only needs to
  // know whether market answers exist to point there.
  const hasMarketAnswers = trackedPrompts.some(
    (prompt) =>
      prompt.rationale && prompt.country && prompt.country !== "global",
  );

  // Per-provider competitor mentions come straight from the engine's stored
  // competitor rows. The old substring re-matching here ("AI" matched
  // "OpenAI") produced counts the scored data never contained.
  const competitorsWithLLM: CompetitorWithLLM[] = competitorSignals
    .slice(0, 5)
    .map((signal) => ({
      name: signal.name ?? "",
      mentions: signal.mentions ?? 0,
      average_rank: signal.average_rank,
      mentionsByProvider:
        (signal as { mentions_by_assistant?: Record<string, number> })
          .mentions_by_assistant ?? {},
    }));

  return (
    <div className="space-y-6">
      <AuditCompleteBanner />
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="font-heading truncate text-2xl font-semibold tracking-tight">
              {brand.name}
            </h1>
            <Badge variant="secondary" className="rounded-full text-[11px]">
              {isPaid ? `${PLAN_CONFIG[entitlements.plan].name} report` : "Free report"}
            </Badge>
          </div>
          <p className="mt-1 font-mono text-[13px] text-muted-foreground">
            {brand.canonical_domain}
            {latestScan ? ` · audited ${new Date(latestScan.created_at).toLocaleDateString()}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={routes.publicReport(brand.slug)} target="_blank">
              {brand.visibility === "private" ? "Report" : "Public report"}
              <ArrowUpRight data-icon="inline-end" />
            </Link>
          </Button>
          <RescanButton brandId={brand.id} />
        </div>
      </div>

      <section className="arc-panel flex flex-wrap items-center justify-between gap-5 p-5">
        <div className="flex min-w-0 items-start gap-3">
          <span className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full ${mentionRate > 0 ? "bg-[color:var(--arc-green)]/10 text-[color:var(--arc-green)]" : "bg-[color:var(--arc-amber)]/10 text-[color:var(--arc-amber)]"}`}>
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
        {providers.length > 0 ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 font-mono text-xs text-muted-foreground">
            {providers.map((provider) => (
              <ProviderBadge key={provider} provider={provider} />
            ))}
          </div>
        ) : (
          <p className="font-mono text-xs text-muted-foreground">
            Run an audit to collect AI answers
          </p>
        )}
      </section>

      {/* One stat band, hairline-divided - the quiet Vercel row. */}
      <div className="arc-panel grid grid-cols-2 gap-y-5 p-5 lg:grid-cols-4 lg:gap-y-0 lg:divide-x lg:divide-border">
        {[
          {
            label: "AI visibility",
            value: score ?? " - ",
            delta: scoreDelta,
            detail: scoreDelta ? "since last audit" : "composite score",
          },
          {
            label: "AI mentions",
            value: `${mentionCount}/${results.length}`,
            delta: null,
            detail: `${testedPromptIds.size} questions tested`,
          },
          {
            label: "Top competitor",
            value: topCompetitor?.name ?? " - ",
            delta: null,
            detail: topCompetitor ? `${topCompetitor.mentions ?? 0} mentions` : "no competitor signals",
          },
          {
            label: "Sources found",
            value: String(sourceUrls.size),
            delta: null,
            detail: isPaid ? "citations and verified mentions" : "upgrade for sources",
          },
        ].map((item) => (
          <div key={item.label} className="min-w-0 lg:px-5 lg:first:pl-0 lg:last:pr-0">
            <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              {item.label}
            </p>
            <p className="arc-tabular mt-1.5 truncate text-2xl font-semibold tracking-tight">
              {item.value}
              {item.delta ? (
                <span
                  className={`ml-2 text-sm font-medium ${
                    item.delta > 0
                      ? "text-[color:var(--arc-green)]"
                      : "text-destructive"
                  }`}
                >
                  {item.delta > 0 ? "↑" : "↓"}
                  {Math.abs(item.delta)}
                </span>
              ) : null}
            </p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{item.detail}</p>
          </div>
        ))}
      </div>
      {latest ? (
        <div className="arc-panel px-5 py-4">
          <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            Score breakdown
          </p>
          <ScoreBreakdown snapshot={latest} />
        </div>
      ) : null}


      {hasMarketAnswers ? (
        <Link
          href={routes.brandSection(brand.id, "markets")}
          className="arc-panel flex items-center justify-between gap-4 px-5 py-3.5 transition-colors hover:bg-muted/40"
        >
          <span className="flex min-w-0 items-center gap-2.5 text-sm">
            <Globe className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate">
              <span className="font-medium">Market visibility measured</span>
              <span className="text-muted-foreground">
                {" "}
 - see where AI recommends you, continent by continent.
              </span>
            </span>
          </span>
          <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </Link>
      ) : null}

      <div className="grid items-start gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        {/* Vercel card pattern: the header lives inside the card, separated
            by a hairline; content rows divide the rest. */}
        <section className="arc-panel overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <h2 className="text-sm font-medium">Who AI recommends instead</h2>
            {isPaid ? (
              <Link
                href={routes.brandSection(brand.id, "competitors")}
                className="text-[13px] text-muted-foreground transition-colors hover:text-foreground"
              >
                View evidence
              </Link>
            ) : null}
          </div>
          <div className="p-5">
            <CompetitorLLMChart
              competitors={competitorsWithLLM}
              allProviders={providers}
              dropped={droppedCompetitors}
            />
          </div>
        </section>

        <section className="arc-panel overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <h2 className="text-sm font-medium">Top action centre items</h2>
            <Link
              href={routes.brandSection(brand.id, "actions")}
              className="text-[13px] text-muted-foreground transition-colors hover:text-foreground"
            >
              View plan
            </Link>
          </div>
          {topActions.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-muted-foreground">
              No improvements generated yet.
            </p>
          ) : (
            <div className="divide-y divide-border">
              {topActions.map((action, index) => (
                <Link
                  key={action.id}
                  href={routes.brandSection(brand.id, "actions")}
                  className="flex gap-3 px-5 py-3.5 transition-colors hover:bg-muted/40"
                >
                  <span className="arc-tabular mt-0.5 shrink-0 font-mono text-xs text-muted-foreground">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{action.title}</p>
                    <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                      {action.explanation}
                    </p>
                  </div>
                  <ArrowRight className="ml-auto size-3.5 shrink-0 self-center text-muted-foreground" />
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>

      {!isPaid ? (
        <div className="arc-panel-soft flex flex-wrap items-center justify-between gap-4 px-5 py-4">
          <div>
            <p className="text-sm font-medium">Free audit complete</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Upgrade for multi-provider comparison, full competitor evidence, sources, and history.
            </p>
          </div>
          <Button asChild size="sm"><Link href={routes.billing({ plan: "founder", returnTo: routes.brandUpgrade(brand.id) })}>Continue with Plus</Link></Button>
        </div>
      ) : null}
    </div>
  );
}
