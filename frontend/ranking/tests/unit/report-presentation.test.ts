import { describe, it, expect } from "vitest";
import { reportSampling, reportText, categoryLabel, utcTimestamp } from "@/lib/reports/presentation";
import { selectedTrial, trialCommitment } from "@/lib/billing/pricing";
import { loadSampleReport } from "@/lib/reports/sample-report";

describe("historical report presentation", () => {
  it("cleans internal categories and escaped prose without changing ordinary text", () => {
    expect(categoryLabel("buyer_question")).toBe("Buyer question");
    expect(reportText(String.raw`Add \"Infosys\" to the headline.`)).toBe('Add "Infosys" to the headline.');
    expect(reportText("Don't change C:\\projects or https://example.com")).toBe("Don't change C:\\projects or https://example.com");
    expect(utcTimestamp("2026-07-30T08:49:27+00:00")).toBe("2026-07-30 08:49:27.000 UTC");
    expect(utcTimestamp(null)).toBe("Not recorded");
  });
  it("counts actual responses without treating failures as repetitions", () => {
    const row = { provider: "openai", model: "gpt-test", question: "q1", raw_answer: "Answer" };
    const sampling = reportSampling([row, row, { ...row, question: "q2" }, { ...row, question: "q3", error: "timeout", raw_answer: "" }]);
    expect(sampling.answerCount).toBe(3);
    expect(sampling.failedCount).toBe(1);
    expect(sampling.repetitions).toContain("1–2 saved answers");
    expect(sampling.models).toEqual([{ provider: "openai", model: "gpt-test" }]);
  });
  it("exposes all measured models without counting the simulated provider", () => {
    const sample = loadSampleReport();
    expect(sample.scan.sampling.answerCount).toBe(80);
    expect(new Set(sample.scan.sampling.models.map((row) => row.provider)).size).toBe(4);
    expect(sample.scan.sampling.models.every((row) => Boolean(row.model) && row.provider !== "perplexity")).toBe(true);
    expect(sample.scan.sampling.timestampLabel).toBe("Scan created");
    expect(Date.parse(sample.scan.completedAt!)).toBeGreaterThan(Date.parse(sample.scan.createdAt));
  });
});

describe("selected trial", () => {
  it("uses only a valid checkout selection", () => {
    expect(selectedTrial("/dashboard/billing/start?plan=founder&interval=yearly")?.interval).toBe("yearly");
    expect(selectedTrial("/dashboard/billing/start?plan=agency&interval=yearly")).toBeNull();
    expect(selectedTrial("/dashboard/billing/start?plan=founder&interval=invalid")).toBeNull();
    expect(trialCommitment("yearly")).toContain("$790/year");
    expect(trialCommitment("monthly")).toContain("$79/month");
  });
});
