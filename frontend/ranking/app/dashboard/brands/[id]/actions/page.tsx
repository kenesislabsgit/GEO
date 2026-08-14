import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink, Lock } from "lucide-react";
import { getSessionUser } from "@/lib/auth/session";
import { getAccountEntitlements } from "@/lib/billing/account";
import { isPaidSubscription } from "@/lib/billing/is-paid";
import {
  getBrandById,
  getLatestCompletedScanForBrand,
  getRecommendationsForScan,
  scoresForBrand,
} from "@/lib/db/repository";
import { routes } from "@/lib/routes";
import { evidenceText, meaningfulGaps, parseEvidence } from "@/lib/actions/evidence";
import { hasFeature } from "@/lib/billing/entitlements";
import { buildMasterPrompt } from "@/lib/actions/master-prompt";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ActionStatusButtons } from "@/components/dashboard/action-status-buttons";
import { BrandPageHeader } from "@/components/dashboard/brand-page-header";
import { CopyMasterPrompt } from "@/components/dashboard/copy-master-prompt";

/**
 * Impact tracking, honestly scoped: the overall score when the action was
 * marked completed versus the overall score now. It shows correlation, not
 * causation - the copy says "since completing", never "because of".
 */
function scoreDeltaSince(
  scores: Array<{ overall_score: unknown; created_at: string }>,
  completedAt: string,
): number | null {
  if (scores.length < 2) return null;
  const latest = scores[0];
  const baseline = scores.find((snapshot) => snapshot.created_at <= completedAt);
  if (!latest || !baseline || latest === baseline) return null;
  const delta = Number(latest.overall_score) - Number(baseline.overall_score);
  return Number.isFinite(delta) ? delta : null;
}

