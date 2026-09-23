import { describe, expect, it } from "vitest";
import audit from "@/tests/fixtures/free-audit-export.json";
import sampleAudit from "@/lib/reports/data/sample-audit.json";
import { loadSampleReport } from "@/lib/reports/sample-report";
import { toPublicReportDTO } from "@/lib/reports/public-dto";
import { competitorEvidence, passageUrl, reportSources } from "@/lib/reports/evidence";

describe("public report evidence", () => {
  it("keeps each sample competitor's exact cited source and saved answer", () => {
    const report = loadSampleReport();
    for (const competitor of report.competitorPreview) {
      const saved = sampleAudit.score.competitor_scores.find(row => row.name === competitor.name)!;
      const savedUrls = [
        ...saved.answer_evidence.flatMap((answer) => answer.source_urls),
        ...saved.website_evidence.map((page) => page.url),
        ...saved.verified_mentions.map((page: { url: string }) => page.url),
      ];
      expect(savedUrls).toContain(competitor.evidence.sourceUrl);
      expect(competitor.evidence.answers[0].excerpt).toBe(saved.answer_evidence[0].answer_excerpt);
      expect(competitor.evidence.answers[0].question).toBe(saved.answer_evidence[0].question);
    }
    expect(report.competitorPreview.length).toBeGreaterThan(0);
    expect(report.competitorPreview.some(row => row.name.startsWith("Stripe"))).toBe(false);
  });

  it("preserves the historical report's accepted source passages", () => {
    const live = toPublicReportDTO({
      brand: { name: "Stripe", slug: "stripe", canonical_domain: "stripe.com" },
      scan: { provider_ids: ["openai_search"] },
      score: audit.score,
      prompts: [],
      results: [],
      recommendations: audit.recommendations,
    } as unknown as Parameters<typeof toPublicReportDTO>[0]);
    for (const report of [live]) {
      const sources = report.recommendation!.sources;
      expect(sources).toHaveLength(2);
      for (const [index, source] of sources.entries()) {
        const saved = audit.recommendations[0].evidence.supporting_evidence[index];
        expect(source.url).toBe(saved.url);
        expect(source.excerpt).toBe(saved.excerpt);
        expect(passageUrl(source)).toContain("#:~:text=");
      }
      expect(report.competitorPreview[0].evidence.answers[0].sourceUrls).toContain("https://sift.com/platform/");
    }
  });

  it("preserves the fresh sample's accepted source passages", () => {
    const sources = loadSampleReport().recommendation!.sources;
    const saved = sampleAudit.recommendations[0].evidence.supporting_evidence;
    expect(sources.length).toBeGreaterThan(0);
    expect(sources).toHaveLength(saved.length);
    for (const [index, source] of sources.entries()) {
      expect(source.url).toBe(saved[index].url);
      expect(source.excerpt).toBe(saved[index].excerpt);
      expect(passageUrl(source)).toContain("#:~:text=");
    }
  });

  it("does not call citation-only or unlinked evidence verified", () => {
    expect(competitorEvidence({ evidence_status: "verified" }).evidenceStatus).toBe("answer_only_unverified");
    expect(competitorEvidence({
      evidence_status: "verified",
      website_evidence: [{ excerpt: "Saved words", url: "javascript:alert(1)" }],
      answer_evidence: [{ answer_excerpt: "Acme is recommended", source_urls: ["javascript:alert(1)", "https://example.com/product"] }],
    }).evidenceStatus).toBe("cited");
    const evidence = competitorEvidence({ answer_evidence: [{ answer_excerpt: "Acme is recommended", source_urls: ["data:text/html,bad", "https://example.com/product"] }] });
    expect(evidence.sourceUrl).toBe("https://example.com/product");
    expect(evidence.answers[0].sourceUrls).toEqual(["https://example.com/product"]);
    expect(reportSources([{ url: "https://user:password@example.com/", excerpt: "Saved words" }])[0].url).toBeNull();
    expect(reportSources([null, {}, { url: "javascript:alert(1)" }])).toEqual([]);
  });

  it("keeps the page path and encodes the quoted text without turning it into fragment syntax", () => {
    const link = passageUrl({ label: "Feature", url: "https://example.com/features#details", excerpt: "AI-powered, real-time tools..." });
    expect(link).toBe("https://example.com/features#details:~:text=AI%2Dpowered%2C%20real%2Dtime%20tools");
    expect(passageUrl({ label: "Unavailable", url: null, excerpt: "Text" })).toBeNull();
  });
});
