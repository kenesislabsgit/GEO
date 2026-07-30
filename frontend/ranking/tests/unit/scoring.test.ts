import { describe, expect, it } from "vitest";
import { aggregateScanScores, scoreQuery } from "@/lib/ai/scoring/score";
import { findMatchedAlias, buildAliasSet } from "@/lib/ai/matching/aliases";

describe("scoring", () => {
  it("scores absent brands as zero", () => {
    const score = scoreQuery({
      brandMentioned: false,
      brandPosition: null,
      brandSentiment: null,
      citationSupportingBrand: false,
      recommendedBrands: [],
    });
    expect(score.overall).toBe(0);
  });

  it("scores first-position brands highly", () => {
    const score = scoreQuery({
      brandMentioned: true,
      brandPosition: 1,
      brandSentiment: "positive",
      citationSupportingBrand: true,
      recommendedBrands: [{ name: "Acme", position: 1 }],
    });
    expect(score.mentionValue).toBe(100);
    expect(score.positionValue).toBe(100);
    expect(score.citationValue).toBe(100);
    expect(score.sentimentValue).toBe(100);
    expect(score.overall).toBe(100);
  });

  it("handles empty scans", () => {
    const aggregate = aggregateScanScores([], "Acme");
    expect(aggregate.overallScore).toBe(0);
    expect(aggregate.mentionRate).toBe(0);
    expect(aggregate.averagePosition).toBeNull();
  });

  it("aggregates partial provider failure style inputs", () => {
    const aggregate = aggregateScanScores(
      [
        {
          brandMentioned: true,
          brandPosition: 2,
          brandSentiment: "neutral",
          citationSupportingBrand: false,
          recommendedBrands: [
            { name: "Acme", position: 2 },
            { name: "Rival", position: 1 },
          ],
        },
        {
          brandMentioned: false,
          brandPosition: null,
          brandSentiment: null,
          citationSupportingBrand: false,
          recommendedBrands: [{ name: "Rival", position: 1 }],
        },
      ],
      "Acme",
    );
    expect(aggregate.mentionRate).toBe(0.5);
    expect(aggregate.competitorScores[0]?.name).toBe("rival");
  });
});

describe("alias matching", () => {
  it("matches aliases deterministically", () => {
    const aliases = buildAliasSet({
      name: "Acme Analytics",
      domain: "acme.com",
      aliases: ["Acme"],
    });
    expect(findMatchedAlias("We recommend Acme for teams", aliases)).toBe(
      "acme",
    );
    expect(findMatchedAlias("No relevant vendors listed", aliases)).toBeNull();
  });
});
