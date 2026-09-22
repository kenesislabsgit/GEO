import Link from "next/link";
import { notFound } from "next/navigation";
import { Lock } from "lucide-react";
import { getSessionUser } from "@/lib/auth/session";
import { getAccountEntitlements } from "@/lib/billing/account";
import { isPaidSubscription } from "@/lib/billing/is-paid";
import {
  getBrandById,
  getLatestCompletedScanForBrand,
  getRecommendationsForScan,
  scoresForBrand,
  listScanHistoryForBrands,
} from "@/lib/db/repository";
import { routes } from "@/lib/routes";
import {
  evidenceText,
  meaningfulGaps,
  parseEvidence,
} from "@/lib/actions/evidence";
import { hasFeature } from "@/lib/billing/entitlements";
import { buildMasterPrompt } from "@/lib/actions/master-prompt";
import { passageUrl } from "@/lib/reports/evidence";
import { Button } from "@/components/ui/button";
import { ActionStatusButtons } from "@/components/dashboard/action-status-buttons";
import { BrandPageHeader } from "@/components/dashboard/brand-page-header";
import { CopyMasterPrompt } from "@/components/dashboard/copy-master-prompt";
import {
  EntityMark,
  SourceMark,
  ValueMark,
  sourceHost,
} from "@/components/dashboard/inline-mark";

/**
 * Impact tracking, honestly scoped: the overall score when the action was
 * marked completed versus the overall score now. It shows correlation, not
 * causation - the copy says "since completing", never "because of".
 */
function scoreDeltaSince(
  scores: Array<{
    overall_score: unknown;
    created_at: string;
    scan_run_id: string;
  }>,
  sampleKeys: Map<string, string | null>,
  completedAt: string,
): number | null {
  if (scores.length < 2) return null;
  const latest = scores[0];
  const baseline = scores.find(
    (snapshot) => snapshot.created_at <= completedAt,
  );
  if (
    !latest ||
    !baseline ||
    latest === baseline ||
    !sampleKeys.get(latest.scan_run_id) ||
    sampleKeys.get(latest.scan_run_id) !== sampleKeys.get(baseline.scan_run_id)
  )
    return null;
  const delta = Number(latest.overall_score) - Number(baseline.overall_score);
  return Number.isFinite(delta) ? delta : null;
}

function taskHeading(title: string, instruction: string): string {
  if (title.length <= 85) return title;
  const firstLine = instruction.trim().split(/\n|(?<=[.!?])\s|\s+\([a-z]\)|\s+that\b/i)[0] || title;
  if (firstLine.length <= 85) return firstLine;
  return `${firstLine.slice(0, 82).replace(/\s+\S*$/, "")}…`;
}

