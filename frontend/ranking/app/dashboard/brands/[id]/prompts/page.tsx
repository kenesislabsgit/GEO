import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { getSessionUser } from "@/lib/auth/session";
import { getAccountEntitlements } from "@/lib/billing/account";
import { isPaidSubscription } from "@/lib/billing/is-paid";
import { PLAN_CONFIG } from "@/lib/billing/entitlements";
import {
  getBrandById,
  getLatestCompletedScanForBrand,
  getQueryResults,
  listAllPrompts,
} from "@/lib/db/repository";
import { providerDisplayName } from "@/lib/constants";
import { BrandPageHeader } from "@/components/dashboard/brand-page-header";
import { PromptsManager } from "@/components/dashboard/prompts-manager";
import { Badge } from "@/components/ui/badge";

type RecommendedCompany = {
  name?: string;
  position?: number | null;
  reasonRecommended?: string;
};

type Citation = {
  url?: string;
  title?: string | null;
  domain?: string | null;
};

export default async function AIAnswersPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getSessionUser();
  if (!user) return null;
  const { id } = await params;
  const brand = await getBrandById(id);
  if (!brand || brand.owner_id !== user.id) notFound();

  const [entitlements, prompts, latestScan] = await Promise.all([
    getAccountEntitlements(user.id),
    listAllPrompts(brand.id),
    getLatestCompletedScanForBrand(brand.id),
  ]);
  const results = latestScan ? await getQueryResults(latestScan.id) : [];
  const isPaid = isPaidSubscription(entitlements);
  const plan = PLAN_CONFIG[entitlements.plan];
  const promptMap = new Map(prompts.map((prompt) => [prompt.id, prompt]));
  const testedPromptIds = Array.from(
    new Set(
      results
        .map((result) => result.tracked_prompt_id)
        .filter((promptId): promptId is string => Boolean(promptId)),
    ),
  );
  const providers = Array.from(new Set(results.map((result) => result.provider)));

  return (
    <div className="space-y-6">
      <BrandPageHeader
        brandId={brand.id}
        brandName={brand.name}
        title="Audit Details"
        description="The complete question and answer record behind the competitor findings."
        isPaid={isPaid}
      />

      {results.length === 0 ? (
        <div className="rb-empty p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No AI answers yet. Run an audit to collect prompt-level evidence.
          </p>
        </div>
      ) : (
        <>
          <details className="rb-panel px-5 py-4">
            <summary className="cursor-pointer text-sm font-medium">
              Question coverage matrix
            </summary>
            <div className="mt-4 flex flex-wrap items-end justify-between gap-3 border-t border-border pt-4">
              <div>
                <h2 className="text-base font-semibold">Question comparison</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {testedPromptIds.length} questions / {providers.length} providers / {results.length} AI checks
                </p>
                <p className="mt-2 max-w-2xl text-xs leading-relaxed text-muted-foreground">
                  Not mentioned means the provider answered but did not include {brand.name}. Not tested means no answer was collected from that provider for the question.
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {providers.map((provider) => (
                  <Badge key={provider} variant="secondary" className="rounded-full text-[11px]">
                    {providerDisplayName(provider)}
                  </Badge>
                ))}
              </div>
            </div>
            <div className="mt-3 overflow-x-auto rb-list">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="border-b border-border bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="w-[42%] px-4 py-3 font-medium">Buyer question</th>
                    {providers.map((provider) => (
                      <th key={provider} className="px-4 py-3 font-medium">{providerDisplayName(provider)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {testedPromptIds.map((promptId) => {
                    const prompt = promptMap.get(promptId);
                    return (
                      <tr key={promptId} className="bg-card">
                        <td className="px-4 py-3.5 align-top">
                          <p className="font-medium">{prompt?.prompt ?? "Buyer question"}</p>
                          <p className="mt-1 text-[11px] capitalize text-muted-foreground">{prompt?.prompt_type?.replaceAll("_", " ")}</p>
                        </td>
                        {providers.map((provider) => {
                          const result = results.find((item) => item.tracked_prompt_id === promptId && item.provider === provider);
                          return (
                            <td key={provider} className="px-4 py-3.5 align-top">
                              {result ? (
                                <Badge variant={result.brand_mentioned ? "default" : "outline"} className="rounded-full text-[11px]">
                                  {result.brand_mentioned
                                    ? `Mentioned${result.brand_position ? ` #${result.brand_position}` : ""}`
                                    : "Not mentioned"}
                                </Badge>
                              ) : (
                                <Badge variant="secondary" className="rounded-full text-[11px] text-muted-foreground">
                                  Not tested
                                </Badge>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </details>

          <section>
            <h2 className="text-base font-semibold">Questions and answers</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Open a card to inspect the saved answer, highlighted company mentions, rankings, and sources.
            </p>
            <div className="mt-3 space-y-3">
              {results.map((result) => {
                const prompt = result.tracked_prompt_id ? promptMap.get(result.tracked_prompt_id) : null;
                const recommended = Array.isArray(result.recommended_brands)
                  ? (result.recommended_brands as RecommendedCompany[])
                  : [];
                const citations = Array.isArray(result.citations)
                  ? (result.citations as Citation[])
                  : [];
                const answer = (result.raw_answer || result.answer_summary || "No answer saved")
                  .replaceAll("**", "")
                  .replace(/^#+\s*/gm, "");
                return (
                  <details key={result.id} className="rb-panel group p-5">
                    <summary className="cursor-pointer list-none">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="secondary" className="rounded-full text-[11px]">{providerDisplayName(result.provider)}</Badge>
                            <Badge variant={result.brand_mentioned ? "default" : "outline"} className="rounded-full text-[11px]">
                              {result.brand_mentioned ? "Website mentioned" : "Website not mentioned"}
                            </Badge>
                            {citations.length ? <Badge variant="outline" className="rounded-full text-[11px]">{citations.length} sources</Badge> : null}
                          </div>
                          <p className="mt-2 text-sm font-medium">{prompt?.prompt ?? "Buyer question"}</p>
                          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{answer}</p>
                        </div>
                        <span className="text-xs text-muted-foreground group-open:hidden">Open answer</span>
                      </div>
                    </summary>
                    <div className="mt-5 grid gap-5 border-t border-border pt-5 lg:grid-cols-[1fr_260px]">
                      <div>
                        <p className="text-xs font-medium uppercase text-muted-foreground">Full AI answer</p>
                        <div className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">
                          {highlightCompanyNames(answer, [
                            brand.name,
                            ...recommended.map((company) => company.name || ""),
                          ])}
                        </div>
                      </div>
                      <div className="space-y-5">
                        <div>
                          <p className="text-xs font-medium uppercase text-muted-foreground">Recommended companies</p>
                          {recommended.length ? (
                            <ol className="mt-2 space-y-2">
                              {recommended.slice(0, 5).map((company, index) => (
                                <li key={`${company.name}-${index}`} className="text-sm">
                                  <span className="font-medium">{company.position ?? index + 1}. {company.name}</span>
                                  {company.reasonRecommended ? <p className="mt-0.5 text-xs text-muted-foreground">{company.reasonRecommended}</p> : null}
                                </li>
                              ))}
                            </ol>
                          ) : <p className="mt-2 text-sm text-muted-foreground">No ranked recommendations extracted.</p>}
                        </div>
                        <div>
                          <p className="text-xs font-medium uppercase text-muted-foreground">Sources</p>
                          {citations.length ? (
                            <div className="mt-2 space-y-2">
                              {citations.map((citation, index) => (
                                <a key={`${citation.url}-${index}`} href={citation.url} target="_blank" rel="noreferrer" className="flex items-start gap-2 text-xs text-[color:var(--rb-blue)] hover:underline">
                                  <ExternalLink className="mt-0.5 size-3 shrink-0" />
                                  <span className="break-all">{citation.title || citation.domain || citation.url}</span>
                                </a>
                              ))}
                            </div>
                          ) : <p className="mt-2 text-sm text-muted-foreground">No sources returned.</p>}
                        </div>
                      </div>
                    </div>
                  </details>
                );
              })}
            </div>
          </section>
        </>
      )}

      {isPaid ? (
        <details className="border-t border-border pt-5">
          <summary className="cursor-pointer text-sm font-medium">Manage buyer question library</summary>
          <div className="mt-4">
            <PromptsManager
              brandId={brand.id}
              initialPrompts={prompts}
              activePromptLimit={plan.features.activePrompts}
              isPaid={isPaid}
              defaultCountry={brand.default_country}
              defaultLanguage={brand.default_language}
            />
          </div>
        </details>
      ) : null}
    </div>
  );
}

function highlightCompanyNames(text: string, names: string[]) {
  const uniqueNames = Array.from(
    new Set(names.map((name) => name.trim()).filter(Boolean)),
  ).sort((a, b) => b.length - a.length);
  if (!uniqueNames.length) return text;

  const expression = new RegExp(
    `(${uniqueNames.map(escapeRegExp).join("|")})`,
    "gi",
  );
  const nameKeys = new Set(uniqueNames.map((name) => name.toLowerCase()));
  return text.split(expression).map((part, index) =>
    nameKeys.has(part.toLowerCase()) ? (
      <mark
        key={`${part}-${index}`}
        className="rounded-sm bg-[color:var(--rb-blue-soft)] px-0.5 font-medium text-foreground"
      >
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