export default async function WebsiteImprovementsPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return null;
  const { id } = await params;
  const brand = await getBrandById(id);
  if (!brand || brand.owner_id !== user.id) notFound();
  const [latestScan, entitlements, scores] = await Promise.all([
    getLatestCompletedScanForBrand(brand.id),
    getAccountEntitlements(user.id),
    scoresForBrand(brand.id),
  ]);
  const actions = latestScan
    ? await getRecommendationsForScan(latestScan.id)
    : [];
  const isPaid = isPaidSubscription(entitlements);
  const showBriefs = hasFeature(entitlements.plan, "contentBriefs");
  const competitorScores = Array.isArray(scores[0]?.competitor_scores)
    ? (scores[0].competitor_scores as Array<{
        name?: string;
        mentions?: number;
        average_rank?: number | null;
      }>)
    : [];
  const topCompetitor = competitorScores[0];
  const sorted = actions.slice().sort((a, b) => a.priority - b.priority);
  const visibleActions = isPaid ? sorted : sorted.slice(0, 3);
  // Free accounts get the prompt for the fixes they can see, nothing more.
  const masterPrompt = visibleActions.length
    ? buildMasterPrompt({
        brand,
        recommendations: visibleActions,
        latestScore: scores[0] ?? null,
      })
    : null;

  return (
    <div className="space-y-6">
      <BrandPageHeader
        brandId={brand.id}
        brandName={brand.name}
        title="Website Improvements"
        description="Prioritized changes tied to website evidence, competitor patterns, and the AI answers in this audit."
        isPaid={isPaid}
      />
      {masterPrompt ? (
        <section className="rb-panel flex flex-wrap items-center justify-between gap-4 px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <p className="text-sm font-medium">
              Hand this plan to your AI coding tool
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              One prompt with every fix and its evidence - paste it into
              Cursor, Claude Code or Windsurf inside your website&apos;s
              codebase and it implements the plan.
            </p>
          </div>
          <CopyMasterPrompt prompt={masterPrompt} />
        </section>
      ) : null}
      {topCompetitor?.name ? (
        <section className="rb-panel px-5 py-5 sm:px-6">
          <p className="text-[11px] font-semibold uppercase text-muted-foreground">
            Top competitor signal
          </p>
          <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold">{topCompetitor.name}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Appeared in {topCompetitor.mentions ?? 0} AI answers
                {topCompetitor.average_rank
                  ? ` with an average rank of #${topCompetitor.average_rank}`
                  : ""}
                .
              </p>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href={routes.brandSection(brand.id, "competitors")}>
                Review evidence
              </Link>
            </Button>
          </div>
        </section>
      ) : null}
      {visibleActions.length === 0 ? (
        <div className="rb-empty p-8 text-center">
          <p className="text-sm text-muted-foreground">No improvements yet. Run an audit to generate an action plan.</p>
        </div>
      ) : (
        <div className="rb-list">
          <div className="divide-y divide-border">
            {visibleActions.map((action, index) => {
              const evidence = parseEvidence(action.evidence);
              const relevantSources =
                evidence.validationMode === "catalog_ids" ? evidence.sources : [];
              return (
                <div key={action.id} className="bg-card px-5 py-6 sm:px-6">
                  <div className="flex flex-wrap items-start gap-4">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[color:var(--rb-accent-soft)] text-sm font-semibold text-[color:var(--rb-accent)]">{index + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {/* action_type is "content" on every row the audit
                            writes, so the badge only ever repeated itself. */}
                        <Badge variant="secondary" className="rounded-full text-[11px]">Priority {action.priority}</Badge>
                        {action.status !== "open" ? <Badge variant="secondary" className="rounded-full text-[11px] capitalize">{action.status.replaceAll("_", " ")}</Badge> : null}
                      </div>
                      <p className="mt-3 text-[11px] font-semibold uppercase text-muted-foreground">
                        Finding
                      </p>
                      <h2 className="mt-1 text-lg font-semibold leading-snug">{action.title}</h2>

                      {/* The question, who took it and why, then the fix, then
                          the proof. These used to be four blocks in an order
                          that made the reader join them up: the question sat
                          below the advice, and the cited page belonged to a
                          company that had lost the same question. */}
                      {evidence.affectedPrompts.length ? (
                        <div className="mt-4">
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <p className="text-[11px] font-medium uppercase text-muted-foreground">
                              {evidence.affectedPrompts.length === 1
                                ? "The question you lost"
                                : "The questions you lost"}
                            </p>
                            <Link
                              href={routes.brandSection(brand.id, "prompts")}
                              className="text-[11px] text-muted-foreground hover:text-foreground"
                            >
                              See all answers
                            </Link>
                          </div>
                          <ul className="mt-2 space-y-3">
                            {evidence.affectedPrompts.slice(0, 3).map((item, itemIndex) => (
                              <li
                                key={`${item.loss_id ?? item.prompt}-${itemIndex}`}
                                className="border-l-2 border-[color:var(--rb-amber)]/40 pl-3"
                              >
                                <p className="text-xs font-medium leading-relaxed">
                                  {item.prompt}
                                </p>
                                {item.winners?.length ? (
                                  <div className="mt-1.5 space-y-1">
                                    {item.winners.slice(0, 2).map((winner, winnerIndex) => (
                                      <p
                                        key={`${winner.company_name}-${winnerIndex}`}
                                        className="text-[11px] leading-relaxed text-muted-foreground"
                                      >
                                        <span className="font-medium text-foreground">
                                          {winner.company_name}
                                        </span>
                                        {winner.rank ? ` was recommended #${winner.rank}` : " was recommended"}
                                        {winner.reason ? `: ${winner.reason}` : "."}
                                      </p>
                                    ))}
                                  </div>
                                ) : item.recommended_instead?.length ? (
                                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                                    AI recommended{" "}
                                    {item.recommended_instead.slice(0, 3).join(", ")} instead
                                  </p>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}

                      <div className="mt-4 bg-[color:var(--rb-accent-soft)]/45 px-4 py-3">
                        <p className="text-[11px] font-semibold uppercase text-[color:var(--rb-accent)]">
                          Action needed
                        </p>
                        <p className="mt-1.5 text-sm font-medium leading-relaxed">{action.explanation}</p>
                      </div>
                      {showBriefs && action.suggested_content_brief ? (
                        <div className="mt-3 border-l-2 border-border pl-3">
                          <p className="text-[11px] font-medium uppercase text-muted-foreground">
                            Content brief
                          </p>
                          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                            {evidenceText(action.suggested_content_brief)}
                          </p>
                        </div>
                      ) : null}
                      {/* "1 of 1 competitors have this" is a sample of one
                          dressed as a pattern, and on a free audit it can
                          never be anything else. */}
                      {meaningfulGaps(evidence.competitorGaps).length ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {meaningfulGaps(evidence.competitorGaps).map((gap, gapIndex) => (
                            <span
                              key={`${gap.pattern}-${gapIndex}`}
                              className="rb-panel-soft px-3 py-1.5 text-[11px] leading-relaxed"
                            >
                              <span className="font-semibold">
                                {gap.competitors_with_pattern} of {gap.competitors_checked}
                              </span>{" "}
                              recommended competitors have {gap.pattern?.toLowerCase()}
                              {gap.example_competitors?.length
                                ? ` (${gap.example_competitors.slice(0, 3).join(", ")})`
                                : ""}
                              {gap.user_status ? ` · you: ${gap.user_status.toLowerCase()}` : ""}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      {evidence.summary ? (
                        <div className="mt-3 border-l-2 border-[color:var(--rb-accent)]/30 pl-3">
                          <p className="text-[11px] font-medium uppercase text-muted-foreground">Observed evidence</p>
                          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{evidence.summary}</p>
                        </div>
                      ) : null}
                      {relevantSources.length ? (
                        <div className="mt-4">
                          <p className="text-[11px] font-medium uppercase text-muted-foreground">Proof on their website</p>
                          {/* The page title and the link, nothing more. The
                              extract underneath was a raw slice of somebody
                              else's website - it opened with "Skip to main
                              content", carried stray markdown, and said
                              nothing the title had not already said. Anyone
                              who wants the words can open the page. */}
                          <div className="mt-2 divide-y divide-border border-y border-border">
                            {relevantSources.slice(0, 3).map((source, sourceIndex) => (
                              <div key={`${source.url}-${sourceIndex}`} className="py-2.5">
                                <p className="text-xs font-medium">
                                  {[source.company_name, source.page_title || source.label || source.title].filter(Boolean).join(" - ")}
                                </p>
                                {source.url ? (
                                  <a
                                    href={source.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="mt-1 inline-flex items-center gap-1 text-xs text-[color:var(--rb-accent)] hover:underline"
                                  >
                                    Open supporting page <ExternalLink className="size-3" />
                                  </a>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                      {action.estimated_impact ? <p className="mt-3 text-xs"><span className="font-medium">Expected impact:</span> <span className="text-muted-foreground">{action.estimated_impact}</span></p> : null}
                      {hasFeature(entitlements.plan, "impactTracking") &&
                      action.status === "completed" &&
                      action.completed_at
                        ? (() => {
                            const delta = scoreDeltaSince(scores, action.completed_at);
                            if (delta === null) return null;
                            return (
                              <p className="mt-1.5 text-xs">
                                <span className="font-medium">Since completing this:</span>{" "}
                                <span
                                  className={
                                    delta >= 0
                                      ? "text-[color:var(--rb-green)]"
                                      : "text-destructive"
                                  }
                                >
                                  {delta >= 0 ? "+" : ""}
                                  {delta.toFixed(1)} points overall
                                </span>
                              </p>
                            );
                          })()
                        : null}
                    </div>
                    <ActionStatusButtons actionId={action.id} status={action.status} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {!isPaid && sorted.length > visibleActions.length ? (
        <div className="rb-panel-soft flex flex-wrap items-center justify-between gap-4 px-5 py-4">
          <div className="flex items-start gap-3">
            <Lock className="mt-0.5 size-4 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">{sorted.length - visibleActions.length} more improvements available</p>
              <p className="mt-0.5 text-xs text-muted-foreground">Pro includes the full action plan and progress tracking.</p>
            </div>
          </div>
          <Button asChild size="sm"><Link href={routes.billing({ plan: "founder", returnTo: routes.brandUpgrade(brand.id) })}>Continue with Pro</Link></Button>
        </div>
      ) : null}
    </div>
  );
}
