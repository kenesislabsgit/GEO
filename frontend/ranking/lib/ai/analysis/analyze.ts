import OpenAI from "openai";
import {
  answerAnalysisSchema,
  type AnswerAnalysis,
} from "@/lib/ai/schemas/analysis";
import {
  buildAliasSet,
  citationSupportsBrand,
  findMatchedAlias,
} from "@/lib/ai/matching/aliases";
import { providerKeyMissing } from "@/lib/ai/providers/demo";
import type { ProviderQueryResult } from "@/lib/ai/providers/types";

export type AnalysisContext = {
  brandName: string;
  brandDomain: string;
  aliases: string[];
};

export async function analyzeProviderAnswer(
  result: ProviderQueryResult,
  ctx: AnalysisContext,
): Promise<AnswerAnalysis> {
  const aliases = buildAliasSet({
    name: ctx.brandName,
    domain: ctx.brandDomain,
    aliases: ctx.aliases,
  });
  const deterministicMatch = findMatchedAlias(result.rawAnswer, aliases);

  if (!result.rawAnswer || result.error) {
    return answerAnalysisSchema.parse({
      brandMentioned: Boolean(deterministicMatch),
      matchedAlias: deterministicMatch,
      brandPosition: null,
      brandSentiment: null,
      brandDescription: null,
      answerSummary: result.error ?? "No answer returned.",
      recommendedBrands: [],
      citations: result.citations.map((c) => ({
        url: c.url,
        title: c.title,
        domain: c.domain,
        citedForBrand: citationSupportsBrand([c], ctx.brandDomain),
        citedForCompetitor: false,
      })),
      factualClaims: [],
      confidence: deterministicMatch ? 0.4 : 0.2,
    });
  }

  if (providerKeyMissing("openai")) {
    return heuristicAnalysis(result, ctx, aliases, deterministicMatch);
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = process.env.OPENAI_ANALYSIS_MODEL ?? "gpt-5.6-luna";

  const response = await client.responses.create({
    model,
    input: [
      {
        role: "system",
        content:
          "Analyze an AI answer for brand visibility. Position refers only to position in an actual recommendation list. Do not treat casual mentions as recommendations. Return JSON only.",
      },
      {
        role: "user",
        content: JSON.stringify({
          brandName: ctx.brandName,
          brandDomain: ctx.brandDomain,
          aliases,
          answer: result.rawAnswer,
          citations: result.citations,
        }),
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "answer_analysis",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            brandMentioned: { type: "boolean" },
            matchedAlias: { type: ["string", "null"] },
            brandPosition: { type: ["integer", "null"] },
            brandSentiment: {
              type: ["string", "null"],
              enum: ["positive", "neutral", "negative", "mixed", null],
            },
            brandDescription: { type: ["string", "null"] },
            answerSummary: { type: "string" },
            recommendedBrands: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  name: { type: "string" },
                  domain: { type: ["string", "null"] },
                  position: { type: "integer" },
                  sentiment: {
                    type: "string",
                    enum: ["positive", "neutral", "negative", "mixed"],
                  },
                  reasonRecommended: { type: "string" },
                },
                required: [
                  "name",
                  "domain",
                  "position",
                  "sentiment",
                  "reasonRecommended",
                ],
              },
            },
            citations: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  url: { type: "string" },
                  title: { type: ["string", "null"] },
                  domain: { type: ["string", "null"] },
                  citedForBrand: { type: "boolean" },
                  citedForCompetitor: { type: "boolean" },
                },
                required: [
                  "url",
                  "title",
                  "domain",
                  "citedForBrand",
                  "citedForCompetitor",
                ],
              },
            },
            factualClaims: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  claim: { type: "string" },
                  subject: { type: "string" },
                  supported: { type: "boolean" },
                  potentiallyOutdated: { type: "boolean" },
                },
                required: [
                  "claim",
                  "subject",
                  "supported",
                  "potentiallyOutdated",
                ],
              },
            },
            confidence: { type: "number" },
          },
          required: [
            "brandMentioned",
            "matchedAlias",
            "brandPosition",
            "brandSentiment",
            "brandDescription",
            "answerSummary",
            "recommendedBrands",
            "citations",
            "factualClaims",
            "confidence",
          ],
        },
      },
    },
  });

  const llm = answerAnalysisSchema.parse(
    JSON.parse(response.output_text || "{}"),
  );

  // Deterministic alias/domain matching overrides casual false negatives.
  const brandMentioned = llm.brandMentioned || Boolean(deterministicMatch);
  const citations =
    llm.citations.length > 0
      ? llm.citations
      : result.citations.map((c) => ({
          url: c.url,
          title: c.title,
          domain: c.domain,
          citedForBrand: citationSupportsBrand([c], ctx.brandDomain),
          citedForCompetitor: false,
        }));

  return {
    ...llm,
    brandMentioned,
    matchedAlias: llm.matchedAlias ?? deterministicMatch,
    citations,
  };
}

function heuristicAnalysis(
  result: ProviderQueryResult,
  ctx: AnalysisContext,
  aliases: string[],
  matchedAlias: string | null,
): AnswerAnalysis {
  const mentioned = Boolean(matchedAlias);
  const recommendedBrands: AnswerAnalysis["recommendedBrands"] = [];
  const lines = result.rawAnswer.split(/\n+/);
  let positionCounter = 0;
  for (const line of lines) {
    const m = line.match(/^\s*(?:\d+[\).]|[-*])\s+([A-Z][\w\s.&-]{1,40})/);
    if (!m) continue;
    positionCounter += 1;
    recommendedBrands.push({
      name: m[1]!.trim(),
      domain: null,
      position: positionCounter,
      sentiment: "neutral",
      reasonRecommended: "Listed in answer",
    });
  }

  const brandRec = recommendedBrands.find((b) =>
    aliases.includes(b.name.toLowerCase()),
  );

  return answerAnalysisSchema.parse({
    brandMentioned: mentioned,
    matchedAlias,
    brandPosition: brandRec?.position ?? null,
    brandSentiment: mentioned ? "neutral" : null,
    brandDescription: mentioned ? `${ctx.brandName} appears in the answer.` : null,
    answerSummary: result.rawAnswer.slice(0, 280),
    recommendedBrands,
    citations: result.citations.map((c) => ({
      url: c.url,
      title: c.title,
      domain: c.domain,
      citedForBrand: citationSupportsBrand([c], ctx.brandDomain),
      citedForCompetitor: false,
    })),
    factualClaims: [],
    confidence: mentioned ? 0.55 : 0.4,
  });
}
