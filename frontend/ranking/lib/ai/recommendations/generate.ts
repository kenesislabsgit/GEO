import type { AnswerAnalysis } from "@/lib/ai/schemas/analysis";
import type { Json, TrackedPrompt } from "@/types/database";

export type GeneratedAction = {
  title: string;
  explanation: string;
  evidence: Json;
  action_type: string;
  priority: number;
  estimated_impact: string;
  affected_prompts: string[];
  suggested_content_brief: Json | null;
  status: "open";
};

export function generateRecommendations(input: {
  brandName: string;
  prompts: TrackedPrompt[];
  analyses: Array<{ promptId: string | null; promptText: string; analysis: AnswerAnalysis }>;
  competitorScores: Array<{ name: string; mentions: number }>;
}): GeneratedAction[] {
  const actions: GeneratedAction[] = [];
  const missingMentions = input.analyses.filter((a) => !a.analysis.brandMentioned);
  const topCompetitor = input.competitorScores[0];

  if (missingMentions.length > 0) {
    const affected = missingMentions.map((m) => m.promptText).slice(0, 5);
    actions.push({
      title: "Create a missing comparison page",
      explanation: `${input.brandName} was absent from ${missingMentions.length} buyer prompts. A clear comparison page can give answer engines structured evidence for recommendation lists.`,
      evidence: affected.map((p) => ({ type: "prompt_miss", prompt: p })),
      action_type: "comparison_page",
      priority: 1,
      estimated_impact: "Directional improvement on comparison and alternatives prompts. Not a ranking guarantee.",
      affected_prompts: affected,
      suggested_content_brief: {
        pageType: "comparison",
        outline: [
          "Who the page is for",
          "Evaluation criteria",
          "Feature comparison table",
          "Pricing transparency",
          "Migration notes",
        ],
      },
      status: "open",
    });
  }

  const outdated = input.analyses.flatMap((a) =>
    a.analysis.factualClaims.filter((c) => c.potentiallyOutdated),
  );
  if (outdated.length > 0) {
    actions.push({
      title: "Update potentially outdated claims",
      explanation: `Found ${outdated.length} claims that may be outdated in AI answers. Refresh pricing, packaging, and product facts on owned pages.`,
      evidence: outdated.slice(0, 5),
      action_type: "update_outdated_content",
      priority: 2,
      estimated_impact: "Reduces inaccurate descriptions; may improve brand-accuracy monitoring.",
      affected_prompts: [],
      suggested_content_brief: null,
      status: "open",
    });
  }

  if (topCompetitor) {
    actions.push({
      title: `Publish an alternatives page versus ${topCompetitor.name}`,
      explanation: `${topCompetitor.name} appeared frequently in recommendation lists. An alternatives page with evidence can help answer engines cite your positioning.`,
      evidence: [{ competitor: topCompetitor.name, mentions: topCompetitor.mentions }],
      action_type: "alternatives_page",
      priority: 2,
      estimated_impact: "May improve share of voice on alternatives prompts. Not guaranteed.",
      affected_prompts: input.prompts
        .filter((p) => p.prompt_type === "alternatives" || p.buyer_stage === "alternatives")
        .map((p) => p.prompt),
      suggested_content_brief: {
        pageType: "alternatives",
        competitor: topCompetitor.name,
      },
      status: "open",
    });
  }

  const unsupported = input.analyses.flatMap((a) =>
    a.analysis.factualClaims.filter((c) => !c.supported),
  );
  if (unsupported.length > 0) {
    actions.push({
      title: "Add evidence for unsupported claims",
      explanation: "Some claims circulating in AI answers lack clear supporting sources. Publish primary evidence pages and structured data.",
      evidence: unsupported.slice(0, 5),
      action_type: "add_evidence",
      priority: 3,
      estimated_impact: "Improves citation quality and claim accuracy monitoring.",
      affected_prompts: [],
      suggested_content_brief: null,
      status: "open",
    });
  }

  actions.push({
    title: "Improve structured data on key pages",
    explanation: "Clear Organization/Product schema and consistent category language help retrieval systems understand what you sell.",
    evidence: [{ type: "methodology", note: "Structured data quality correlates with clearer entity matching." }],
    action_type: "structured_data",
    priority: 3,
    estimated_impact: "Supports entity clarity; does not guarantee recommendations.",
    affected_prompts: [],
    suggested_content_brief: {
      schemaTypes: ["Organization", "SoftwareApplication", "FAQPage"],
    },
    status: "open",
  });

  return actions.slice(0, 8);
}
