import { notFound } from "next/navigation";
import { ChevronDown, ExternalLink } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { BrandPageHeader } from "@/components/dashboard/brand-page-header";
import { ProviderStack } from "@/components/providers/provider-logo";
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

function hostOfUrl(url: string, domain?: string | null): string | null {
  if (domain) return domain.replace(/^www\./, "");
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

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
  // One disclosure per website rather than one heavy row per link: the list
  // reads as "which places" first, and the individual pages stay a click away.
  const citationsByDomain = new Map<
    string,
    { rows: CitationRow[]; providers: Set<ProviderId> }
  >();
  for (const citation of citations) {
    const domain = hostOfUrl(citation.url, citation.domain) ?? "other";
    const group = citationsByDomain.get(domain) ?? {
      rows: [],
      providers: new Set<ProviderId>(),
    };
    group.rows.push(citation);
    for (const provider of citation.providers) group.providers.add(provider);
    citationsByDomain.set(domain, group);
  }
  const citationGroups = Array.from(citationsByDomain.entries())
    .map(([domain, group]) => ({
      domain,
      rows: group.rows,
      providers: Array.from(group.providers),
    }))
    .sort((a, b) => b.rows.length - a.rows.length);

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
  // exists to show - how many places write about you against how many write
  // about them - had to be counted by hand off the screen.
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
    .map(([company, rows]) => ({
      company,
      rows: rows.slice().sort((a, b) => {
        const da = hostOfUrl(a.url, a.domain) ?? "";
        const db = hostOfUrl(b.url, b.domain) ?? "";
        return da.localeCompare(db);
      }),
      own: isOwnCompany(company),
    }))
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
  const hostOf = (mention: VerifiedMention): string | null =>
    hostOfUrl(mention.url, mention.domain);
  const ownDomains = new Set(
    mentionGroups
      .filter((group) => group.own)
      .flatMap((group) => group.rows.map(hostOf))
      .filter(Boolean) as string[],
  );
  const gapMap = new Map<
    string,
    { companies: Set<string>; pages: Map<string, VerifiedMention> }
  >();
  for (const group of mentionGroups) {
    if (group.own) continue;
    for (const row of group.rows) {
      const domain = hostOf(row);
      if (!domain || ownDomains.has(domain)) continue;
      const gap = gapMap.get(domain) ?? {
        companies: new Set<string>(),
        pages: new Map<string, VerifiedMention>(),
      };
      gap.companies.add(group.company);
      gap.pages.set(canonicalUrl(row.url), row);
      gapMap.set(domain, gap);
    }
  }
  const citationGapRows = Array.from(gapMap.entries())
    .map(([domain, gap]) => ({
      domain,
      companies: Array.from(gap.companies),
      pages: Array.from(gap.pages.values()),
    }))
    .sort((a, b) => b.companies.length - a.companies.length)
    .slice(0, 12);
  const showCitationGaps = hasFeature(entitlements.plan, "citationGaps");

  // The page's headline numbers, so the lists below are detail, not the pitch.
  const ownMentionCount = mentionGroups.find((group) => group.own)?.rows.length ?? 0;
  const competitorMentionCount = verifiedMentions.length - ownMentionCount;
  const allDomains = new Set<string>([
    ...citationGroups.map((group) => group.domain),
    ...(verifiedMentions.map((m) => hostOf(m)).filter(Boolean) as string[]),
  ]);

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
        <div className="arc-empty p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No grounded citations or verified web mentions are available for this
            audit.
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {/* The whole page in four numbers - the lists below are receipts. */}
          <section className="arc-panel grid grid-cols-2 divide-y divide-border sm:grid-cols-4 sm:divide-x sm:divide-y-0">
            {(
              [
                [citations.length, "Pages AI read"],
                [allDomains.size, "Websites involved"],
                [ownMentionCount, "Write about you"],
                [competitorMentionCount, "About competitors"],
              ] as const
            ).map(([value, label]) => (
              <div key={label} className="px-5 py-4">
                <p className="arc-tabular font-heading text-2xl font-semibold tracking-tight">
                  {value}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">{label}</p>
              </div>
            ))}
          </section>

          <section className="space-y-3">
            <div>
              <h2 className="text-base font-semibold">Pages the AI actually read</h2>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Opened by an assistant while it answered, grouped by website.
                Open a website to see the exact pages and the questions they
                decided.
              </p>
            </div>
            {citationGroups.length === 0 ? (
              <div className="arc-empty p-5 text-sm text-muted-foreground">
                The selected models returned no native citations.
              </div>
            ) : (
              <div className="arc-list divide-y divide-border">
                {citationGroups.map((group) => (
                  <details key={group.domain} className="group bg-card">
                    <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-3.5 select-none hover:bg-muted/50 [&::-webkit-details-marker]:hidden">
                      <DomainTile domain={group.domain} />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">
                          {group.domain}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {group.rows.length}{" "}
                          {group.rows.length === 1 ? "page" : "pages"} · read by{" "}
                          {group.providers.length}{" "}
                          {group.providers.length === 1 ? "assistant" : "assistants"}
                        </span>
                      </span>
                      <span className="ml-auto flex shrink-0 items-center gap-3">
                        <ProviderStack providers={group.providers} max={5} />
                        <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
                      </span>
                    </summary>
                    <div className="divide-y divide-border border-t border-border">
                      {group.rows.map((citation, index) => (
                        <div
                          key={`${citation.url}-${index}`}
                          className="bg-background/40 py-2.5 pr-5 pl-[3.75rem]"
                        >
                          <SourceLink
                            url={citation.url}
                            label={sourceLabel(citation)}
                          />
                          <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                            {citation.question ?? "Question unavailable"}
                          </p>
                        </div>
                      ))}
                    </div>
                  </details>
                ))}
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
              <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                {citationGapRows.map((gap) => (
                  <div
                    key={gap.domain}
                    className="rounded-lg border border-border bg-card px-3.5 py-3"
                  >
                    <div className="flex items-center gap-2.5">
                      <DomainTile domain={gap.domain} />
                      <p className="min-w-0 truncate font-mono text-sm">
                        {gap.domain}
                      </p>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Covers {gap.companies.slice(0, 2).join(", ")}
                      {gap.companies.length > 2
                        ? ` +${gap.companies.length - 2} more`
                        : ""}{" "}
                      - not you
                    </p>
                    <div className="mt-2 space-y-1.5 border-t border-border pt-2">
                      {gap.pages.slice(0, 2).map((page) => (
                        <SourceLink
                          key={canonicalUrl(page.url)}
                          url={page.url}
                          label={sourceLabel(page)}
                        />
                      ))}
                      {gap.pages.length > 2 ? (
                        <p className="text-[11px] text-muted-foreground">
                          +{gap.pages.length - 2} more page
                          {gap.pages.length - 2 === 1 ? "" : "s"} below
                        </p>
                      ) : null}
                    </div>
                  </div>
                ))}
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
                the same name. Your company stays open; open a competitor to
                compare.
              </p>
            </div>
            {verifiedMentions.length === 0 ? (
              <div className="arc-empty p-5 text-sm text-muted-foreground">
                No independently verified mentions were collected.
              </div>
            ) : (
              <div className="arc-list divide-y divide-border">
                {mentionGroups.map((group) => (
                  <details
                    key={group.company}
                    className="group bg-card"
                    open={group.own}
                  >
                    <summary className="flex cursor-pointer list-none items-center gap-2.5 px-5 py-3.5 select-none hover:bg-muted/50 [&::-webkit-details-marker]:hidden">
                      <span className="truncate text-sm font-semibold">
                        {group.company}
                      </span>
                      {group.own ? (
                        <Badge variant="secondary" className="rounded-full text-[11px]">
                          You
                        </Badge>
                      ) : null}
                      <span className="ml-auto flex shrink-0 items-center gap-3">
                        <span className="text-xs text-muted-foreground">
                          {group.rows.length}{" "}
                          {group.rows.length === 1 ? "page" : "pages"}
                        </span>
                        <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
                      </span>
                    </summary>
                    <div className="border-t border-border">
                      {group.rows.length === 0 ? (
                        <p className="bg-background/40 px-5 py-4 text-sm text-muted-foreground">
                          No page on the open web was found writing about you. An
                          assistant asked to recommend a company in this category
                          has nothing to read.
                        </p>
                      ) : (
                        <div className="divide-y divide-border">
                          {group.rows.map((mention) => (
                            <div
                              key={mention.url}
                              className="flex items-center gap-3 bg-background/40 px-5 py-2.5"
                            >
                              <span className="hidden w-40 shrink-0 truncate font-mono text-[11px] text-muted-foreground sm:block">
                                {hostOfUrl(mention.url, mention.domain)}
                              </span>
                              <span className="min-w-0 flex-1">
                                <SourceLink
                                  url={mention.url}
                                  label={sourceLabel(mention)}
                                />
                              </span>
                              <Badge
                                variant="outline"
                                className="ml-auto shrink-0 rounded-full text-[10px] text-muted-foreground"
                              >
                                {(mention.source_type ?? "web").replaceAll("_", " ")}
                              </Badge>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </details>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

/** The site's favicon in a bordered tile. Google's favicon service serves a
 * neutral globe for domains it has no icon for, so no fallback is needed. */
function DomainTile({ domain }: { domain: string }) {
  return (
    <span
      aria-hidden
      className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-background"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- tiny external
          favicon; next/image would need remote-pattern config for no gain */}
      <img
        src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`}
        alt=""
        width={16}
        height={16}
        loading="lazy"
        className="size-4"
      />
    </span>
  );
}

function SourceLink({ url, label }: { url: string; label: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex max-w-full items-center gap-1.5 text-sm font-medium text-[color:var(--arc-accent)] hover:underline"
    >
      <ExternalLink className="size-3.5 shrink-0" />
      <span className="truncate">{label}</span>
    </a>
  );
}
