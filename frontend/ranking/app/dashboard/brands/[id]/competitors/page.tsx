import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { getSessionUser } from "@/lib/auth/session";
import { getAccountEntitlements } from "@/lib/billing/account";
import { isPaidSubscription } from "@/lib/billing/is-paid";
import { PLAN_CONFIG } from "@/lib/billing/entitlements";
import {
  getBrandById,
  getCompetitors,
  getLatestCompletedScanForBrand,
  getQueryResults,
  scoresForBrand,
} from "@/lib/db/repository";
import { providerDisplayName } from "@/lib/constants";
import { BrandPageHeader } from "@/components/dashboard/brand-page-header";
import { CompetitorsManager } from "@/components/dashboard/competitors-manager";
import { ProReportLock } from "@/components/dashboard/pro-report-lock";
import { Badge } from "@/components/ui/badge";
import type { ProviderId } from "@/types/database";

type AnswerEvidence = {
  question?: string;
  provider?: ProviderId;
  model?: string;
  rank?: number | null;
  reason?: string;
  answer_excerpt?: string;
  source_urls?: string[];
};

type WebsiteEvidence = {
  label?: string;
  page_title?: string | null;
  excerpt?: string | null;
  url?: string | null;
};

type VerifiedMention = {
  title?: string;
  snippet?: string;
  url?: string;
  domain?: string;
  source_type?: string;
};

type CompetitorSignal = {
  name?: string;
  mentions?: number;
  average_rank?: number | null;
  share_of_voice?: number;
  mentions_by_assistant?: Record<string, number>;
  official_website?: string | null;
  collection_status?: string;
  answer_evidence?: AnswerEvidence[];
  website_evidence?: WebsiteEvidence[];
  verified_mentions?: VerifiedMention[];
};

type RecommendedCompany = {
  name?: string;
};

