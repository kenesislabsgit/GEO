import { describe, expect, it } from "vitest";
import {
  activeStageIndex,
  auditStages,
  describeAssistants,
  stageLabel,
} from "@/lib/audit/progress-copy";

// Every step the runner and the stream route can emit. If a step is added
// without being given a stage, the customer sees the audit jump backwards to
// "Reading your website" while it is really writing their action plan.
const RUNNER_STEPS = [
  "starting",
  "resume_free_audit",
  "crawl_user_site",
  "extract_user_evidence",
  "company_profile",
  "buyer_prompts",
  "provider_questions",
  "pattern_analysis",
  "web_presence",
  "competitor_evidence",
  "comparison",
  "improvement_recommendations",
  "final_report",
  "frontend_export",
  "frontend_import",
] as const;

describe("audit progress copy", () => {
  it("gives every runner step a stage on the Pro plan", () => {
    const stages = auditStages("pro");
    for (const step of RUNNER_STEPS) {
      expect(
        stages.some((stage) => stage.steps.includes(step)),
        `no Pro stage owns "${step}"`,
      ).toBe(true);
    }
  });

  it("gives every runner step a stage on the free plan", () => {
    // Free skips web presence, but a step it never emits still needs a home:
    // the same component renders both and an unowned step falls back to the
    // percentage, which is exactly the guessing this replaced.
    const stages = auditStages("free");
    for (const step of RUNNER_STEPS) {
      expect(
        stages.some((stage) => stage.steps.includes(step)),
        `no free stage owns "${step}"`,
      ).toBe(true);
    }
  });

  it("shows the free audit as the smaller piece of work it is", () => {
    expect(auditStages("free").length).toBeLessThan(auditStages("pro").length);
  });

  it("never names an assistant the run did not ask", () => {
    expect(describeAssistants(["openai_search"])).toBe("ChatGPT");
    expect(describeAssistants(["openai_search", "bedrock_claude"])).toBe(
      "ChatGPT and Claude",
    );
    expect(
      describeAssistants(["openai_search", "bedrock_claude", "bedrock_llama"]),
    ).toBe("ChatGPT, Claude and others");
    expect(describeAssistants(["grok", "deepseek"])).toBe("Grok and DeepSeek");
  });

  it("does not leak the infrastructure an assistant is served from", () => {
    const labels = auditStages("pro").map((stage) =>
      stageLabel(stage, ["openai_search", "bedrock_claude", "bedrock_mistral"]),
    );
    const shown = labels.join(" ").toLowerCase();
    for (const leak of ["bedrock", "openai", "firecrawl", "crawl", "api"]) {
      expect(shown, `"${leak}" reached the customer`).not.toContain(leak);
    }
  });

  it("frames web presence as AI knowledge rather than as a web search", () => {
    const stage = auditStages("pro").find((item) => item.id === "knowledge");
    expect(stage).toBeDefined();
    expect(stageLabel(stage!, [])).toBe(
      "Finding what the internet has taught AI about you",
    );
  });

  it("follows the step name rather than the percentage", () => {
    const stages = auditStages("pro");
    const knowledge = stages.findIndex((stage) => stage.id === "knowledge");
    // The bar sits at 72 for the whole web-presence pass. Reading the number
    // alone would leave the customer looking at "Counting who gets named".
    expect(activeStageIndex(stages, "web_presence", 72)).toBe(knowledge);
  });

  it("falls back to the percentage for a step it has not been taught", () => {
    const stages = auditStages("pro");
    const index = activeStageIndex(stages, "some_future_step", 83);
    expect(stages[index].id).toBe("rivals");
  });

  it("starts at the first stage before any event arrives", () => {
    expect(activeStageIndex(auditStages("free"), null, 0)).toBe(0);
  });
});
