import { describe, expect, it } from "vitest";
import { SCORE_DISPLAY_MAX, scoreFillPercent } from "@/lib/scores/format";

describe("scoreFillPercent", () => {
  it("leaves a normal score alone", () => {
    expect(scoreFillPercent(42)).toBe(42);
  });

  it("clamps above the display max", () => {
    expect(scoreFillPercent(SCORE_DISPLAY_MAX + 20)).toBe(SCORE_DISPLAY_MAX);
  });

  it("clamps below zero and rejects non-finite values", () => {
    expect(scoreFillPercent(-4)).toBe(0);
    expect(scoreFillPercent(Number.NaN)).toBe(0);
    expect(scoreFillPercent(Number.POSITIVE_INFINITY)).toBe(0);
  });
});
