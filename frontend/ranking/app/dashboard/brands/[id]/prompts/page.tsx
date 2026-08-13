import { notFound } from "next/navigation";
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
import { assistantNames } from "@/lib/audit/progress-copy";
import { BrandPageHeader } from "@/components/dashboard/brand-page-header";
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
  const plan = PLAN_CONFIG[entitlements.plan];
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
    const answer = (result.raw_answer || result.answer_summary || "No answer saved")
      .replaceAll("**", "")
      .replace(/^#+\s*/gm, "");

    group.answers.push({
      id: result.id,
      provider: result.provider,
      assistantName:
        assistantNames([result.provider])[0] ?? providerDisplayName(result.provider),
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
  const assistantCount = new Set(
    results.map(
      (result) =>
        assistantNames([result.provider])[0] ?? providerDisplayName(result.provider),
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
        <div className="rb-empty p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No AI answers yet. Run an audit to collect prompt-level evidence.
          </p>
        </div>
      ) : (
        <section>
          <p className="rb-eyebrow">Answer explorer</p>
          <h2 className="mt-1 text-base font-semibold">Questions and answers</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {questions.length} questions / {assistantCount} assistants /{" "}
            {results.length} saved answers. Open a question to read what each
            assistant said, with {brand.name} highlighted.
          </p>
          <div className="mt-3">
            <AnswerExplorer questions={questions} brandName={brand.name} />
          </div>
        </section>
      )}

      {isPaid ? (
        <details className="border-t border-border pt-5">
          <summary className="cursor-pointer text-sm font-medium">
            Manage buyer question library
          </summary>
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
