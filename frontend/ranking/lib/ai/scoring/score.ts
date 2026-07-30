import { POSITION_SCORES, SCORE_WEIGHTS, SENTIMENT_SCORES } from "@/lib/constants";
import type { Sentiment } from "@/types/database";

export type QueryScoreInput = {
  brandMentioned: boolean;
  brandPosition: number | null;
  brandSentiment: Sentiment | null;
  citationSupportingBrand: boolean;
  recommendedBrands: Array<{ name: string; position: number }>;
};

export type QueryScore = {
  mentionValue: number;
  positionValue: number;
  citationValue: number;
  sentimentValue: number;
  overall: number;
};

export type CompetitorAggregate = {
  name: string;
  mentions: number;
  shareOfVoice: number;
};

export type ScanScoreResult = {
  overallScore: number;
  mentionScore: number;
  positionScore: number;
  citationScore: number;
  sentimentScore: number;
  mentionRate: number;
  averagePosition: number | null;
  shareOfVoice: number;
  competitorScores: CompetitorAggregate[];
  queryScores: QueryScore[];
};

export function positionValue(position: number | null): number {
  if (position == null) return 0;
  if (position in POSITION_SCORES) return POSITION_SCORES[position]!;
  if (position >= 6) return 10;
  return 0;
}

export function sentimentValue(sentiment: Sentiment | null): number {
  if (!sentiment) return 0;
  return SENTIMENT_SCORES[sentiment];
}

export function scoreQuery(input: QueryScoreInput): QueryScore {
  const meaningfullyIncluded =
    input.brandMentioned &&
    (input.brandPosition != null ||
      input.recommendedBrands.some((b) => b.position > 0));

  const mentionValue = meaningfullyIncluded || input.brandMentioned ? 100 : 0;
  const pos = positionValue(input.brandPosition);
  const citation = input.citationSupportingBrand ? 100 : 0;
  const sentiment = input.brandMentioned
    ? sentimentValue(input.brandSentiment)
    : 0;

  const overall =
    mentionValue * SCORE_WEIGHTS.mention +
    pos * SCORE_WEIGHTS.position +
    citation * SCORE_WEIGHTS.citation +
    sentiment * SCORE_WEIGHTS.sentiment;

  return {
    mentionValue,
    positionValue: pos,
    citationValue: citation,
    sentimentValue: sentiment,
    overall,
  };
}

export function aggregateScanScores(
  queries: QueryScoreInput[],
  brandName: string,
): ScanScoreResult {
  if (queries.length === 0) {
    return {
      overallScore: 0,
      mentionScore: 0,
      positionScore: 0,
      citationScore: 0,
      sentimentScore: 0,
      mentionRate: 0,
      averagePosition: null,
      shareOfVoice: 0,
      competitorScores: [],
      queryScores: [],
    };
  }

  const queryScores = queries.map(scoreQuery);
  const mentionScore =
    queryScores.reduce((sum, q) => sum + q.mentionValue, 0) / queryScores.length;
  const positionScore =
    queryScores.reduce((sum, q) => sum + q.positionValue, 0) / queryScores.length;
  const citationScore =
    queryScores.reduce((sum, q) => sum + q.citationValue, 0) / queryScores.length;
  const sentimentScore =
    queryScores.reduce((sum, q) => sum + q.sentimentValue, 0) / queryScores.length;

  const overallScore =
    mentionScore * SCORE_WEIGHTS.mention +
    positionScore * SCORE_WEIGHTS.position +
    citationScore * SCORE_WEIGHTS.citation +
    sentimentScore * SCORE_WEIGHTS.sentiment;

  const mentioned = queries.filter((q) => q.brandMentioned);
  const positions = mentioned
    .map((q) => q.brandPosition)
    .filter((p): p is number => p != null);
  const averagePosition =
    positions.length > 0
      ? positions.reduce((a, b) => a + b, 0) / positions.length
      : null;

  const competitorCounts = new Map<string, number>();
  let brandMentions = 0;

  for (const query of queries) {
    if (query.brandMentioned) brandMentions += 1;
    for (const rec of query.recommendedBrands) {
      const key = rec.name.trim().toLowerCase();
      if (!key) continue;
      if (key === brandName.trim().toLowerCase()) continue;
      competitorCounts.set(key, (competitorCounts.get(key) ?? 0) + 1);
    }
  }

  const totalMentions =
    brandMentions +
    Array.from(competitorCounts.values()).reduce((a, b) => a + b, 0);

  const competitorScores: CompetitorAggregate[] = Array.from(
    competitorCounts.entries(),
  )
    .map(([name, mentions]) => ({
      name,
      mentions,
      shareOfVoice: totalMentions > 0 ? mentions / totalMentions : 0,
    }))
    .sort((a, b) => b.mentions - a.mentions);

  return {
    overallScore,
    mentionScore,
    positionScore,
    citationScore,
    sentimentScore,
    mentionRate: mentioned.length / queries.length,
    averagePosition,
    shareOfVoice: totalMentions > 0 ? brandMentions / totalMentions : 0,
    competitorScores,
    queryScores,
  };
}

export function roundForDisplay(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