export default async function WebsiteImprovementsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getSessionUser();
  if (!user) return null;
  const { id } = await params;
  const brand = await getBrandById(id);
  if (!brand || brand.owner_id !== user.id) notFound();
  const [latestScan, entitlements, scores, history] = await Promise.all([
    getLatestCompletedScanForBrand(brand.id),
    getAccountEntitlements(user.id),
    scoresForBrand(brand.id),
    listScanHistoryForBrands([brand.id]),
  ]);
  const sampleKeys = new Map(history.map((row) => [row.id, row.sample_key]));
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
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <BrandPageHeader
            brandId={brand.id}
            brandName={brand.name}
            title="Website Improvements"
            description="What to change, in order."
            isPaid={isPaid}
          />
          {topCompetitor?.name ? (
            <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
              <EntityMark name={topCompetitor.name} />
              {" appeared in "}
              <ValueMark>{topCompetitor.mentions ?? 0} answers</ValueMark>
              {topCompetitor.average_rank ? (
                <>
                  {", average position "}
                  <ValueMark tone="warn">
                    {topCompetitor.average_rank}
                  </ValueMark>
                </>
              ) : null}
              .
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {topCompetitor?.name ? (
            <Button asChild variant="ghost" size="sm">
              <Link href={routes.brandSection(brand.id, "competitors")}>
                Competitor evidence
              </Link>
            </Button>
          ) : null}
          {masterPrompt ? <CopyMasterPrompt prompt={masterPrompt} /> : null}
        </div>
      </div>
      {visibleActions.length === 0 ? (
        <div className="arc-empty p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No improvements yet. Run an audit to generate an action plan.
          </p>
        </div>
      ) : (
        <ol className="divide-y divide-border border-y border-border">
          {visibleActions.map((action, index) => {
            const evidence = parseEvidence(action.evidence);
            const relevantSources =
              evidence.validationMode === "catalog_ids" ? evidence.sources : [];
            const lostQuestions = evidence.affectedPrompts.slice(0, 3);
            const gaps = meaningfulGaps(evidence.competitorGaps);
            const scoreMove =
              hasFeature(entitlements.plan, "impactTracking") &&
              action.status === "completed" &&
              action.completed_at
                ? scoreDeltaSince(scores, sampleKeys, action.completed_at)
                : null;
            const hasProof =
              lostQuestions.length > 0 ||
              Boolean(showBriefs && action.suggested_content_brief) ||
              gaps.length > 0 ||
              Boolean(evidence.summary) ||
              relevantSources.length > 0 ||
              Boolean(action.estimated_impact) ||
              scoreMove !== null;
            const meta = [
              lostQuestions.length
                ? `${lostQuestions.length} question${lostQuestions.length === 1 ? "" : "s"}`
                : null,
              relevantSources.length
                ? `${relevantSources.length} page${relevantSources.length === 1 ? "" : "s"}`
                : null,
            ].filter(Boolean);
            return (
              <li
                key={action.id}
                className="grid gap-3 py-5 sm:grid-cols-[2rem_minmax(0,1fr)_auto] sm:items-start sm:gap-5"
              >
                <span className="arc-tabular pt-1 font-mono text-xs text-muted-foreground">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                    <h2 className="text-[15px] font-semibold leading-snug tracking-tight">
                      {taskHeading(action.title, action.explanation)}
                    </h2>
                    {action.status !== "open" ? (
                      <span className="font-mono text-[11px] text-muted-foreground capitalize">
                        {action.status.replaceAll("_", " ")}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-3 max-w-2xl rounded-lg bg-muted/50 p-3 text-sm leading-relaxed [overflow-wrap:anywhere]">
                    <p className="mb-1 font-medium">Suggested action</p>
                    <p>{action.explanation}</p>
                  </div>
                  <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
                    {lostQuestions[0]?.prompt ? (
                      <>
                        <>Recommended instead</>
                        {lostQuestions[0].winners?.[0]?.company_name ? (
                          <>
                            {": "}
                            <EntityMark
                              name={lostQuestions[0].winners[0].company_name}
                            />
                            {lostQuestions[0].winners[0].rank ? (
                              <>
                                {" at "}
                                <ValueMark tone="warn">
                                  #{lostQuestions[0].winners[0].rank}
                                </ValueMark>
                              </>
                            ) : null}
                          </>
                        ) : lostQuestions[0].recommended_instead?.[0] ? (
                          <>
                            {": "}
                            <EntityMark
                              name={lostQuestions[0].recommended_instead[0]}
                            />
                          </>
                        ) : null}
                        {"."}
                      </>
                    ) : (
                      <span>
                        Suggestion based on this audit.
                      </span>
                    )}
                  </p>
                  {meta.length && !lostQuestions[0]?.prompt ? (
                    <p className="mt-1.5 font-mono text-[11px] text-muted-foreground">
                      {meta.join(" · ")}
                    </p>
                  ) : null}

                  {!relevantSources.length || relevantSources.some((source) => !source.excerpt?.trim()) ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Suggestion: supporting website evidence is incomplete.
                    </p>
                  ) : null}
                  {hasProof ? (
                    <details className="group mt-3">
                      <summary className="cursor-pointer list-none text-[12px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline [&::-webkit-details-marker]:hidden">
                        <span className="group-open:hidden">
                          View evidence
                        </span>
                        <span className="hidden group-open:inline">
                          Hide evidence
                        </span>
                      </summary>
                      <div className="mt-3 max-w-xl space-y-3 border-t border-border pt-3">
                        <p className="text-sm text-muted-foreground">
                          <span className="font-medium">
                            Original finding:{" "}
                          </span>
                          {action.title}
                        </p>
                        {lostQuestions.length ? (
                          <div>
                            <div className="flex flex-wrap items-baseline justify-between gap-2">
                              <p className="text-xs text-muted-foreground">
                                Lost on
                              </p>
                              <Link
                                href={`${routes.brandSection(brand.id, "prompts")}?scan=${latestScan?.id ?? ""}`}
                                className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                              >
                                All answers
                              </Link>
                            </div>
                            <ul className="mt-1.5 space-y-2">
                              {lostQuestions.map((item, itemIndex) => (
                                <li
                                  key={`${item.loss_id ?? item.prompt}-${itemIndex}`}
                                >
                                  <Link
                                    className="text-[13px] leading-snug underline underline-offset-4"
                                    href={`${routes.brandSection(brand.id, "prompts")}?scan=${latestScan?.id ?? ""}&q=${encodeURIComponent(item.prompt ?? "")}`}
                                  >
                                    “{item.prompt}”
                                  </Link>
                                  {item.winners?.length ? (
                                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                                      {item.winners
                                        .slice(0, 2)
                                        .map((winner, winnerIndex) =>
                                          winner.company_name ? (
                                            <span
                                              key={`${winner.company_name}-${winnerIndex}`}
                                            >
                                              {winnerIndex > 0 ? " " : ""}
                                              <EntityMark
                                                name={winner.company_name}
                                              />
                                              {winner.rank ? (
                                                <ValueMark tone="warn">
                                                  #{winner.rank}
                                                </ValueMark>
                                              ) : null}
                                            </span>
                                          ) : null,
                                        )}
                                    </p>
                                  ) : item.recommended_instead?.length ? (
                                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                                      {item.recommended_instead
                                        .slice(0, 3)
                                        .map((name) => (
                                          <EntityMark key={name} name={name} />
                                        ))}
                                    </p>
                                  ) : null}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}

                        {showBriefs && action.suggested_content_brief ? (
                          <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                            {evidenceText(action.suggested_content_brief)}
                          </p>
                        ) : null}
                        {gaps.length ? (
                          <p className="text-[13px] leading-relaxed text-muted-foreground">
                            {gaps.slice(0, 2).map((gap, gapIndex) => (
                              <span key={`${gap.pattern}-${gapIndex}`}>
                                {gapIndex > 0 ? " " : ""}
                                <ValueMark tone="neutral">
                                  {gap.competitors_with_pattern}/
                                  {gap.competitors_checked}
                                </ValueMark>
                                {" have "}
                                {gap.pattern?.toLowerCase()}
                                {gap.example_competitors
                                  ?.slice(0, 2)
                                  .map((name) => (
                                    <EntityMark key={name} name={name} />
                                  ))}
                              </span>
                            ))}
                          </p>
                        ) : null}
                        {evidence.summary ? (
                          <p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">
                            {evidence.summary}
                          </p>
                        ) : null}
                        {relevantSources.length ? (
                          <div className="space-y-3 text-sm">
                            <p className="text-xs text-muted-foreground">
                              Related website excerpts. Suggestions without a supporting passage are not verified recommendations.
                            </p>
                            {relevantSources.map((source, sourceIndex) => (
                              <div
                                key={`${source.url}-${sourceIndex}`}
                                className="min-w-0 [overflow-wrap:anywhere]"
                              >
                                <SourceMark
                                  href={passageUrl({
                                    label: source.label ?? "Saved passage",
                                    url: source.url ?? null,
                                    excerpt: source.excerpt ?? null,
                                  })}
                                  label={
                                    source.page_title ||
                                    source.title ||
                                    source.label ||
                                    sourceHost(source.url) ||
                                    "Saved source"
                                  }
                                />
                                {source.company_name ? (
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    Source associated with {source.company_name}
                                  </p>
                                ) : null}
                                {source.excerpt?.trim() ? (
                                  <blockquote className="mt-2 border-l-2 border-border pl-3 text-muted-foreground">
                                    {source.excerpt}
                                  </blockquote>
                                ) : (
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    Page excerpt unavailable.
                                  </p>
                                )}
                              </div>
                            ))}
                          </div>
                        ) : null}
                        {action.estimated_impact ? (
                          <p className="text-xs text-muted-foreground">
                            {action.estimated_impact}
                          </p>
                        ) : null}
                        {scoreMove !== null ? (
                          <p className="text-[13px] text-muted-foreground">
                            Since marked done{" "}
                            <ValueMark tone={scoreMove >= 0 ? "good" : "warn"}>
                              {scoreMove >= 0 ? "+" : ""}
                              {scoreMove.toFixed(1)}
                            </ValueMark>
                          </p>
                        ) : null}
                      </div>
                    </details>
                  ) : null}
                </div>
                <ActionStatusButtons
                  actionId={action.id}
                  status={action.status}
                />
              </li>
            );
          })}
        </ol>
      )}
      {!isPaid && sorted.length > visibleActions.length ? (
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-4">
          <div className="flex items-start gap-2">
            <Lock className="mt-0.5 size-3.5 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {sorted.length - visibleActions.length} more on Pro, with progress
              tracking.
            </p>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link
              href={routes.billing({
                plan: "founder",
                returnTo: routes.brandUpgrade(brand.id),
              })}
            >
              Continue with Pro
            </Link>
          </Button>
        </div>
      ) : null}
    </div>
  );
}
