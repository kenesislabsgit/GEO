import { describe, expect, it } from "vitest";
import {
  canonicalUrl,
  dedupeByUrl,
  sourceLabel,
} from "@/lib/audit/source-links";

describe("source links", () => {
  it("keeps two pages on one site apart", () => {
    // Both were labelled "kenesis.ai" and read as the same page.
    expect(canonicalUrl("https://kenesis.ai/products")).not.toBe(
      canonicalUrl("https://kenesis.ai/platform"),
    );
    expect(sourceLabel({ url: "https://kenesis.ai/products" })).toBe(
      "kenesis.ai/products",
    );
  });

  it("never labels a page with its bare domain", () => {
    const label = sourceLabel({
      url: "https://g2.com/products/calendly/reviews",
      domain: "g2.com",
    });
    expect(label).toBe("g2.com/products/calendly/reviews");
  });

  it("prefers a real title when the page gave one", () => {
    expect(
      sourceLabel({ url: "https://g2.com/x", title: "Calendly Reviews" }),
    ).toBe("Calendly Reviews");
  });

  it("treats the same page reached two ways as one page", () => {
    const same = [
      "https://kenesis.ai/platform",
      "http://www.kenesis.ai/platform/",
      "https://kenesis.ai/platform#pricing",
      "https://kenesis.ai/platform?utm_source=chatgpt",
    ].map(canonicalUrl);
    expect(new Set(same).size).toBe(1);
  });

  it("keeps a parameter that selects the content", () => {
    expect(canonicalUrl("https://site.com/p?id=7")).not.toBe(
      canonicalUrl("https://site.com/p?id=8"),
    );
  });

  it("collapses repeats and counts them", () => {
    const rows = dedupeByUrl([
      { url: "https://kenesis.ai/platform" },
      { url: "https://www.kenesis.ai/platform/" },
      { url: "https://atomvision.ai/" },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0].duplicateCount).toBe(2);
  });

  it("keeps the order it was given", () => {
    const rows = dedupeByUrl([
      { url: "https://b.com/2" },
      { url: "https://a.com/1" },
    ]);
    expect(rows.map((row) => row.url)).toEqual([
      "https://b.com/2",
      "https://a.com/1",
    ]);
  });

  it("drops a row with no address rather than grouping them together", () => {
    expect(dedupeByUrl([{ url: "" }, { url: "  " }])).toHaveLength(0);
  });
});
