import { z } from "zod";

export const recommendedBrandSchema = z.object({
  name: z.string(),
  domain: z.string().nullable(),
  position: z.number().int().positive(),
  sentiment: z.enum(["positive", "neutral", "negative", "mixed"]),
  reasonRecommended: z.string(),
});

export const citationSchema = z.object({
  url: z.string(),
  title: z.string().nullable(),
  domain: z.string().nullable(),
  citedForBrand: z.boolean(),
  citedForCompetitor: z.boolean(),
});

export const factualClaimSchema = z.object({
  claim: z.string(),
  subject: z.string(),
  supported: z.boolean(),
  potentiallyOutdated: z.boolean(),
});

export const answerAnalysisSchema = z.object({
  brandMentioned: z.boolean(),
  matchedAlias: z.string().nullable(),
  brandPosition: z.number().int().positive().nullable(),
  brandSentiment: z
    .enum(["positive", "neutral", "negative", "mixed"])
    .nullable(),
  brandDescription: z.string().nullable(),
  answerSummary: z.string(),
  recommendedBrands: z.array(recommendedBrandSchema),
  citations: z.array(citationSchema),
  factualClaims: z.array(factualClaimSchema),
  confidence: z.number().min(0).max(1),
});

export type AnswerAnalysis = z.infer<typeof answerAnalysisSchema>;

export const generatedPromptSchema = z.object({
  prompt: z.string(),
  promptType: z.string(),
  buyerStage: z.string(),
  rationale: z.string(),
  country: z.string(),
  language: z.string(),
});

export const generatedPromptsSchema = z.object({
  prompts: z.array(generatedPromptSchema).min(1).max(20),
});

export type GeneratedPrompt = z.infer<typeof generatedPromptSchema>;

export const brandUnderstandingSchema = z.object({
  name: z.string(),
  canonicalDomain: z.string(),
  aliases: z.array(z.string()),
  description: z.string(),
  category: z.string(),
  targetAudience: z.string(),
  primaryUseCases: z.array(z.string()),
  location: z.string().nullable(),
  likelyCompetitors: z.array(
    z.object({
      name: z.string(),
      domain: z.string().nullable(),
    }),
  ),
  confidence: z.object({
    name: z.number().min(0).max(1),
    category: z.number().min(0).max(1),
    description: z.number().min(0).max(1),
    competitors: z.number().min(0).max(1),
  }),
});

export type BrandUnderstanding = z.infer<typeof brandUnderstandingSchema>;
