import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { getSessionUser } from "@/lib/auth/session";
import { getAccountEntitlements } from "@/lib/billing/account";
import { hasFeature } from "@/lib/billing/entitlements";
import { isPaidSubscription } from "@/lib/billing/is-paid";
import {
  getBrandById,
  getLatestCompletedScanForBrand,
  getQueryResults,
  listAllPrompts,
} from "@/lib/db/repository";
import { assistantNames } from "@/lib/audit/progress-copy";
import { Badge } from "@/components/ui/badge";
import { BrandPageHeader } from "@/components/dashboard/brand-page-header";
import { ProReportLock } from "@/components/dashboard/pro-report-lock";
import { canonicalUrl, sourceLabel } from "@/lib/audit/source-links";
import type { ProviderId } from "@/types/database";

type Citation = {
  url: string;
  title?: string | null;
  domain?: string | null;
  provenance?: "provider_grounded";
};

type VerifiedMention = {
  url: string;
  title?: string | null;
  domain?: string | null;
  company_name?: string;
  source_type?: string;
  query?: string;
  relevance_score?: number;
  verified?: boolean;
  provenance?: "independent_web_search";
};

type CitationRow = Citation & {
  /** Every assistant that cited this one page. */
  providers: ProviderId[];
  question: string | null | undefined;
};

