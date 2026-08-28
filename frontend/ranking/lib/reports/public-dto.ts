import type {
  Brand,
  QueryResult,
  Recommendation,
  ScanRun,
  ScoreSnapshot,
  TrackedPrompt,
} from "@/types/database";
import { roundForDisplay, scoreBreakdownParts } from "@/lib/scores/format";
import { canonicalCompanyKey } from "@/lib/utils/company-name";

function safeHost(url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.startsWith("www.") ? host.slice(4) : host;
  } catch {
    return url;
  }
}

export type PublicReportDTO = {
  brand: {
    name: string;
    slug: string;
    domain: string;
    category: string | null;
    description: string | null;
  };
  scan: {
    id: string;
    status: string;
    createdAt: string;
    completedAt: string | null;
    methodologyVersion: string;
    demoMode: boolean;
    providerIds: string[];
    promptCount: number;
    confidence: "low" | "standard";
  };
  score: {
    overall: number;
    mentionRate: number;
    averagePosition: number | null;
    shareOfVoice: number;
    mentionScore: number | null;
    positionScore: number | null;
    evidenceQuality: number | null;
  };
  promptMatrix: Array<{
    prompt: string;
    promptType: string;
    mentioned: boolean;
    /** Where the brand ranked in the answer, when it was recommended. */
    position: number | null;
    /** Companies recommended ahead of the brand, in order. */
    beatenBy: string[];
  }>;
  topCompetitor: { name: string; mentions: number } | null;
  competitorPreview: Array<{
    name: string;
    mentions: number;
    averagePosition: number | null;
    evidenceStatus: "verified" | "answer_only_unverified";
  }>;
  /** The single competitor whose website was actually read. */
  investigatedCompetitor: {
    name: string;
    mentions: number;
    website: string | null;
    pages: Array<{ label: string; url: string | null; excerpt: string | null }>;
  } | null;
  /** Sources the AI cited, grouped by site. */
  sources: Array<{
    domain: string;
    url: string;
    title: string | null;
    citedInAnswers: number;
    mentionsBrand: boolean | null;
  }>;
  sourceSummary: { total: number; mentioningBrand: number; shown: number };
  exampleAnswer: {
    prompt: string;
    provider: string;
    answer: string;
    citations: Array<{ url: string; title: string | null; domain: string | null }>;
  } | null;
  citationPreview: {
    url: string;
    title: string | null;
    domain: string | null;
  } | null;
  recommendation: {
    title: string;
    explanation: string;
    reason: string | null;
    priority: number;
  } | null;
  premiumTeasers: {
    citationGaps: number;
    competitorOutranks: number;
    outdatedClaims: number;
    priorityActions: number;
  };
  locked: true;
};

