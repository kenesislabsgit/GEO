import { describe, expect, it } from "vitest";
import {
  findDuplicatePrompt,
  normalizePromptText,
  promptTextsAreDuplicate,
} from "@/lib/prompts/normalize";

describe("prompt normalization", () => {
  it("normalizes case and whitespace", () => {
    expect(normalizePromptText("  What   Are   The   Best  Tools? ")).toBe(
      "what are the best tools?",
    );
  });

  it("detects exact duplicates after normalization", () => {
    expect(
      promptTextsAreDuplicate(
        "What are the best CRM tools?",
        "  what   are the best crm tools?  ",
      ),
    ).toBe(true);
  });

  it("detects near-identical prompts", () => {
    expect(
      promptTextsAreDuplicate(
        "What are the best CRM tools for startups today",
        "what are the best crm tools for startups",
      ),
    ).toBe(true);
  });

  it("finds duplicate among existing prompts", () => {
    const match = findDuplicatePrompt("Best CRM for teams", [
      { id: "1", prompt: "best crm for teams" },
      { id: "2", prompt: "totally different question" },
    ]);
    expect(match?.id).toBe("1");
  });
});
