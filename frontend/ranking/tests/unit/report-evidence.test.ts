import { describe, expect, it } from "vitest";
import audit from "@/tests/fixtures/free-audit-export.json";
import { loadSampleReport } from "@/lib/reports/sample-report";
import { toPublicReportDTO } from "@/lib/reports/public-dto";
import { competitorEvidence, passageUrl, reportSources } from "@/lib/reports/evidence";

describe("public report evidence", () => {
  it("keeps each sample competitor's exact cited source and saved answer", () => {
    const report = loadSampleReport();
    for (const competitor of report.competitorPreview) {
      const saved = audit.score.competitor_scores.find(row => row.name === competitor.name)!;
      expect(competitor.evidence.sourceUrl).toBe(saved.answer_evidence[0].source_urls[0]);
      expect(competitor.evidence.answers[0].excerpt).toBe(saved.answer_evidence[0].answer_excerpt);
      expect(competitor.evidence.answers[0].question).toBe(saved.answer_evidence[0].question);
    }
    expect(report.competitorPreview.find(row => row.name === "Sift")?.evidenceStatus).toBe("verified");
    expect(report.competitorPreview.find(row => row.name === "Adyen")?.evidenceStatus).toBe("cited");
    expect(report.score.mentionRate).toBe(60);
    expect(report.competitorPreview.some(row => row.name.startsWith("Stripe"))).toBe(false);
  });

  it("preserves the recommendation's accepted source passages in both report adapters", () => {
    const live = toPublicReportDTO({
      brand: { name: "Stripe", slug: "stripe", canonical_domain: "stripe.com" },
      scan: { provider_ids: ["openai_search"] },
      score: audit.score,
      prompts: [],
      results: [],
      recommendations: audit.recommendations,
    } as unknown as Parameters<typeof toPublicReportDTO>[0]);
    for (const report of [loadSampleReport(), live]) {
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
