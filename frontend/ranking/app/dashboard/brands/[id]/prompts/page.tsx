import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { getAccountEntitlements } from "@/lib/billing/account";
import { isPaidSubscription } from "@/lib/billing/is-paid";
import { hasFeature } from "@/lib/billing/entitlements";
import {
  getBrandById,
  getLatestCompletedScanForBrand,
  getQueryResults,
  getScanQuestions,
  getScanRun,
  listAllPrompts,
} from "@/lib/db/repository";
import { providerDisplayName } from "@/lib/constants";
import { assistantNames } from "@/lib/audit/progress-copy";
import { BrandPageHeader } from "@/components/dashboard/brand-page-header";
import { ProviderStack } from "@/components/providers/provider-logo";
import { auditCoverage, questionKey } from "@/lib/audit/coverage";
import { sourceLabel } from "@/lib/audit/source-links";
import { AuditCoverageNotice } from "@/components/dashboard/audit-coverage";
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
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ scan?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) return null;
  const { id } = await params;
  const brand = await getBrandById(id);
  if (!brand || brand.owner_id !== user.id) notFound();

  const query = await searchParams;
  if (
    query.scan &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      query.scan,
    )
  )
    notFound();
  const [entitlements, prompts, latestScan] = await Promise.all([
    getAccountEntitlements(user.id),
    listAllPrompts(brand.id),
    query.scan
      ? getScanRun(query.scan)
      : getLatestCompletedScanForBrand(brand.id),
  ]);
  if (
    (query.scan && !latestScan) ||
    (latestScan && latestScan.brand_id !== brand.id)
  )
    notFound();
  const results = latestScan ? await getQueryResults(latestScan.id) : [];
  const scanQuestions = latestScan ? await getScanQuestions(latestScan.id) : [];
  const coverage = latestScan
    ? auditCoverage(latestScan, results, scanQuestions)
    : null;
  const isPaid = isPaidSubscription(entitlements);
  const showFullAnswers = hasFeature(entitlements.plan, "fullAnswers");
  const promptMap = new Map(prompts.map((prompt) => [prompt.id, prompt]));

  // Group the flat provider results into one entry per buyer question,
  // keeping the order questions first appeared in the scan. Results without
  // a tracked prompt (legacy rows) are kept under a fallback group so no
  // collected answer is dropped.
  const groups = new Map<string, ExplorerQuestion>();
  for (const result of results) {
    const key = questionKey(result);
    const prompt = result.tracked_prompt_id
      ? promptMap.get(result.tracked_prompt_id)
      : null;
    let group = groups.get(key);
    if (!group) {
      group = {
        promptId: key,
        question:
          scanQuestions.find((row) => row.position === result.question_position)
            ?.prompt ??
          prompt?.prompt ??
          "Question text not recorded",
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
      error:
        result.error ||
        (!(result.raw_answer?.trim() || result.answer_summary?.trim())
          ? "No usable saved response"
          : null),
      summary: result.answer_summary,
      position: result.brand_position,
      answer,
      recommended: recommended
        .filter((company) => Boolean(company.name))
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
          label: sourceLabel(citation),
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

      {coverage ? <AuditCoverageNotice coverage={coverage} /> : null}
      {results.length === 0 ? (
        <div className="arc-empty p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No AI answers yet. Run an audit to collect answers to your buyer questions.
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
                {questions.length} questions · {assistantCount} AI assistants ·{" "}
                {results.length} AI answers. Open a question to read what
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
    </div>
  );
}
