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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ActionStatusButtons } from "@/components/dashboard/action-status-buttons";
import { BrandPageHeader } from "@/components/dashboard/brand-page-header";

type SupportingEvidence = {
  evidence_id?: string;
  evidence_type?: string;
  company_name?: string;
  label?: string;
  excerpt?: string | null;
  title?: string;
  page_title?: string;
  url?: string | null;
  provenance?: string;
};

type AffectedPrompt = {
  loss_id?: string;
  prompt?: string;
  category?: string;
  recommended_instead?: string[];
};

type CompetitorGap = {
  pattern?: string;
  competitors_with_pattern?: number;
  competitors_checked?: number;
  user_status?: string;
  example_competitors?: string[];
};

type ParsedEvidence = {
  summary: string | null;
  sources: SupportingEvidence[];
  validationMode: string | null;
  affectedPrompts: AffectedPrompt[];
  competitorGaps: CompetitorGap[];
};

function evidenceText(value: unknown, depth = 0): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (!value || depth > 2) return null;

  if (Array.isArray(value)) {
    const items = value
      .slice(0, 3)
      .map((item) => evidenceText(item, depth + 1))
      .filter((item): item is string => Boolean(item));
    return items.length ? items.join("; ") : null;
  }

  if (typeof value === "object") {
    const items = Object.entries(value)
      .slice(0, 4)
      .map(([key, item]) => {
        const detail = evidenceText(item, depth + 1);
        if (!detail) return null;
        const label = key.replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase());
        return `${label}: ${detail}`;
      })
      .filter((item): item is string => Boolean(item));
    return items.length ? items.join(" | ") : null;
  }

  return null;
}

function parseEvidence(value: unknown): ParsedEvidence {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      summary: evidenceText(value),
      sources: [],
      validationMode: null,
      affectedPrompts: [],
      competitorGaps: [],
    };
  }

  const record = value as Record<string, unknown>;
  const sources = Array.isArray(record.supporting_evidence)
    ? record.supporting_evidence.filter(
        (item): item is SupportingEvidence =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item),
      )
    : [];
  const affectedPrompts = Array.isArray(record.affected_prompts)
    ? record.affected_prompts.filter(
        (item): item is AffectedPrompt =>
          Boolean(item) &&
          typeof item === "object" &&
          !Array.isArray(item) &&
          typeof (item as AffectedPrompt).prompt === "string",
      )
    : [];
  return {
    summary: evidenceText(record.summary),
    sources,
    validationMode:
      typeof record.validation_mode === "string" ? record.validation_mode : null,
    affectedPrompts,
    competitorGaps: Array.isArray(record.competitor_gaps)
      ? record.competitor_gaps.filter(
          (item): item is CompetitorGap =>
            Boolean(item) && typeof item === "object" && !Array.isArray(item),
        )
      : [],
  };
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

  return (
    <div className="space-y-6">
      <BrandPageHeader
        brandId={brand.id}
        brandName={brand.name}
        title="Website Improvements"
        description="Prioritized changes tied to website evidence, competitor patterns, and the AI answers in this audit."
        isPaid={isPaid}
      />
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
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[color:var(--rb-blue-soft)] text-sm font-semibold text-[color:var(--rb-blue)]">{index + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="secondary" className="rounded-full text-[11px]">Priority {action.priority}</Badge>
                        <Badge variant="outline" className="rounded-full text-[11px] capitalize">{action.action_type.replaceAll("_", " ")}</Badge>
                        {action.status !== "open" ? <Badge variant="secondary" className="rounded-full text-[11px] capitalize">{action.status.replaceAll("_", " ")}</Badge> : null}
                      </div>
                      <p className="mt-3 text-[11px] font-semibold uppercase text-muted-foreground">
                        Finding
                      </p>
                      <h2 className="mt-1 text-lg font-semibold leading-snug">{action.title}</h2>
                      <div className="mt-4 bg-[color:var(--rb-blue-soft)]/45 px-4 py-3">
                        <p className="text-[11px] font-semibold uppercase text-[color:var(--rb-blue)]">
                          Action needed
                        </p>
                        <p className="mt-1.5 text-sm font-medium leading-relaxed">{action.explanation}</p>
                      </div>
                      {evidence.competitorGaps.length ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {evidence.competitorGaps.map((gap, gapIndex) => (
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
                        <div className="mt-3 border-l-2 border-[color:var(--rb-blue)]/30 pl-3">
                          <p className="text-[11px] font-medium uppercase text-muted-foreground">Observed evidence</p>
                          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{evidence.summary}</p>
                        </div>
                      ) : null}
                      {evidence.affectedPrompts.length ? (
                        <div className="mt-4">
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <p className="text-[11px] font-medium uppercase text-muted-foreground">
                              Buyer questions this affects
                            </p>
                            <Link
                              href={routes.brandSection(brand.id, "prompts")}
                              className="text-[11px] text-muted-foreground hover:text-foreground"
                            >
                              See all answers
                            </Link>
                          </div>
                          <ul className="mt-2 space-y-2.5">
                            {evidence.affectedPrompts.slice(0, 3).map((item, itemIndex) => (
                              <li
                                key={`${item.loss_id ?? item.prompt}-${itemIndex}`}
                                className="border-l-2 border-[color:var(--rb-amber)]/40 pl-3"
                              >
                                <p className="text-xs font-medium leading-relaxed">
                                  {item.prompt}
                                </p>
                                {item.recommended_instead?.length ? (
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
                      {relevantSources.length ? (
                        <div className="mt-4">
                          <p className="text-[11px] font-medium uppercase text-muted-foreground">Relevant supporting pages</p>
                          <div className="mt-2 divide-y divide-border border-y border-border">
                            {relevantSources.slice(0, 3).map((source, sourceIndex) => (
                              <div key={`${source.url}-${sourceIndex}`} className="py-3">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="text-xs font-medium">
                                    {[source.company_name, source.page_title || source.label || source.title].filter(Boolean).join(" - ")}
                                  </p>
                                  {source.provenance ? (
                                    <Badge variant="outline" className="rounded-full text-[10px]">
                                      {source.provenance.replaceAll("_", " ")}
                                    </Badge>
                                  ) : null}
                                </div>
                                {source.excerpt ? (
                                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                                    &ldquo;{source.excerpt}&rdquo;
                                  </p>
                                ) : null}
                                {source.url ? (
                                  <a
                                    href={source.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="mt-1.5 inline-flex items-center gap-1 text-xs text-[color:var(--rb-blue)] hover:underline"
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
