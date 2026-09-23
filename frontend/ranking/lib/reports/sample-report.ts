import audit from "@/lib/reports/data/sample-audit.json";
import type { PublicReportDTO } from "@/lib/reports/public-dto";
import { roundForDisplay } from "@/lib/scores/format";
import { competitorEvidence, reportSources } from "@/lib/reports/evidence";
import {
  categoryLabel,
  reportSampling,
  reportText,
} from "@/lib/reports/presentation";
import { providerDisplayName } from "@/lib/constants";
import { readableAnswer } from "@/lib/reports/answer-presentation";
import type { ExplorerQuestion } from "@/components/dashboard/answer-explorer";

/** Measured report data comes only from the saved live audit. */
export const SAMPLE_REPORT_SLUG = "sample";

type PromptRow = {
  prompt: string;
  prompt_type: string;
};

type QueryRow = {
  model: string;
  prompt: string;
  provider: string;
  raw_answer: string;
  brand_mentioned: boolean;
  brand_position: number | null;
  answer_summary?: string | null;
  parse_error?: string | null;
  recommended_brands?: Array<{
    name: string;
    position: number | null;
    reasonRecommended?: string;
  }>;
  citations?: Array<{
    url: string;
    title: string | null;
    domain: string | null;
    citedForBrand?: boolean | null;
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

function isBrandName(name: string, brand: string): boolean {
  const left = name.trim().toLowerCase();
  const right = brand.trim().toLowerCase();
  return left === right || left.startsWith(`${right} `);
}

function brandHit(row: PromptRow, queries: QueryRow[], brand: string) {
  const answers = queries.filter(
    (query) => query.prompt === row.prompt && !query.parse_error,
  );
  const positions = answers.flatMap((query) =>
    query.brand_mentioned && query.brand_position ? [query.brand_position] : [],
  );
  const position = positions.length ? Math.min(...positions) : null;
  return {
    mentioned: answers.some((query) => query.brand_mentioned),
    position,
    ahead: [
      ...new Set(
        answers.flatMap((query) =>
          (query.recommended_brands ?? [])
            .filter(
              (item) =>
                !isBrandName(item.name, brand) &&
                (position === null || (item.position ?? 99) < position),
            )
            .map((item) => item.name),
        ),
      ),
    ].slice(0, 3),
  };
}

function hostOf(url: string, domain?: string | null): string {
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
  const hits = prompts.map((row) => brandHit(row, queries, brandName));
  const rivals = competitors.filter((row) => !isBrandName(row.name, brandName));
  const mentioned = queries.find((row) => row.brand_mentioned) ?? null;
  const investigated = evidence.find((row) => row.website_evidence) ?? null;

  const sourceRows = new Map<string, PublicReportDTO["sources"][number]>();
  for (const citation of queries.flatMap((query) => query.citations ?? [])) {
    if (!citation.url) continue;
    const existing = sourceRows.get(citation.url);
    if (existing) {
      existing.citedInAnswers += 1;
      if (citation.citedForBrand) existing.mentionsBrand = true;
      continue;
    }
    sourceRows.set(citation.url, {
      domain: hostOf(citation.url, citation.domain),
      url: citation.url,
      title: citation.title,
      citedInAnswers: 1,
      mentionsBrand:
        typeof citation.citedForBrand === "boolean"
          ? citation.citedForBrand
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
      createdAt: audit.sample_metadata.started_at,
      completedAt: audit.generated_at,
      methodologyVersion: audit.scan.methodology_version,
      demoMode: false,
      providerIds: audit.scan.provider_ids,
      promptCount: prompts.length,
      confidence: citations.length > 0 ? "standard" : "low",
      sampling: {
        ...reportSampling(
          queries.map((row) => ({
            ...row,
            question: row.prompt,
            error: row.parse_error,
          })),
        ),
        timestampLabel: "Scan created",
        settings: audit.sample_metadata.sampling_settings,
      },
    },
    score: {
      overall: roundForDisplay(audit.score.overall_score),
      mentionRate: roundForDisplay(audit.score.mention_rate * 100),
      averagePosition:
        audit.score.average_position === null
          ? null
          : roundForDisplay(audit.score.average_position),
      shareOfVoice: roundForDisplay(audit.score.share_of_voice * 100),
    },
    promptMatrix: prompts.map((row, index) => ({
      prompt: row.prompt,
      promptType: categoryLabel(row.prompt_type),
      mentioned: hits[index].mentioned,
      position: hits[index].position,
      beatenBy: hits[index].ahead,
    })),
    topCompetitor: rivals[0]
      ? { name: rivals[0].name, mentions: rivals[0].mentions }
      : null,
    competitorPreview: rivals.slice(0, 5).map((row) => {
      const savedEvidence = competitorEvidence(
        audit.score.competitor_scores.find(
          (competitor) => competitor.name === row.name,
        ),
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
          answer: readableAnswer(mentioned.raw_answer, mentioned.answer_summary)
            .prose,
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

/** Simulation is added only to the demo viewer, after measured scores are read. */
export function loadSampleQuestions(): ExplorerQuestion[] {
  const queries = audit.query_results as QueryRow[];
  return audit.prompt_matrix.map((prompt, index) => {
    const answers = queries
      .filter((row) => row.prompt === prompt.prompt)
      .map((row) => ({
        id: `sample-${index}-${row.provider}`,
        provider: row.provider,
        assistantName: providerDisplayName(row.provider),
        mentioned: row.brand_mentioned,
        position: row.brand_position,
        answer: row.raw_answer,
        summary: row.answer_summary,
        error: row.parse_error,
        recommended: (row.recommended_brands ?? []).map((item) => ({
          name: item.name,
          position: item.position,
          reason: item.reasonRecommended ?? null,
        })),
        citations: (row.citations ?? []).map((citation) => ({
          url: citation.url,
          label: citation.title || citation.domain || citation.url,
        })),
      }));
    const source = answers.find(
      (answer) => answer.provider === "openai_search",
    );
    return {
      promptId: `sample-question-${index}`,
      question: prompt.prompt,
      promptType: categoryLabel(prompt.prompt_type),
      answers: source
        ? [
            ...answers,
            {
              ...source,
              id: `sample-${index}-perplexity-simulated`,
              provider: "perplexity",
              assistantName: "Perplexity",
              citations: [],
              simulation: { sourceProvider: source.provider },
            },
          ]
        : answers,
    };
  });
}
