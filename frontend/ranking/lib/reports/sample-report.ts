import audit from "@/tests/fixtures/free-audit-export.json";
import type { PublicReportDTO } from "@/lib/reports/public-dto";
import { roundForDisplay } from "@/lib/scores/format";
import { competitorEvidence, reportSources } from "@/lib/reports/evidence";
import { categoryLabel, reportSampling, reportText } from "@/lib/reports/presentation";

/** Public, logged-out report. The file is a real ChatGPT audit, not a mock. */
export const SAMPLE_REPORT_SLUG = "sample";

type PromptRow = {
  prompt: string;
  prompt_type: string;
  mentioned: boolean;
  provider_results?: Array<{
    user_rank: number | null;
    top_recommendations?: string[];
  }>;
};

type QueryRow = {
  model: string;
  prompt: string;
  provider: string;
  raw_answer: string;
  brand_mentioned: boolean;
  citations?: Array<{
    url: string;
    title: string | null;
    domain: string | null;
  }>;
};

type CitationRow = {
  url: string;
  domain?: string;
  mentions_brand?: boolean;
};

type CompetitorRow = {
  name: string;
  mentions: number;
  average_rank: number | null;
};

type EvidenceRow = {
  company_name: string;
  website_url: string | null;
  website_evidence: {
    homepage_url?: string;
    homepage_headline?: string | null;
  } | null;
};

/** Same weights the audit score uses. Mention is most of the number. */
const MENTION_WEIGHT = 0.65;
const POSITION_WEIGHT = 0.3;
const CONFIDENCE_WEIGHT = 0.05;
const POSITION_VALUES: Record<number, number> = {
  1: 100,
  2: 80,
  3: 65,
  4: 50,
  5: 35,
};

function isBrandName(name: string, brand: string): boolean {
  const left = name.trim().toLowerCase();
  const right = brand.trim().toLowerCase();
  return left === right || left.startsWith(`${right} `);
}

function positionValue(position: number): number {
  if (position in POSITION_VALUES) return POSITION_VALUES[position];
  return position >= 6 ? 10 : 0;
}

/** Stripe Connect and Stripe Issuing are Stripe, not rival companies. */
function brandHit(row: PromptRow, brand: string) {
  const result = row.provider_results?.[0];
  const names = result?.top_recommendations ?? [];
  const index = names.findIndex((name) => isBrandName(name, brand));
  if (index === -1) {
    if (!row.mentioned) {
      return {
        mentioned: false,
        position: null as number | null,
        namedAs: null as string | null,
        ahead: names,
      };
    }
    const rank = result?.user_rank ?? null;
    return {
      mentioned: true,
      position: rank,
      namedAs: null as string | null,
      ahead: typeof rank === "number" ? names.slice(0, Math.max(0, rank - 1)) : [],
    };
  }
  const named = names[index];
  return {
    mentioned: true,
    position: index + 1,
    namedAs: named.toLowerCase() === brand.toLowerCase() ? null : named,
    ahead: names.slice(0, index).filter((name) => !isBrandName(name, brand)),
  };
}