export function toPublicReportDTO(input: {
  brand: Brand;
  scan: ScanRun;
  score: ScoreSnapshot | null;
  prompts: TrackedPrompt[];
  results: QueryResult[];
  recommendations: Recommendation[];
}): PublicReportDTO {
  const testedPromptIds = new Set(
    input.results
      .map((result) => result.tracked_prompt_id)
      .filter((id): id is string => Boolean(id)),
  );
  const promptMatrix = input.prompts
    .filter((prompt) => testedPromptIds.has(prompt.id))
    .map((prompt) => {
      const matches = input.results.filter(
        (r) => r.tracked_prompt_id === prompt.id,
      );
      const mentioned = matches.some((m) => m.brand_mentioned);
      const positions = matches
        .map((m) => m.brand_position)
        .filter((p): p is number => typeof p === "number" && p > 0);
      const position = positions.length ? Math.min(...positions) : null;

      // Who the AI put ahead of this brand. When the brand was not recommended
      // at all, that is simply the top of the answer's list.
      const ranked = matches
        .flatMap(
          (m) =>
            (m.recommended_brands as Array<{
              name?: string;
              position?: number;
            }>) ?? [],
        )
        .filter((item) => Boolean(item?.name))
        .sort((a, b) => (a.position ?? 99) - (b.position ?? 99));
      const beatenBy: string[] = [];
      // Deduped on the canonical key: one company that two providers named
      // differently ("Kenesis", "Kenesis Labs") must not fill two of these
      // three slots.
      const beatenByKeys = new Set<string>();
      for (const item of ranked) {
        const name = String(item.name);
        if (position !== null && (item.position ?? 99) >= position) break;
        const key = canonicalCompanyKey(name);
        if (key && !beatenByKeys.has(key)) {
          beatenByKeys.add(key);
          beatenBy.push(name);
        }
        if (beatenBy.length === 3) break;
      }

      return {
        prompt: prompt.prompt,
        promptType: prompt.prompt_type,
        mentioned,
        position,
        beatenBy,
      };
    });

  const competitors = ((input.score?.competitor_scores as Array<{
    name: string;
    mentions: number;
    average_rank?: number | null;
    official_website?: string | null;
    answer_evidence?: Array<{ answer_excerpt?: string; source_urls?: string[] }>;
    website_evidence?: Array<{
      label?: string;
      excerpt?: string | null;
      url?: string | null;
      page_title?: string | null;
    }>;
    verified_mentions?: unknown[];
    evidence_status?: string;
  }>) ?? []).filter((competitor) => {
    const answers = competitor.answer_evidence ?? [];
    return (
      answers.some((item) => Boolean(item.answer_excerpt?.trim())) &&
      (competitor.evidence_status === "answer_only_unverified" ||
        (competitor.website_evidence?.length ?? 0) > 0 ||
        (competitor.verified_mentions?.length ?? 0) > 0 ||
        answers.some((item) => (item.source_urls?.length ?? 0) > 0))
    );
  });
  const topCompetitor = competitors[0]
    ? { name: competitors[0].name, mentions: competitors[0].mentions }
    : null;
  const competitorPreview = competitors.slice(0, 5).map((competitor) => ({
    name: competitor.name,
    mentions: competitor.mentions,
    averagePosition:
      typeof competitor.average_rank === "number"
        ? roundForDisplay(competitor.average_rank)
        : null,
    evidenceStatus:
      competitor.evidence_status === "answer_only_unverified"
        ? ("answer_only_unverified" as const)
        : ("verified" as const),
  }));

  // The free audit reads one competitor's website. That is the competitor whose
  // pages we can quote, and the one the recommended action is built on.
  const investigated = competitors.find(
    (competitor) => (competitor.website_evidence?.length ?? 0) > 0,
  );
  const investigatedCompetitor = investigated
    ? {
        name: investigated.name,
        mentions: investigated.mentions,
        website: investigated.official_website ?? null,
        pages: (investigated.website_evidence ?? [])
          .filter((page) => Boolean(page?.excerpt || page?.url))
          // Pages we actually read carry text; lead with those, since a bare
          // link says nothing to the reader.
          .sort(
            (a, b) =>
              Number(Boolean(b.excerpt?.trim())) -
              Number(Boolean(a.excerpt?.trim())),
          )
          .slice(0, 4)
          .map((page) => ({
            label: String(page.label ?? page.page_title ?? "Page"),
            url: page.url ?? null,
            excerpt: page.excerpt ?? null,
          })),
      }
    : null;

  const mentionedResult =
    input.results.find((r) => r.brand_mentioned && r.raw_answer) ??
    input.results.find((r) => r.raw_answer);
  const promptForExample = input.prompts.find(
    (p) => p.id === mentionedResult?.tracked_prompt_id,
  );

  const citations = (mentionedResult?.citations as Array<{
    url: string;
    title: string | null;
    domain: string | null;
  }>) ?? [];

  const allCitations = input.results.flatMap(
    (r) =>
      (r.citations as Array<{
        url: string;
        title?: string | null;
        domain?: string | null;
        citedForBrand?: boolean;
      }>) ?? [],
  );
  // One row per cited page, with how many answers leaned on it and whether the
  // page names the brand at all. `citedForBrand` is set when the page was
  // fetched and checked; null means it could not be checked.
  const sourceRows = new Map<
    string,
    {
      domain: string;
      url: string;
      title: string | null;
      citedInAnswers: number;
      mentionsBrand: boolean | null;
    }
  >();
  for (const citation of allCitations) {
    const url = String(citation?.url ?? "").trim();
    if (!url) continue;
    const existing = sourceRows.get(url);
    if (existing) {
      existing.citedInAnswers += 1;
      if (existing.mentionsBrand !== true && citation.citedForBrand === true) {
        existing.mentionsBrand = true;
      }
      continue;
    }
    sourceRows.set(url, {
      domain: citation.domain ?? safeHost(url),
      url,
      title: citation.title ?? null,
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

  const citationGaps = input.results.filter((result) => {
    const resultCitations = (result.citations as unknown[]) ?? [];
    return resultCitations.length === 0;
  }).length;
  const hasVerifiedEvidence =
    allCitations.length > 0 ||
    competitors.some(
      (competitor) => competitor.evidence_status !== "answer_only_unverified",
    );

  const competitorOutranks = input.results.filter((r) => {
    if (r.brand_mentioned && (r.brand_position ?? 99) === 1) return false;
    const recs = (r.recommended_brands as Array<{ name: string; position: number }>) ?? [];
    return recs.some((rec) => rec.position === 1);
  }).length;

  const outdatedClaims = input.results.reduce((sum, r) => {
    const claims = (r.claims as Array<{ potentiallyOutdated?: boolean }>) ?? [];
    return sum + claims.filter((c) => c.potentiallyOutdated).length;
  }, 0);

  const firstRec = input.recommendations[0];
  const firstRecEvidence =
    firstRec?.evidence &&
    typeof firstRec.evidence === "object" &&
    !Array.isArray(firstRec.evidence)
      ? (firstRec.evidence as Record<string, unknown>)
      : null;
  const recommendationReason =
    typeof firstRecEvidence?.summary === "string"
      ? firstRecEvidence.summary
      : null;

  const parts = scoreBreakdownParts(input.score ?? {});

  return {
    brand: {
      name: input.brand.name,
      slug: input.brand.slug,
      domain: input.brand.canonical_domain,
      category: input.brand.category,
      description: input.brand.description,
    },
    scan: {
      id: input.scan.id,
      status: input.scan.status,
      createdAt: input.scan.created_at,
      completedAt: input.scan.completed_at,
      methodologyVersion: input.scan.methodology_version,
      demoMode: input.scan.demo_mode,
      providerIds: input.scan.provider_ids,
      promptCount: promptMatrix.length,
      confidence: hasVerifiedEvidence ? "standard" : "low",
    },
    score: {
      overall: roundForDisplay(Number(input.score?.overall_score ?? 0)),
      mentionRate: roundForDisplay(
        Number(input.score?.mention_rate ?? 0) * 100,
      ),
      averagePosition: input.score?.average_position
        ? roundForDisplay(Number(input.score.average_position))
        : null,
      shareOfVoice: roundForDisplay(
        Number(input.score?.share_of_voice ?? 0) * 100,
      ),
      mentionScore: parts.mention,
      positionScore: parts.position,
      evidenceQuality: parts.evidence,
    },
    promptMatrix,
    topCompetitor,
    competitorPreview,
    investigatedCompetitor,
    sources: shownSources,
    sourceSummary: {
      total: sortedSources.length,
      mentioningBrand: sortedSources.filter((s) => s.mentionsBrand === true)
        .length,
      shown: shownSources.length,
    },
    exampleAnswer: mentionedResult
      ? {
          prompt: promptForExample?.prompt ?? "Sample prompt",
          provider: mentionedResult.provider,
          answer: mentionedResult.raw_answer,
          citations: citations.slice(0, 5),
        }
      : null,
    citationPreview: citations[0]
      ? {
          url: citations[0].url,
          title: citations[0].title,
          domain: citations[0].domain,
        }
      : null,
    recommendation: firstRec
      ? {
          title: firstRec.title,
          explanation: firstRec.explanation,
          reason: recommendationReason,
          priority: firstRec.priority,
        }
      : null,
    premiumTeasers: {
      citationGaps,
      competitorOutranks,
      outdatedClaims,
      priorityActions: Math.max(input.recommendations.length - 1, 0),
    },
    locked: true,
  };
}
