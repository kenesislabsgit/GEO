import { describe, expect, it } from "vitest";
import { auditCoverage } from "@/lib/audit/coverage";
import type { QueryResult, ScanQuestion, ScanRun } from "@/types/database";

const scan = {
  status: "partial",
  total_queries: 21,
  provider_ids: ["openai_search"],
  input_snapshot: {
    question_count: 20,
    assistants: ["openai_search", "claude", "gemini", "perplexity", "mistral"],
  },
} as ScanRun;
const questions = Array.from({ length: 20 }, (_, position) => ({
  position,
  prompt: `Question ${position}`,
})) as ScanQuestion[];
const answers = Array.from({ length: 20 }, (_, question_position) => ({
  id: `answer-${question_position}`,
  question_position,
  raw_answer: "Saved answer",
  error: null,
})) as QueryResult[];

describe("saved audit coverage", () => {
  it("does not call a partial five-provider audit complete because its stored counter is 21", () => {
    const result = auditCoverage(
      scan,
      [
        ...answers,
        {
          id: "failed",
          question_position: 0,
          error: "Provider unavailable",
        } as QueryResult,
      ],
      questions,
    );
    expect(result).toMatchObject({
      questions: 20,
      testedQuestions: 20,
      requested: 100,
      successful: 20,
      failed: 1,
      missing: 79,
    });
  });
  it("counts each legacy tracked question once across providers", () => {
    const rows = ["one", "two"].flatMap((tracked_prompt_id) =>
      ["openai_search", "claude"].map(
        (provider) =>
          ({
            id: `${tracked_prompt_id}-${provider}`,
            tracked_prompt_id,
            provider,
            raw_answer: "Answer",
            error: null,
          }) as QueryResult,
      ),
    );
    expect(
      auditCoverage(
        {
          ...scan,
          total_queries: 4,
          input_snapshot: null,
          provider_ids: ["openai_search", "claude"],
        },
        rows,
      ),
    ).toMatchObject({
      questions: 2,
      testedQuestions: 2,
      requested: 4,
      successful: 4,
      failed: 0,
      missing: 0,
    });
  });
  it("distinguishes an empty response from a recorded provider failure", () => {
    expect(
      auditCoverage(
        {
          ...scan,
          total_queries: 2,
          input_snapshot: null,
          provider_ids: ["openai_search"],
        },
        [
          { id: "a", question_position: 0, raw_answer: "", error: null },
          { id: "b", question_position: 1, raw_answer: "", error: "Timeout" },
        ] as QueryResult[],
      ),
    ).toMatchObject({
      successful: 0,
      failed: 1,
      missing: 1,
      testedQuestions: 0,
    });
  });
});