export default async function CompetitorsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getSessionUser();
  if (!user) return null;

  const { id } = await params;
  const brand = await getBrandById(id);
  if (!brand || brand.owner_id !== user.id) notFound();

  const [competitors, entitlements, scores, latestScan] = await Promise.all([
    getCompetitors(brand.id),
    getAccountEntitlements(user.id),
    scoresForBrand(brand.id),
    getLatestCompletedScanForBrand(brand.id),
  ]);
  const latestResults = latestScan ? await getQueryResults(latestScan.id) : [];
  const isPaid = isPaidSubscription(entitlements);
  const plan = PLAN_CONFIG[entitlements.plan];
  const rawSignals = Array.isArray(scores[0]?.competitor_scores)
    ? (scores[0].competitor_scores as CompetitorSignal[])
    : [];
  const signals = rawSignals.filter(hasUsableCompetitorEvidence);
  const maxMentions = Math.max(signals[0]?.mentions ?? 1, 1);
  const displayedNames = new Set(
    signals.map((signal) => normalizeCompanyName(signal.name)),
  );
  displayedNames.add(normalizeCompanyName(brand.name));
  const otherMentions = aggregateOtherMentions(latestResults, displayedNames);

  // Where the audited company itself sits in the same ranking. Without this the
  // page lists rivals but never answers "so where am I?".
  const brandMentions = latestResults.filter((row) => row.brand_mentioned).length;
  const brandAverageRank = scores[0]?.average_position ?? null;
  const brandShareOfVoice = scores[0]?.share_of_voice ?? 0;
  const aheadOfBrand = signals.filter(
    (signal) => (signal.mentions ?? 0) > brandMentions,
  ).length;
  const brandRankPosition = aheadOfBrand + 1;
  const rankedTotal = signals.length + 1;

  return (
    <div className="space-y-6">
      <BrandPageHeader
        brandId={brand.id}
        brandName={brand.name}
        title="Competitors"
        description="Who AI recommends instead, why they appear, and the evidence behind those findings."
        isPaid={isPaid}
      />

      {!isPaid ? (
        <ProReportLock
          title="Unlock full competitor evidence"
          description="See the exact AI excerpts, competitor-owned pages, and independently verified mentions behind each finding."
          brandId={brand.id}
        />
      ) : (
        <>
          {signals.length ? (
            <section className="rb-panel px-5 py-4">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="text-[11px] font-semibold uppercase text-muted-foreground">
                    Your position in this ranking
                  </p>
                  <h2 className="mt-1 text-lg font-semibold">
                    #{brandRankPosition} of {rankedTotal} · {brand.name}
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Recommended in {brandMentions} of {latestResults.length} AI answers
                    {brandAverageRank ? `, average position #${brandAverageRank}` : ""}.
                    {aheadOfBrand > 0
                      ? ` ${aheadOfBrand} ${aheadOfBrand === 1 ? "company is" : "companies are"} recommended more often than you.`
                      : " No competitor was recommended more often than you."}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[11px] font-medium uppercase text-muted-foreground">
                    Share of voice
                  </p>
                  <p className="mt-1 font-mono text-xl font-semibold">
                    {Math.round(brandShareOfVoice * 100)}%
                  </p>
                </div>
              </div>
            </section>
          ) : null}

          <section>
            <h2 className="text-base font-semibold">Who AI recommends</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Open a company to inspect the answer evidence, website proof, and verified external mentions.
            </p>

            <div className="mt-3 space-y-3">
              {signals.length ? (
                signals.slice(0, 12).map((signal, index) => (
                  <CompetitorEvidencePanel
                    key={`${signal.name}-${index}`}
                    signal={signal}
                    rank={index + 1}
                    maxMentions={maxMentions}
                  />
                ))
              ) : (
                <div className="rb-empty px-5 py-8 text-center text-sm text-muted-foreground">
                  No recommended company met the evidence threshold in this audit.
                </div>
              )}
            </div>
          </section>

          {otherMentions.length ? (
            <section>
              <h2 className="text-base font-semibold">Other AI mentions</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                These companies appeared in answers, but did not have enough verified evidence for a full comparison.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {otherMentions.slice(0, 12).map((item) => (
                  <Badge key={item.name} variant="outline" className="rounded-full px-3 py-1 text-xs">
                    {item.name} · {item.count}
                  </Badge>
                ))}
              </div>
            </section>
          ) : null}

          <CompetitorsManager
            brandId={brand.id}
            initialCompetitors={competitors}
            competitorLimit={plan.features.competitorsPerBrand}
            isPaid={isPaid}
          />
        </>
      )}
    </div>
  );
}

