import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { openaiSearchProvider } from "@/lib/ai/providers/openai";

describe("openai provider", () => {
  const originalKey = process.env.OPENAI_API_KEY;
  const originalForce = process.env.FORCE_DEMO_MODE;

  beforeEach(() => {
    process.env.FORCE_DEMO_MODE = "true";
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    process.env.OPENAI_API_KEY = originalKey;
    process.env.FORCE_DEMO_MODE = originalForce;
    vi.restoreAllMocks();
  });

  it("returns labelled demo fixtures when key missing", async () => {
    const result = await openaiSearchProvider.runQuery({
      query: "What are the best analytics tools for startups?",
    });
    expect(result.provider).toBe("openai");
    expect(result.isDemo).toBe(true);
    expect(result.rawAnswer.startsWith("[DEMO MODE]")).toBe(true);
    expect(result.error).toBeNull();
  });
});
