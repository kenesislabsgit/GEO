import { describe, expect, it } from "vitest";
import { HERO_FLIP_WORDS } from "@/components/site/hero-word-flip";

describe("HERO_FLIP_WORDS", () => {
  it("starts with brand and cycles unique lowercase nouns", () => {
    expect(HERO_FLIP_WORDS[0]).toBe("brand");
    expect(new Set(HERO_FLIP_WORDS).size).toBe(HERO_FLIP_WORDS.length);
    expect(HERO_FLIP_WORDS).toEqual(
      HERO_FLIP_WORDS.map((word) => word.toLowerCase()),
    );
  });
});