function CompetitorEvidencePanel({
  signal,
  rank,
  maxMentions,
}: {
  signal: CompetitorSignal;
  rank: number;
  maxMentions: number;
}) {
  const answerEvidence = signal.answer_evidence ?? [];
  const websiteEvidence = cleanWebsiteEvidence(signal.website_evidence ?? []);
  const verifiedMentions = signal.verified_mentions ?? [];
  const evidenceCount =
    answerEvidence.length + websiteEvidence.length + verifiedMentions.length;

  return (
    <details className="rb-panel group overflow-hidden">
      <summary className="cursor-pointer list-none px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3">
              <span className="font-mono text-xs text-muted-foreground">#{rank}</span>
              <p className="truncate text-sm font-semibold">{signal.name}</p>
            </div>
            <div className="mt-2 ml-7 h-1.5 max-w-lg overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-[color:var(--rb-blue)]"
                style={{
                  width: `${Math.max(
                    ((signal.mentions ?? 0) / maxMentions) * 100,
                    3,
                  )}%`,
                }}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="rounded-full text-[11px]">
              {signal.mentions ?? 0} mentions
            </Badge>
            {signal.average_rank ? (
              <Badge variant="outline" className="rounded-full text-[11px]">
                avg #{signal.average_rank}
              </Badge>
            ) : null}
            <Badge variant="outline" className="rounded-full text-[11px]">
              {evidenceCount} evidence items
            </Badge>
            <span className="text-xs text-muted-foreground group-open:hidden">
              View evidence
            </span>
          </div>
        </div>
      </summary>

      <div className="border-t border-border px-5 py-5">
        <div className="flex flex-wrap items-center gap-2">
          {Object.entries(signal.mentions_by_assistant ?? {}).map(
            ([provider, count]) => (
              <Badge
                key={provider}
                variant="outline"
                className="rounded-full text-[11px]"
              >
                {providerDisplayName(provider as ProviderId)}: {count}
              </Badge>
            ),
          )}
          {signal.official_website ? (
            <EvidenceLink url={signal.official_website} label="Official website" />
          ) : null}
        </div>

        <div className="mt-5 grid gap-6 xl:grid-cols-2">
          <AnswerEvidenceList rows={answerEvidence} />
          {websiteEvidence.length || verifiedMentions.length ? (
            <div className="space-y-6">
              {websiteEvidence.length ? (
                <WebsiteEvidenceList rows={websiteEvidence} />
              ) : null}
              {verifiedMentions.length ? (
                <VerifiedMentionsList rows={verifiedMentions} />
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </details>
  );
}

function AnswerEvidenceList({ rows }: { rows: AnswerEvidence[] }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase text-muted-foreground">
        Why AI selected them
      </h3>
      {rows.length ? (
        <div className="mt-3 space-y-4">
          {rows.slice(0, 4).map((evidence, index) => (
            <div
              key={`${evidence.question}-${index}`}
              className="border-l-2 border-[color:var(--rb-blue)]/30 pl-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                {evidence.provider ? (
                  <Badge variant="secondary" className="rounded-full text-[10px]">
                    {providerDisplayName(evidence.provider)}
                  </Badge>
                ) : null}
                {evidence.rank ? (
                  <span className="text-[11px] text-muted-foreground">
                    Recommended #{evidence.rank}
                  </span>
                ) : null}
              </div>
              <p className="mt-3 text-[11px] font-semibold uppercase text-muted-foreground">
                Buyer question
              </p>
              <p className="mt-1 text-sm font-medium leading-relaxed">{evidence.question}</p>
              {evidence.answer_excerpt ? (
                <>
                  <p className="mt-3 text-[11px] font-semibold uppercase text-muted-foreground">
                    Evidence from the AI answer
                  </p>
                  <blockquote className="mt-1 border-l-2 border-[color:var(--rb-blue)]/35 pl-3 text-sm leading-relaxed">
                    &ldquo;{evidence.answer_excerpt}&rdquo;
                  </blockquote>
                </>
              ) : null}
              {evidence.reason ? (
                <>
                  <p className="mt-3 text-[11px] font-semibold uppercase text-muted-foreground">
                    Why it was recommended
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    {evidence.reason}
                  </p>
                </>
              ) : null}
              {evidence.source_urls?.length ? (
                <div className="mt-2 flex flex-wrap gap-3">
                  {evidence.source_urls.map((url) => (
                    <EvidenceLink key={url} url={url} label={sourceLabel(url)} />
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">
          No answer-level evidence was retained for this competitor.
        </p>
      )}
    </div>
  );
}

function WebsiteEvidenceList({ rows }: { rows: WebsiteEvidence[] }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase text-muted-foreground">
        Evidence on their website
      </h3>
      <div className="mt-3 divide-y divide-border border-y border-border">
        {rows.slice(0, 5).map((evidence, index) => (
          <div key={`${evidence.url}-${index}`} className="py-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium">
                {evidence.page_title || readablePageName(evidence.url) || evidence.label}
              </p>
              <Badge variant="outline" className="rounded-full text-[10px]">
                {evidence.label}
              </Badge>
            </div>
            {evidence.excerpt ? (
              <p className="mt-1 text-sm leading-relaxed">
                &ldquo;{evidence.excerpt}&rdquo;
              </p>
            ) : null}
            {evidence.url ? (
              <div className="mt-1.5">
                <EvidenceLink url={evidence.url} label="View page" />
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function VerifiedMentionsList({ rows }: { rows: VerifiedMention[] }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase text-muted-foreground">
        Independent web verification
      </h3>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        Pages found separately after the AI answers. These are not claims made by the AI provider.
      </p>
      <div className="mt-3 space-y-3">
        {rows.slice(0, 4).map((mention, index) => (
          <div key={`${mention.url}-${index}`}>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs font-medium">
                {mention.title || mention.domain}
              </p>
              {mention.source_type ? (
                <Badge variant="outline" className="rounded-full text-[10px]">
                  {mention.source_type.replaceAll("_", " ")}
                </Badge>
              ) : null}
            </div>
            {mention.snippet ? (
              <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
                {conciseSnippet(mention.snippet)}
              </p>
            ) : null}
            {mention.url ? (
              <div className="mt-1">
                <EvidenceLink
                  url={mention.url}
                  label={mention.domain || "Open source"}
                />
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function hasUsableCompetitorEvidence(signal: CompetitorSignal): boolean {
  const answerEvidence = signal.answer_evidence ?? [];
  const hasAnswerProof = answerEvidence.some(
    (item) => Boolean(item.answer_excerpt?.trim()),
  );
  const hasVerifiedSupport =
    (signal.website_evidence?.length ?? 0) > 0 ||
    (signal.verified_mentions?.length ?? 0) > 0 ||
    answerEvidence.some((item) => (item.source_urls?.length ?? 0) > 0);
  return hasAnswerProof && hasVerifiedSupport;
}

function cleanWebsiteEvidence(rows: WebsiteEvidence[]): WebsiteEvidence[] {
  const seenUrls = new Set<string>();
  const seenLabels = new Set<string>();
  return rows.filter((row) => {
    const url = row.url?.trim();
    const label = row.label?.trim().toLowerCase();
    if (!url || !label) return false;
    let path = "";
    try {
      path = new URL(url).pathname.toLowerCase().replace(/\/+$/, "");
    } catch {
      return false;
    }
    if (
      label.includes("product or feature") &&
      (path.includes("/pricing") || path.includes("/plans"))
    ) {
      return false;
    }
    if (label.includes("use-case") && !path) return false;
    if (seenUrls.has(url) || seenLabels.has(label)) return false;
    seenUrls.add(url);
    seenLabels.add(label);
    return true;
  });
}

function aggregateOtherMentions(
  results: Array<{ recommended_brands: unknown }>,
  excludedNames: Set<string>,
): Array<{ name: string; count: number }> {
  const counts = new Map<string, { name: string; count: number }>();
  for (const result of results) {
    const companies = Array.isArray(result.recommended_brands)
      ? (result.recommended_brands as RecommendedCompany[])
      : [];
    for (const company of companies) {
      const name = company.name?.trim();
      const key = normalizeCompanyName(name);
      if (!name || !key || excludedNames.has(key)) continue;
      const current = counts.get(key);
      counts.set(key, {
        name: current?.name ?? name,
        count: (current?.count ?? 0) + 1,
      });
    }
  }
  return Array.from(counts.values()).sort(
    (left, right) => right.count - left.count || left.name.localeCompare(right.name),
  );
}

function normalizeCompanyName(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function conciseSnippet(value: string): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > 280 ? `${text.slice(0, 279).trim()}…` : text;
}

function readablePageName(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const segment = parsed.pathname.split("/").filter(Boolean).at(-1);
    if (!segment) return parsed.hostname.replace(/^www\./, "");
    return segment
      .replace(/[-_]+/g, " ")
      .replace(/\b\w/g, (character) => character.toUpperCase());
  } catch {
    return null;
  }
}

function sourceLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Open source";
  }
}

function EvidenceLink({ url, label }: { url: string; label: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-xs text-[color:var(--rb-blue)] hover:underline"
    >
      {label}
      <ExternalLink className="size-3" />
    </a>
  );
}
