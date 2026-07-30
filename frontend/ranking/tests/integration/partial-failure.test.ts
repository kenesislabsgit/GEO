import { describe, expect, it } from "vitest";
import { aggregateScanScores } from "@/lib/ai/scoring/score";

describe("partial provider failures", () => {
  it("still aggregates successful query analyses", () => {
    const result = aggregateScanScores(
      [
        {
          brandMentioned: true,
          brandPosition: 1,
          brandSentiment: "positive",
          citationSupportingBrand: true,
          recommendedBrands: [{ name: "Acme", position: 1 }],
        },
        // failed provider produces empty analysis equivalent
        {
          brandMentioned: false,
          brandPosition: null,
          brandSentiment: null,
          citationSupportingBrand: false,
          recommendedBrands: [],
        },
      ],
      "Acme",
    );
    expect(result.overallScore).toBeGreaterThan(0);
    expect(result.mentionRate).toBe(0.5);
  });
});
