export type ReportSource = { label: string; url: string | null; excerpt: string | null };
export type ReportAnswerEvidence = {
  question: string | null;
  provider: string | null;
  excerpt: string;
  sourceUrls: string[];
};

function text(value: unknown): string | null {
  return typeof value === "string" ? value.trim() || null : null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/** Audit data can contain model-suggested links. Only expose web URLs. */
export function reportSourceUrl(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? raw : null;
  } catch {
    return null;
  }
}

export function reportSources(value: unknown): ReportSource[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const source = record(item);
    return {
      label: text(source.page_title) ?? text(source.title) ?? text(source.label) ?? "Source page",
      url: reportSourceUrl(source.url),
      excerpt: text(source.excerpt) ?? text(source.snippet),
    };
  }).filter((source) => source.url || source.excerpt);
}

/** Link to the saved words on the original page; the plain page URL remains available. */
export function passageUrl(source: ReportSource): string | null {
  const url = reportSourceUrl(source.url);
  const passage = source.excerpt?.replace(/(?:\.{3}|…)\s*$/, "").trim();
  if (!url || !passage) return null;
  const target = new URL(url);
  target.hash = `${target.hash.slice(1).split(":~:")[0]}:~:text=${encodeURIComponent(passage).replace(/-/g, "%2D")}`;
  return target.href;
}

/** Carry only the evidence a public reader can inspect, without inventing URLs. */
export function competitorEvidence(value: unknown) {
  const competitor = record(value);
  const rawAnswers = Array.isArray(competitor.answer_evidence) ? competitor.answer_evidence : [];
  const answers: ReportAnswerEvidence[] = rawAnswers.flatMap((item) => {
    const answer = record(item);
    const excerpt = text(answer.answer_excerpt);
    if (!excerpt) return [];
    const urls = Array.isArray(answer.source_urls) ? answer.source_urls : [];
    return [{
      question: text(answer.question),
      provider: text(answer.provider),
      excerpt,
      sourceUrls: [...new Set(urls.map(reportSourceUrl).filter((url): url is string => Boolean(url)))],
    }];
  });
  const pages = [
    ...reportSources(competitor.website_evidence),
    ...reportSources(competitor.verified_mentions),
  ];
  const sourceUrl = answers.flatMap((answer) => answer.sourceUrls)[0]
    ?? pages.find((page) => page.url)?.url ?? null;
  const evidenceStatus = competitor.evidence_status !== "answer_only_unverified" && pages.some((page) => page.url && page.excerpt)
    ? "verified" as const
    : sourceUrl ? "cited" as const : "answer_only_unverified" as const;
  return { answers, pages, sourceUrl, evidenceStatus };
}
