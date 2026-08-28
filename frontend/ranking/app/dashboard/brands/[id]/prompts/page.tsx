import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { getAccountEntitlements } from "@/lib/billing/account";
import { isPaidSubscription } from "@/lib/billing/is-paid";
import { hasFeature, PLAN_CONFIG } from "@/lib/billing/entitlements";
import {
  getBrandById,
  getLatestCompletedScanForBrand,
  getQueryResults,
  listAllPrompts,
} from "@/lib/db/repository";
import { providerDisplayName } from "@/lib/constants";
import { assistantNames } from "@/lib/audit/progress-copy";
import { BrandPageHeader } from "@/components/dashboard/brand-page-header";
import { ProviderStack } from "@/components/providers/provider-logo";
import { PromptsManager } from "@/components/dashboard/prompts-manager";
import {
  AnswerExplorer,
  type ExplorerQuestion,
} from "@/components/dashboard/answer-explorer";

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
  const showFullAnswers = hasFeature(entitlements.plan, "fullAnswers");
  const plan = PLAN_CONFIG[entitlements.plan];
  const canEditAuditSetup =
    entitlements.providerChecksUsed < plan.features.providerChecksPerMonth;
  const promptMap = new Map(prompts.map((prompt) => [prompt.id, prompt]));

  // Group the flat provider results into one entry per buyer question,
  // keeping the order questions first appeared in the scan. Results without
  // a tracked prompt (legacy rows) are kept under a fallback group so no
  // collected answer is dropped.
  const groups = new Map<string, ExplorerQuestion>();
  for (const result of results) {
    const key = result.tracked_prompt_id ?? "untracked";
    const prompt = result.tracked_prompt_id
      ? promptMap.get(result.tracked_prompt_id)
      : null;
    let group = groups.get(key);
    if (!group) {
      group = {
        promptId: key,
        question: prompt?.prompt ?? "Buyer question",
        promptType: prompt?.prompt_type ?? null,
        answers: [],
      };
      groups.set(key, group);
    }

    const recommended = Array.isArray(result.recommended_brands)
      ? (result.recommended_brands as RecommendedCompany[])
      : [];
    const citations = Array.isArray(result.citations)
      ? (result.citations as Citation[])
      : [];
    const answer = showFullAnswers
      ? (
          result.raw_answer ||
          result.answer_summary ||
          "No answer saved"
        )
          .replaceAll("**", "")
          .replace(/^#+\s*/gm, "")
      : "";

    group.answers.push({
      id: result.id,
      provider: result.provider,
      assistantName:
        assistantNames([result.provider])[0] ??
        providerDisplayName(result.provider),
      mentioned: result.brand_mentioned,
      position: result.brand_position,
      answer,
      recommended: recommended
        .filter((company) => Boolean(company.name))
        .slice(0, 5)
        .map((company) => ({
          name: company.name ?? "",
          position: company.position ?? null,
          reason: company.reasonRecommended ?? null,
        })),
      citations: citations
        .filter((citation): citation is Citation & { url: string } =>
          Boolean(citation.url),
        )
        .map((citation) => ({
          url: citation.url,
          label: citation.title || citation.domain || citation.url,
        })),
    });
  }
  const questions = Array.from(groups.values());
  const auditProviders = Array.from(
    new Set(results.map((result) => result.provider)),
  );
  const assistantCount = new Set(
    results.map(
      (result) =>
        assistantNames([result.provider])[0] ??
        providerDisplayName(result.provider),
    ),
  ).size;

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
        <div className="arc-empty p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No AI answers yet. Run an audit to collect prompt-level evidence.
          </p>
        </div>
      ) : (
        <section>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold tracking-tight">
                Questions and answers
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {questions.length} questions · {assistantCount} AI providers ·{" "}
                {results.length} saved answers. Open a question to read what
                each provider said, with {brand.name} highlighted.
              </p>
            </div>
            <span className="arc-chip text-muted-foreground">
              <ProviderStack providers={auditProviders} max={8} />
              <span className="ml-1">Asked in this audit</span>
            </span>
          </div>
          <div className="mt-4">
            <AnswerExplorer
              questions={questions}
              brandName={brand.name}
              showFullAnswers={showFullAnswers}
              brandId={brand.id}
            />
          </div>
        </section>
      )}

      {isPaid ? (
        <section className="arc-panel">
          <div className="border-b border-border px-5 py-4">
            <h2 className="text-[15px] font-semibold tracking-tight">
              Buyer question library
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              The questions your audits ask. Active questions run in the next
              audit; monitoring rotates through the rest.
            </p>
          </div>
          <div className="p-5">
            <PromptsManager
              brandId={brand.id}
              initialPrompts={prompts}
              activePromptLimit={plan.features.activePrompts}
              isPaid={isPaid}
              canEdit={canEditAuditSetup}
              defaultCountry={brand.default_country}
              defaultLanguage={brand.default_language}
            />
          </div>
        </section>
      ) : null}
    </div>
  );
}