export default async function SourcesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getSessionUser();
  if (!user) return null;
  const { id } = await params;
  const brand = await getBrandById(id);
  if (!brand || brand.owner_id !== user.id) notFound();

  const [entitlements, latestScan, prompts] = await Promise.all([
    getAccountEntitlements(user.id),
    getLatestCompletedScanForBrand(brand.id),
    listAllPrompts(brand.id),
  ]);
  const isPaid = isPaidSubscription(entitlements);
  const results = latestScan ? await getQueryResults(latestScan.id) : [];
  const promptMap = new Map(prompts.map((prompt) => [prompt.id, prompt.prompt]));
  // One row per page, not one row per assistant that read it. Four assistants
  // citing the same comparison article is one page on this list, and the fact
  // that four of them read it belongs on that row rather than as four rows.
  const citationMap = new Map<string, CitationRow>();
  for (const result of results) {
    for (const citation of (result.citations as Citation[]) ?? []) {
      if (!citation?.url) continue;
      const key = canonicalUrl(citation.url);
      const existing = citationMap.get(key);
      const question = result.tracked_prompt_id
        ? promptMap.get(result.tracked_prompt_id)
        : null;
      if (existing) {
        if (!existing.providers.includes(result.provider)) {
          existing.providers.push(result.provider);
        }
        if (!existing.question && question) existing.question = question;
        continue;
      }
      citationMap.set(key, {
        ...citation,
        providers: [result.provider],
        question,
      });
    }
  }
  const citations = Array.from(citationMap.values());
  const mentionMap = new Map<string, VerifiedMention>();
  for (const result of results) {
    for (const mention of (result.sources as VerifiedMention[]) ?? []) {
      // The same mention list is attached to every answer of the audit, so a
      // run storing 45 distinct pages arrives here as several hundred rows.
      // Keyed on the address rather than the string, so two spellings of one
      // page collapse too.
      if (mention?.url && mention.verified !== false) {
        mentionMap.set(canonicalUrl(mention.url), mention);
      }
    }
  }
  const verifiedMentions = Array.from(mentionMap.values());
  // Grouped by company, and the audited brand first. Ungrouped, a company's own
  // pages sat scattered among its competitors' and the one number this page
  // exists to show — how many places write about you against how many write
  // about them — had to be counted by hand off the screen.
  const mentionsByCompany = new Map<string, VerifiedMention[]>();
  for (const mention of verifiedMentions) {
    const company = mention.company_name?.trim() || "Other";
    const rows = mentionsByCompany.get(company);
    if (rows) rows.push(mention);
    else mentionsByCompany.set(company, [mention]);
  }
  const isOwnCompany = (name: string) =>
    name.toLowerCase() === brand.name.toLowerCase();
  const mentionGroups = Array.from(mentionsByCompany.entries())
    .map(([company, rows]) => ({ company, rows, own: isOwnCompany(company) }))
    .sort((a, b) => {
      if (a.own !== b.own) return a.own ? -1 : 1;
      return b.rows.length - a.rows.length;
    });
  // A company with nothing written about it has no group of its own, and the
  // absence is the finding. Say it rather than leave the brand off the page.
  if (!mentionGroups.some((group) => group.own) && verifiedMentions.length > 0) {
    mentionGroups.unshift({ company: brand.name, rows: [], own: true });
  }

  // Citation gaps: websites that write about competitors but not about this
  // company. Each one is a concrete place to get listed.
  const hostOf = (mention: VerifiedMention): string | null => {
    if (mention.domain) return mention.domain.replace(/^www\./, "");
    try {
      return new URL(mention.url).hostname.replace(/^www\./, "");
    } catch {
      return null;
    }
  };
  const ownDomains = new Set(
    mentionGroups
      .filter((group) => group.own)
      .flatMap((group) => group.rows.map(hostOf))
      .filter(Boolean) as string[],
  );
  const gapMap = new Map<string, Set<string>>();
  for (const group of mentionGroups) {
    if (group.own) continue;
    for (const row of group.rows) {
      const domain = hostOf(row);
      if (!domain || ownDomains.has(domain)) continue;
      const companies = gapMap.get(domain) ?? new Set<string>();
      companies.add(group.company);
      gapMap.set(domain, companies);
    }
  }
  const citationGapRows = Array.from(gapMap.entries())
    .map(([domain, companies]) => ({ domain, companies: Array.from(companies) }))
    .sort((a, b) => b.companies.length - a.companies.length)
    .slice(0, 12);
  const showCitationGaps = hasFeature(entitlements.plan, "citationGaps");

  return (
    <div className="space-y-6">
      <BrandPageHeader
        brandId={brand.id}
        brandName={brand.name}
        title="Sources & Mentions"
        description="What the internet says about you and your competitors, and why it decides who gets recommended."
        isPaid={isPaid}
      />
      {!isPaid ? (
        <ProReportLock
          title="Unlock source intelligence"
          description="See native citations and independently verified pages where your company and competitors appear."
          brandId={brand.id}
        />
      ) : citations.length === 0 && verifiedMentions.length === 0 ? (
        <div className="rb-empty p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No grounded citations or verified web mentions are available for this
            audit.
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {/* Three paragraphs of argument sat here. The point survives in two
              sentences, and the counts below make it better than prose can. */}
          <section className="rb-panel-soft p-5">
            <h2 className="text-sm font-semibold">
              AI learned about your market by reading the internet
            </h2>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              The more places a company is written about, the more weight it
              carries when an assistant is asked for a recommendation. Here is
              every page we found for you and for each competitor.
            </p>
          </section>
          <section className="space-y-3">
            <div>
              <h2 className="text-base font-semibold">Pages the AI actually read</h2>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Opened by an assistant while it answered. Not what exists on the
                web — what a model read before deciding who to name.
              </p>
            </div>
            {citations.length === 0 ? (
              <div className="rb-empty p-5 text-sm text-muted-foreground">
                The selected models returned no native citations.
              </div>
            ) : (
              <div className="rb-list">
                <div className="divide-y divide-border">
                  {citations.map((citation, index) => (
                    <div
                      key={`${citation.url}-${index}`}
                      className="bg-card px-5 py-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <SourceLink
                            url={citation.url}
                            label={sourceLabel(citation)}
                          />
                          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                            {citation.question ?? "Question unavailable"}
                          </p>
                          {/* assistantNames, not providerDisplayName: the
                              latter reads "Bedrock Claude Haiku", which tells
                              the customer which endpoint we buy rather than
                              which assistant answered them. */}
                          <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                            {assistantNames(citation.providers).join(" · ")}
                          </p>
                        </div>
                        <Badge
                          variant="secondary"
                          className="rounded-full text-[11px] text-[color:var(--rb-green)]"
                        >
                          {citation.providers.length > 1
                            ? `Read by ${citation.providers.length}`
                            : "Grounded"}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          {showCitationGaps && citationGapRows.length ? (
            <section className="space-y-3">
              <div>
                <h2 className="text-base font-semibold">Citation gaps</h2>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Websites that write about your competitors but not about you.
                  Getting listed on these is the most direct way to appear in
                  the material AI reads.
                </p>
              </div>
              <div className="rb-list">
                <div className="divide-y divide-border">
                  {citationGapRows.map((gap) => (
                    <div key={gap.domain} className="bg-card px-5 py-3.5">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="font-mono text-sm">{gap.domain}</p>
                        <p className="text-xs text-muted-foreground">
                          Covers {gap.companies.slice(0, 3).join(", ")}
                          {gap.companies.length > 3
                            ? ` +${gap.companies.length - 3} more`
                            : ""}{" "}
                          — not you
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          ) : null}

          <section className="space-y-3">
            <div>
              <h2 className="text-base font-semibold">
                Mentions across the internet
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Each one checked to be about this company rather than another of
                the same name. What is published today, not a claim about which
                pages a model read.
              </p>
            </div>
            {verifiedMentions.length === 0 ? (
              <div className="rb-empty p-5 text-sm text-muted-foreground">
                No independently verified mentions were collected.
              </div>
            ) : (
              <div className="space-y-5">
                {mentionGroups.map((group) => (
                  <div key={group.company} className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold">{group.company}</h3>
                      {group.own ? (
                        <Badge
                          variant="secondary"
                          className="rounded-full text-[11px]"
                        >
                          You
                        </Badge>
                      ) : null}
                      <Badge variant="outline" className="rounded-full text-[11px]">
                        {group.rows.length}{" "}
                        {group.rows.length === 1 ? "page" : "pages"}
                      </Badge>
                    </div>
                    {group.rows.length === 0 ? (
                      <div className="rb-empty p-5 text-sm text-muted-foreground">
                        No page on the open web was found writing about you. An
                        assistant asked to recommend a company in this category
                        has nothing to read.
                      </div>
                    ) : (
                      <div className="rb-list">
                        <div className="divide-y divide-border">
                          {group.rows.map((mention) => (
                            <div key={mention.url} className="bg-card px-5 py-4">
                              <div className="flex flex-wrap items-start justify-between gap-4">
                                <div className="min-w-0 flex-1">
                                  <SourceLink
                                    url={mention.url}
                                    label={sourceLabel(mention)}
                                  />
                                  <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                                    {canonicalUrl(mention.url)}
                                  </p>
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                  <Badge
                                    variant="secondary"
                                    className="rounded-full text-[11px] text-[color:var(--rb-green)]"
                                  >
                                    Verified
                                  </Badge>
                                  <Badge
                                    variant="outline"
                                    className="rounded-full text-[11px]"
                                  >
                                    {(
                                      mention.source_type ?? "web source"
                                    ).replaceAll("_", " ")}
                                  </Badge>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function SourceLink({ url, label }: { url: string; label: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex max-w-full items-center gap-1.5 text-sm font-medium text-[color:var(--rb-blue)] hover:underline"
    >
      <ExternalLink className="size-3.5 shrink-0" />
      <span className="truncate">{label}</span>
    </a>
  );
}