function hostOf(url: string, domain?: string): string {
  if (domain) return domain.replace(/^www\./, "");
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function loadSampleReport(): PublicReportDTO {
  const prompts = audit.prompt_matrix as PromptRow[];
  const queries = audit.query_results as QueryRow[];
  const citations = audit.citations as CitationRow[];
  const competitors = audit.top_competitors as CompetitorRow[];
  const evidence = audit.competitor_evidence as EvidenceRow[];
  const recommendation = audit.recommendations[0];
  const brandName = audit.brand.name;
  const hits = prompts.map((row) => brandHit(row, brandName));
  const mentionCount = hits.filter((hit) => hit.mentioned).length;
  const positions = hits
    .map((hit) => hit.position)
    .filter((position): position is number => typeof position === "number");
  const mentionScore = prompts.length ? (mentionCount / prompts.length) * 100 : 0;
  const positionScore = prompts.length
    ? positions.reduce((sum, position) => sum + positionValue(position), 0) /
      prompts.length
    : 0;
  const rivals = competitors.filter((row) => !isBrandName(row.name, brandName));
  const rivalMentions = rivals.reduce((sum, row) => sum + row.mentions, 0);
  const shareOfVoice =
    mentionCount / Math.max(1, mentionCount + rivalMentions);
  const overall =
    mentionScore * MENTION_WEIGHT +
    positionScore * POSITION_WEIGHT +
    audit.score.data_confidence_score * CONFIDENCE_WEIGHT;
  const mentioned = queries.find((row) => row.brand_mentioned) ?? null;
  const investigated = evidence.find((row) => row.website_evidence) ?? null;

  const sourceRows = new Map<
    string,
    PublicReportDTO["sources"][number]
  >();
  for (const citation of citations) {
    if (!citation.url) continue;
    const existing = sourceRows.get(citation.url);
    if (existing) {
      existing.citedInAnswers += 1;
      if (citation.mentions_brand) existing.mentionsBrand = true;
      continue;
    }
    sourceRows.set(citation.url, {
      domain: hostOf(citation.url, citation.domain),
      url: citation.url,
      title: null,
      citedInAnswers: 1,
      mentionsBrand:
        typeof citation.mentions_brand === "boolean"
          ? citation.mentions_brand
          : null,
    });
  }
  const sortedSources = [...sourceRows.values()].sort(
    (a, b) => b.citedInAnswers - a.citedInAnswers,
  );
  const shownSources = sortedSources.slice(0, 5);

  return {
    brand: {
      name: audit.brand.name,
      slug: SAMPLE_REPORT_SLUG,
      domain: audit.brand.domain,
      category: audit.brand.category,
      description: audit.brand.description,
    },
    scan: {
      id: SAMPLE_REPORT_SLUG,
      status: audit.scan.status,
      createdAt: audit.generated_at,
      completedAt: audit.generated_at,
      methodologyVersion: audit.scan.methodology_version,
      demoMode: false,
      providerIds: audit.scan.provider_ids,
      promptCount: prompts.length,
      confidence: citations.length > 0 ? "standard" : "low",
      sampling: { ...reportSampling(queries.map((row) => ({ ...row, question: row.prompt }))), timestampLabel: "Export generated (original scan time not recorded)" },
    },
    score: {
      overall: roundForDisplay(overall),
      mentionRate: roundForDisplay(mentionScore),
      averagePosition: positions.length
        ? roundForDisplay(
            positions.reduce((sum, position) => sum + position, 0) /
              positions.length,
          )
        : null,
      shareOfVoice: roundForDisplay(shareOfVoice * 100),
    },
    promptMatrix: prompts.map((row, index) => ({
      prompt: row.prompt,
      promptType: categoryLabel(row.prompt_type),
      mentioned: hits[index].mentioned,
      position: hits[index].position,
      beatenBy: hits[index].ahead,
      namedAs: hits[index].namedAs,
    })),
    topCompetitor: rivals[0]
      ? { name: rivals[0].name, mentions: rivals[0].mentions }
      : null,
    competitorPreview: rivals.slice(0, 5).map((row) => {
      const savedEvidence = competitorEvidence(
        audit.score.competitor_scores.find((competitor) => competitor.name === row.name),
      );
      return {
        name: row.name,
        mentions: row.mentions,
        averagePosition: row.average_rank,
        evidenceStatus: savedEvidence.evidenceStatus,
        evidence: savedEvidence,
      };
    }),
    investigatedCompetitor: investigated
      ? {
          name: investigated.company_name,
          mentions:
            competitors.find((row) => row.name === investigated.company_name)
              ?.mentions ?? 1,
          website: investigated.website_url,
          pages: investigated.website_evidence?.homepage_headline
            ? [
                {
                  label: "Homepage",
                  url: investigated.website_evidence.homepage_url ?? null,
                  excerpt: investigated.website_evidence.homepage_headline,
                },
              ]
            : [],
        }
      : null,
    sources: shownSources,
    sourceSummary: {
      total: sortedSources.length,
      mentioningBrand: sortedSources.filter((row) => row.mentionsBrand === true)
        .length,
      shown: shownSources.length,
    },
    exampleAnswer: mentioned
      ? {
          prompt: mentioned.prompt,
          provider: mentioned.provider,
          answer: mentioned.raw_answer,
          citations: (mentioned.citations ?? []).slice(0, 5),
        }
      : null,
    citationPreview: citations[0]
      ? {
          url: citations[0].url,
          title: null,
          domain: citations[0].domain ?? null,
        }
      : null,
    recommendation: recommendation
      ? {
          title: reportText(recommendation.title),
          explanation: reportText(recommendation.explanation),
          reason:
            typeof recommendation.evidence?.summary === "string"
              ? recommendation.evidence.summary
              : null,
          priority: recommendation.priority,
          sources: reportSources(recommendation.evidence.supporting_evidence),
        }
      : null,
    premiumTeasers: {
      citationGaps: queries.filter((row) => (row.citations?.length ?? 0) === 0)
        .length,
      competitorOutranks: hits.filter((hit) => !hit.mentioned).length,
      outdatedClaims: 0,
      priorityActions: Math.max(audit.recommendations.length - 1, 0),
    },
    locked: true,
  };
}
