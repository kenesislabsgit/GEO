/**
 * The evidence JSON attached to a recommendation, parsed into a shape the
 * UI and the master prompt can both read. This used to live inside the
 * Website Improvements page; the copy-prompt feature needs the same parsing,
 * so it moved here rather than being written twice.
 */

export type SupportingEvidence = {
  evidence_id?: string;
  evidence_type?: string;
  company_name?: string;
  label?: string;
  excerpt?: string | null;
  title?: string;
  page_title?: string;
  url?: string | null;
  provenance?: string;
};

export type LossWinner = {
  company_name?: string;
  rank?: number | null;
  reason?: string;
};

export type AffectedPrompt = {
  loss_id?: string;
  prompt?: string;
  category?: string;
  recommended_instead?: string[];
  /** Who took the question and, in the assistant's words, why. */
  winners?: LossWinner[];
};

export type CompetitorGap = {
  pattern?: string;
  competitors_with_pattern?: number;
  competitors_checked?: number;
  user_status?: string;
  example_competitors?: string[];
};

export type ParsedEvidence = {
  summary: string | null;
  sources: SupportingEvidence[];
  validationMode: string | null;
  affectedPrompts: AffectedPrompt[];
  competitorGaps: CompetitorGap[];
};

export function evidenceText(value: unknown, depth = 0): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (!value || depth > 2) return null;

  if (Array.isArray(value)) {
    const items = value
      .slice(0, 3)
      .map((item) => evidenceText(item, depth + 1))
      .filter((item): item is string => Boolean(item));
    return items.length ? items.join("; ") : null;
  }

  if (typeof value === "object") {
    const items = Object.entries(value)
      .slice(0, 4)
      .map(([key, item]) => {
        const detail = evidenceText(item, depth + 1);
        if (!detail) return null;
        const label = key.replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase());
        return `${label}: ${detail}`;
      })
      .filter((item): item is string => Boolean(item));
    return items.length ? items.join(" | ") : null;
  }

  return null;
}

/**
 * A "pattern" needs more than one competitor behind it. A free audit reads one
 * website, so this box could only ever say "1 of 1", which reads like every
 * competitor does something when exactly one was looked at.
 */
export const MIN_COMPETITORS_FOR_A_PATTERN = 3;

export function meaningfulGaps(gaps: CompetitorGap[]): CompetitorGap[] {
  return gaps.filter(
    (gap) => (gap.competitors_checked ?? 0) >= MIN_COMPETITORS_FOR_A_PATTERN,
  );
}

export function parseEvidence(value: unknown): ParsedEvidence {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      summary: evidenceText(value),
      sources: [],
      validationMode: null,
      affectedPrompts: [],
      competitorGaps: [],
    };
  }

  const record = value as Record<string, unknown>;
  const sources = Array.isArray(record.supporting_evidence)
    ? record.supporting_evidence.filter(
        (item): item is SupportingEvidence =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item),
      )
    : [];
  const affectedPrompts = Array.isArray(record.affected_prompts)
    ? record.affected_prompts.filter(
        (item): item is AffectedPrompt =>
          Boolean(item) &&
          typeof item === "object" &&
          !Array.isArray(item) &&
          typeof (item as AffectedPrompt).prompt === "string",
      )
    : [];
  return {
    summary: evidenceText(record.summary),
    sources,
    validationMode:
      typeof record.validation_mode === "string" ? record.validation_mode : null,
    affectedPrompts,
    competitorGaps: Array.isArray(record.competitor_gaps)
      ? record.competitor_gaps.filter(
          (item): item is CompetitorGap =>
            Boolean(item) && typeof item === "object" && !Array.isArray(item),
        )
      : [],
  };
}
