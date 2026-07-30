import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { getSessionUser } from "@/lib/auth/session";
import { getAccountEntitlements } from "@/lib/billing/account";
import { isPaidSubscription } from "@/lib/billing/is-paid";
import {
  getBrandById,
  getLatestCompletedScanForBrand,
  getQueryResults,
  listAllPrompts,
} from "@/lib/db/repository";
import { providerDisplayName } from "@/lib/constants";
import { Badge } from "@/components/ui/badge";
import { BrandPageHeader } from "@/components/dashboard/brand-page-header";
import { ProReportLock } from "@/components/dashboard/pro-report-lock";
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
  provider: ProviderId;
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
  const citations: CitationRow[] = results.flatMap((result) =>
    ((result.citations as Citation[]) ?? []).map((citation) => ({
      ...citation,
      provider: result.provider,
      question: result.tracked_prompt_id
        ? promptMap.get(result.tracked_prompt_id)
        : null,
    })),
  );
  const mentionMap = new Map<string, VerifiedMention>();
  for (const result of results) {
    for (const mention of (result.sources as VerifiedMention[]) ?? []) {
      if (mention?.url && mention.verified !== false) {
        mentionMap.set(mention.url, mention);
      }
    }
  }
  const verifiedMentions = Array.from(mentionMap.values());

  return (
    <div className="space-y-6">
      <BrandPageHeader
        brandId={brand.id}
        brandName={brand.name}
        title="Sources & Mentions"
        description="Native AI citations and independently verified company mentions are kept separate."
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
          <section className="space-y-3">
            <div>
              <h2 className="text-base font-semibold">Native AI citations</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Sources returned by a search-grounded provider during the answer.
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
                            label={
                              citation.title || citation.domain || citation.url
                            }
                          />
                          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                            {citation.question ?? "Question unavailable"}
                          </p>
                          <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                            {providerDisplayName(citation.provider)} ·{" "}
                            {citation.domain ?? "unknown domain"}
                          </p>
                        </div>
                        <Badge
                          variant="secondary"
                          className="rounded-full text-[11px] text-[color:var(--rb-green)]"
                        >
                          Grounded
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          <section className="space-y-3">
            <div>
              <h2 className="text-base font-semibold">Verified web mentions</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Pages found after the AI answers. They measure web presence and are
                not claimed as sources used by the model.
              </p>
            </div>
            {verifiedMentions.length === 0 ? (
              <div className="rb-empty p-5 text-sm text-muted-foreground">
                No independently verified mentions were collected.
              </div>
            ) : (
              <div className="rb-list">
                <div className="divide-y divide-border">
                  {verifiedMentions.map((mention) => (
                    <div key={mention.url} className="bg-card px-5 py-4">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <SourceLink
                            url={mention.url}
                            label={
                              mention.title || mention.domain || mention.url
                            }
                          />
                          <p className="mt-1 text-xs text-muted-foreground">
                            {mention.company_name ?? "Company"} ·{" "}
                            {mention.query ?? "Discovery query unavailable"}
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
                            {(mention.source_type ?? "web source").replaceAll(
                              "_",
                              " ",
                            )}
                          </Badge>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
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
