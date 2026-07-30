import { analyzeProviderAnswer } from "@/lib/ai/analysis/analyze";
import { providerKeyMissing } from "@/lib/ai/providers/demo";
import { getProvider } from "@/lib/ai/providers/registry";
import { generateRecommendations } from "@/lib/ai/recommendations/generate";
import { aggregateScanScores } from "@/lib/ai/scoring/score";
import { citationSupportsBrand } from "@/lib/ai/matching/aliases";
import { METHODOLOGY_VERSION, PROVIDER_CONCURRENCY, SCAN_COST_CEILING_USD } from "@/lib/constants";
import {
  getBrandById,
  getPrompts,
  getScanRun,
  insertQueryResult,
  replaceRecommendations,
  updateScanRun,
  upsertScore,
  addUsage,
} from "@/lib/db/repository";
import type { ProviderId } from "@/types/database";

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

export async function executeScanRun(scanRunId: string): Promise<void> {
  const scan = await getScanRun(scanRunId);
  if (!scan) throw new Error(`Scan ${scanRunId} not found`);
  if (scan.status === "cancelled") return;

  const brand = await getBrandById(scan.brand_id);
  if (!brand) throw new Error("Brand missing for scan");

  const prompts = await getPrompts(brand.id);
  const providers = scan.provider_ids as ProviderId[];

  await updateScanRun(scanRunId, {
    status: "running",
    started_at: new Date().toISOString(),
    total_queries: prompts.length * providers.length,
    completed_queries: 0,
    methodology_version: METHODOLOGY_VERSION,
  });

  let completed = 0;
  let estimatedCost = 0;
  let failures = 0;
  const analyses: Array<{
    promptId: string | null;
    promptText: string;
    analysis: Awaited<ReturnType<typeof analyzeProviderAnswer>>;
    brandMentioned: boolean;
    brandPosition: number | null;
    brandSentiment: "positive" | "neutral" | "negative" | "mixed" | null;
    citationSupportingBrand: boolean;
    recommendedBrands: Array<{ name: string; position: number }>;
  }> = [];

  const work = prompts.flatMap((prompt) =>
    providers.map((provider) => ({ prompt, provider })),
  );

  for (const batch of chunk(work, PROVIDER_CONCURRENCY)) {
    const current = await getScanRun(scanRunId);
    if (current?.status === "cancelled" || current?.cancelled_at) {
      await updateScanRun(scanRunId, { status: "cancelled" });
      return;
    }
    if (estimatedCost >= SCAN_COST_CEILING_USD) {
      failures += batch.length;
      break;
    }

    await Promise.all(
      batch.map(async ({ prompt, provider }) => {
        const providerImpl = getProvider(provider);
        const result = await providerImpl.runQuery({
          query: prompt.prompt,
          country: scan.country ?? prompt.country,
          language: scan.language ?? prompt.language,
        });

        const analysis = await analyzeProviderAnswer(result, {
          brandName: brand.name,
          brandDomain: brand.canonical_domain,
          aliases: brand.aliases ?? [],
        });

        const cost = result.isDemo ? 0 : 0.02;
        estimatedCost += cost;

        await insertQueryResult({
          scan_run_id: scanRunId,
          tracked_prompt_id: prompt.id,
          provider,
          model: result.model,
          raw_answer: result.rawAnswer,
          answer_summary: analysis.answerSummary,
          brand_mentioned: analysis.brandMentioned,
          brand_position: analysis.brandPosition,
          brand_sentiment: analysis.brandSentiment,
          confidence: analysis.confidence,
          recommended_brands: analysis.recommendedBrands,
          citations: analysis.citations,
          sources: result.sources,
          claims: analysis.factualClaims,
          latency_ms: result.latencyMs,
          usage_metadata: {
            inputTokens: result.usage.inputTokens ?? null,
            outputTokens: result.usage.outputTokens ?? null,
            totalTokens: result.usage.totalTokens ?? null,
            searchCalls: result.usage.searchCalls ?? null,
          },
          estimated_cost: cost,
          error: result.error,
          is_demo: result.isDemo || providerKeyMissing(provider),
        });

        if (result.error && !result.rawAnswer) failures += 1;

        analyses.push({
          promptId: prompt.id,
          promptText: prompt.prompt,
          analysis,
          brandMentioned: analysis.brandMentioned,
          brandPosition: analysis.brandPosition,
          brandSentiment: analysis.brandSentiment,
          citationSupportingBrand: citationSupportsBrand(
            analysis.citations,
            brand.canonical_domain,
          ),
          recommendedBrands: analysis.recommendedBrands.map((b) => ({
            name: b.name,
            position: b.position,
          })),
        });

        completed += 1;
        await updateScanRun(scanRunId, { completed_queries: completed });

        if (scan.initiated_by) {
          await addUsage({
            user_id: scan.initiated_by,
            brand_id: brand.id,
            scan_run_id: scanRunId,
            provider,
            operation: "provider_check",
            units: 1,
            estimated_cost: cost,
            billing_period: new Date().toISOString().slice(0, 7),
          });
        }
      }),
    );
  }

  const score = aggregateScanScores(analyses, brand.name);
  await upsertScore({
    brand_id: brand.id,
    scan_run_id: scanRunId,
    overall_score: score.overallScore,
    mention_score: score.mentionScore,
    position_score: score.positionScore,
    citation_score: score.citationScore,
    sentiment_score: score.sentimentScore,
    mention_rate: score.mentionRate,
    average_position: score.averagePosition,
    share_of_voice: score.shareOfVoice,
    competitor_scores: score.competitorScores,
  });

  const actions = generateRecommendations({
    brandName: brand.name,
    prompts,
    analyses,
    competitorScores: score.competitorScores,
  });

  await replaceRecommendations(brand.id, scanRunId, actions);

  const status =
    failures === 0
      ? "completed"
      : completed > 0
        ? "partial"
        : "failed";

  await updateScanRun(scanRunId, {
    status,
    completed_at: new Date().toISOString(),
    completed_queries: completed,
    error_summary:
      failures > 0
        ? `${failures} provider query(ies) failed or cost ceiling reached.`
        : null,
  });
}
