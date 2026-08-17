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
import { canonicalCompanyKey } from "@/lib/utils/company-name";
import { ProviderBadge, ProviderLogo } from "@/components/providers/provider-logo";
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
            /* Where the audited company sits, as one hairline-divided band. */
            <section className="rb-panel grid grid-cols-2 gap-y-5 p-5 lg:grid-cols-4 lg:gap-y-0 lg:divide-x lg:divide-border">
              <div className="lg:pr-5">
                <p className="rb-eyebrow">Your position</p>
                <p className="rb-tabular mt-1.5 text-2xl font-semibold tracking-tight">
                  #{brandRankPosition}
                  <span className="text-sm font-normal text-muted-foreground">
                    {" "}
                    of {rankedTotal}
                  </span>
                </p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  among companies AI named with evidence
                </p>
              </div>
              <div className="lg:px-5">
                <p className="rb-eyebrow">Recommended</p>
                <p className="rb-tabular mt-1.5 text-2xl font-semibold tracking-tight">
                  {brandMentions}
                  <span className="text-sm font-normal text-muted-foreground">
                    {" "}
                    of {latestResults.length}
                  </span>
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">AI answers</p>
              </div>
              <div className="lg:px-5">
                <p className="rb-eyebrow">Avg position</p>
                <p className="rb-tabular mt-1.5 text-2xl font-semibold tracking-tight">
                  {brandAverageRank ? `#${brandAverageRank}` : " - "}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {aheadOfBrand > 0
                    ? `${aheadOfBrand} ${aheadOfBrand === 1 ? "company" : "companies"} ahead of you`
                    : "nobody recommended more often"}
                </p>
              </div>
              <div className="lg:pl-5">
                <p className="rb-eyebrow">Share of voice</p>
                <p className="rb-tabular mt-1.5 text-2xl font-semibold tracking-tight">
                  {Math.round(brandShareOfVoice * 100)}%
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  of recommendations
                </p>
              </div>
            </section>
          ) : null}

          {/* One leaderboard card; each row expands into its evidence. */}
          <section className="rb-panel overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
              <h2 className="text-sm font-medium">Who AI recommends</h2>
              <p className="text-xs text-muted-foreground">
                Open a company for answer evidence, website proof, and verified
                mentions.
              </p>
            </div>
            {signals.length ? (
              <div className="divide-y divide-border">
                {signals.slice(0, 12).map((signal, index) => (
                  <CompetitorEvidencePanel
                    key={`${signal.name}-${index}`}
                    signal={signal}
                    rank={index + 1}
                    maxMentions={maxMentions}
                  />
                ))}
              </div>
            ) : (
              <p className="px-5 py-10 text-center text-sm text-muted-foreground">
                No recommended company met the evidence threshold in this audit.
              </p>
            )}
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
    <details className="group">
      <summary className="cursor-pointer list-none px-5 py-3.5 transition-colors hover:bg-muted/40">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span className="rb-tabular w-6 shrink-0 font-mono text-xs text-muted-foreground">
              {String(rank).padStart(2, "0")}
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2.5">
                <p className="truncate text-sm font-semibold">{signal.name}</p>
                {/* Which assistants named them, at a glance. */}
                <span className="flex shrink-0 items-center gap-1.5 text-muted-foreground">
                  {Object.keys(signal.mentions_by_assistant ?? {}).map(
                    (provider) => (
                      <span
                        key={provider}
                        title={providerDisplayName(provider as ProviderId)}
                      >
                        <ProviderLogo provider={provider} className="size-3" />
                      </span>
                    ),
                  )}
                </span>
              </div>
              <div className="mt-1.5 h-1 max-w-sm overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-[color:var(--rb-accent)]"
                  style={{
                    width: `${Math.max(
                      ((signal.mentions ?? 0) / maxMentions) * 100,
                      3,
                    )}%`,
                  }}
                />
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span className="rb-tabular font-mono text-xs text-muted-foreground">
              {signal.mentions ?? 0} mention{(signal.mentions ?? 0) !== 1 ? "s" : ""}
              {signal.average_rank ? ` · avg #${signal.average_rank}` : ""}
              {` · ${evidenceCount} evidence`}
            </span>
            <span className="text-xs text-[color:var(--rb-accent)] group-open:hidden">
              Evidence
            </span>
            <span className="hidden text-xs text-muted-foreground group-open:inline">
              Close
            </span>
          </div>
        </div>
      </summary>

      <div className="border-t border-border bg-muted/20 px-5 py-5">
        <div className="flex flex-wrap items-center gap-2">
          {Object.entries(signal.mentions_by_assistant ?? {}).map(
            ([provider, count]) => (
              <span
                key={provider}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] font-medium text-muted-foreground"
              >
                <ProviderLogo provider={provider} className="size-3" />
                {providerDisplayName(provider as ProviderId)} · {count}
              </span>
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
              className="border-l-2 border-[color:var(--rb-accent)]/30 pl-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                {evidence.provider ? (
                  <ProviderBadge
                    provider={evidence.provider}
                    className="text-[11px] font-medium"
                  />
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
                  <blockquote className="mt-1 border-l-2 border-[color:var(--rb-accent)]/35 pl-3 text-sm leading-relaxed">
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
  // Canonical, so a competitor shown as "Kenesis" is not listed again under
  // "Also named" because one answer wrote "Kenesis Labs".
  return canonicalCompanyKey(value);
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
      className="inline-flex items-center gap-1 text-xs text-[color:var(--rb-accent)] hover:underline"
    >
      {label}
      <ExternalLink className="size-3" />
    </a>
  );
}
