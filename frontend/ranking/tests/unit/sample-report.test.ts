import { describe, expect, it } from "vitest";
import audit from "@/lib/reports/data/sample-audit.json";
import {
  loadSampleQuestions,
  loadSampleReport,
} from "@/lib/reports/sample-report";
import { roundForDisplay } from "@/lib/scores/format";

describe("sample audit provenance", () => {
  it("contains a successful real answer for every live provider/question pair", () => {
    expect(audit.scan.status).toBe("completed");
    expect(audit.scan.partial_providers).toEqual([]);
    expect(audit.prompt_matrix).toHaveLength(20);
    expect(audit.query_results).toHaveLength(80);
    expect(audit.scan.provider_ids).toEqual([
      "bedrock_claude",
      "bedrock_mistral",
      "gemini",
      "openai_search",
    ]);
    for (const provider of audit.scan.provider_ids) {
      const rows = audit.query_results.filter(
        (row) => row.provider === provider,
      );
      expect(rows).toHaveLength(20);
      expect(new Set(rows.map((row) => row.prompt_index)).size).toBe(20);
      expect(
        rows.every((row) => row.raw_answer.trim() && !row.parse_error),
      ).toBe(true);
    }
  });

  it("preserves the engine's real score and excludes all simulated examples", () => {
    const report = loadSampleReport();
    const questions = loadSampleQuestions();
    const examples = questions.flatMap((question) => question.answers);
    expect(examples).toHaveLength(100);
    expect(examples.filter((answer) => !answer.simulation)).toHaveLength(80);
    const simulations = examples.filter((answer) => answer.simulation);
    expect(simulations).toHaveLength(20);
    expect(
      simulations.every(
        (answer) =>
          answer.provider === "perplexity" &&
          answer.simulation?.sourceProvider === "openai_search" &&
          answer.citations.length === 0,
      ),
    ).toBe(true);
    expect(report.scan.providerIds).not.toContain("perplexity");
    expect(report.scan.sampling.answerCount).toBe(80);
    expect(report.scan.sampling.failedCount).toBe(0);
    expect(report.score).toEqual({
      overall: roundForDisplay(audit.score.overall_score),
      mentionRate: roundForDisplay(audit.score.mention_rate * 100),
      averagePosition:
        audit.score.average_position === null
          ? null
          : roundForDisplay(audit.score.average_position),
      shareOfVoice: roundForDisplay(audit.score.share_of_voice * 100),
    });
  });
});
