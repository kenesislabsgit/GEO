import { describe, expect, it } from "vitest";
import { readableAnswer } from "@/lib/reports/answer-presentation";

describe("readable AI answers", () => {
  it("keeps Gemini prose and removes the appended JSON from the default view", () => {
    const raw =
      'Consider these platforms.\n\n```json\n{"recommended_companies":[{"company_name":"Example","source_urls":["https://vertexaisearch.cloud.google.com/grounding-api-redirect/very-long"]}]}\n```';
    expect(readableAnswer(raw)).toEqual({
      prose: "Consider these platforms.",
      structured: true,
    });
  });
  it("uses the readable field for JSON-only answers", () => {
    expect(
      readableAnswer('{"answer_text":"A readable answer","citations":[]}'),
    ).toEqual({ prose: "A readable answer", structured: true });
  });
  it("preserves ordinary prose and non-JSON code examples", () => {
    const raw = "Use this example:\n```js\nconst name = 'Example';\n```";
    expect(readableAnswer(raw)).toEqual({ prose: raw, structured: false });
  });
  it("falls back to the summary when a structured answer has no prose", () => {
    expect(
      readableAnswer(
        '```json\n{"recommended_companies":[]}\n```',
        "No companies recommended.",
      ),
    ).toEqual({ prose: "No companies recommended.", structured: true });
  });
});
