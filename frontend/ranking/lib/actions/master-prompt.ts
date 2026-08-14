import type { Brand, Recommendation, ScoreSnapshot } from "@/types/database";
import { meaningfulGaps, parseEvidence } from "@/lib/actions/evidence";

/**
 * One prompt that carries the whole audit into an AI coding tool. The person
 * pastes it into Cursor, Claude Code, Windsurf or similar, pointed at their
 * website's codebase, and the tool implements the audit's fixes with the
 * evidence in front of it. Everything in here is already visible on the
 * Website Improvements page - this is a rewording, not a data leak.
 */
export function buildMasterPrompt(input: {
  brand: Brand;
  recommendations: Recommendation[];
  latestScore: ScoreSnapshot | null;
}): string {
  const { brand, recommendations, latestScore } = input;
  const lines: string[] = [];

  lines.push(
    `You are an expert working inside the codebase of ${brand.name}'s website` +
      (brand.canonical_domain ? ` (${brand.canonical_domain})` : "") +
      `. Implement the fixes below, which come from an AI-visibility audit of the site.`,
  );
  lines.push("");
  lines.push("## Why these fixes matter");
  lines.push(
    "AI assistants (ChatGPT, Claude, Gemini and others) were asked real buyer questions " +
      "in this company's market. Each fix below addresses a question where the AI recommended " +
      "a competitor instead of this company, backed by evidence read from the competitors' websites.",
  );
  if (latestScore?.overall_score != null) {
    lines.push(
      `Current AI visibility score: ${Math.round(Number(latestScore.overall_score))}/100.`,
    );
  }
  lines.push("");

  lines.push("## About the company");
  lines.push(`- Name: ${brand.name}`);
  if (brand.canonical_domain) lines.push(`- Website: ${brand.canonical_domain}`);
  if (brand.category) lines.push(`- Category: ${brand.category}`);
  if (brand.target_audience) lines.push(`- Target audience: ${brand.target_audience}`);
  if (brand.description) lines.push(`- Description: ${brand.description}`);
  lines.push("");

  lines.push("## How to work");
  lines.push("1. Work through the fixes in order - they are sorted by priority.");
  lines.push(
    "2. For each fix, find the right place in the site (page, section, component) and make the change. " +
      "Write real, specific content - never lorem ipsum or placeholders.",
  );
  lines.push(
    "3. Match the site's existing tone, design system and stack. Do not restructure unrelated code.",
  );
  lines.push(
    "4. Content the AI assistants could not find must become findable: plain HTML text on a crawlable page, " +
      "not hidden behind scripts, logins or images.",
  );
  lines.push(
    "5. When a fix cites competitor pages, study how they present the information, then write a stronger, " +
      "truthful version for this company. Never copy their text and never invent facts, numbers, customers " +
      "or integrations - if a fact is missing, leave a clearly marked TODO for the team instead.",
  );
  lines.push("6. After each fix, summarise what changed and in which files.");
  lines.push("");

  const sorted = recommendations.slice().sort((a, b) => a.priority - b.priority);
  sorted.forEach((action, index) => {
    const evidence = parseEvidence(action.evidence);
    lines.push(`## Fix ${index + 1}: ${action.title}`);
    lines.push(`Change to make: ${action.explanation}`);
    if (action.estimated_impact) {
      lines.push(`Expected impact: ${action.estimated_impact}`);
    }
    if (evidence.summary) {
      lines.push(`What the audit observed: ${evidence.summary}`);
    }

    if (evidence.affectedPrompts.length) {
      lines.push("Buyer questions currently lost to competitors:");
      for (const item of evidence.affectedPrompts.slice(0, 3)) {
        if (!item.prompt) continue;
        let line = `- "${item.prompt}"`;
        const winner = item.winners?.[0];
        if (winner?.company_name) {
          line += ` - the AI recommended ${winner.company_name}`;
          if (winner.rank) line += ` (#${winner.rank})`;
          if (winner.reason) line += ` because: ${winner.reason}`;
        } else if (item.recommended_instead?.length) {
          line += ` - the AI recommended ${item.recommended_instead.slice(0, 3).join(", ")} instead`;
        }
        lines.push(line);
      }
    }

    const gaps = meaningfulGaps(evidence.competitorGaps);
    if (gaps.length) {
      lines.push("Competitor patterns behind this fix:");
      for (const gap of gaps) {
        let line = `- ${gap.competitors_with_pattern} of ${gap.competitors_checked} recommended competitors have ${gap.pattern?.toLowerCase() ?? "this"}`;
        if (gap.example_competitors?.length) {
          line += ` (e.g. ${gap.example_competitors.slice(0, 3).join(", ")})`;
        }
        if (gap.user_status) line += `; this site: ${gap.user_status.toLowerCase()}`;
        lines.push(line);
      }
    }

    const relevantSources =
      evidence.validationMode === "catalog_ids" ? evidence.sources : [];
    const linkedSources = relevantSources.filter((source) => source.url);
    if (linkedSources.length) {
      lines.push("Competitor pages worth studying (for approach, not copying):");
      for (const source of linkedSources.slice(0, 3)) {
        const label = [source.company_name, source.page_title || source.label || source.title]
          .filter(Boolean)
          .join(" - ");
        lines.push(`- ${label ? `${label}: ` : ""}${source.url}`);
      }
    }
    lines.push("");
  });

  lines.push("## When you are done");
  lines.push(
    "List every page and file you changed, each fix you completed, and any TODOs you left for " +
      "facts only the team can supply.",
  );

  return lines.join("\n");
}
