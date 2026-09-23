import { isValidElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const { account } = vi.hoisted(() => ({ account: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSessionUser: async () => ({ id: "owner", email: "owner@example.com" }) }));
vi.mock("@/lib/billing/account", () => ({ getAccountEntitlements: account }));
vi.mock("@/lib/db/repository", () => ({
  getBrandById: async () => ({ id: "brand", owner_id: "owner", name: "Acme" }),
  getLatestCompletedScanForBrand: async () => ({ id: "scan", brand_id: "brand", provider_ids: ["openai_search"], total_queries: 1, status: "completed" }),
  listAllPrompts: async () => [],
  getScanQuestions: async () => [{ position: 1, prompt: "Which platform?" }],
  getQueryResults: async () => [{ id: "answer", provider: "openai_search", question_position: 1, raw_answer: "Private answer text", answer_summary: "Private answer summary", brand_mentioned: true }],
}));
import AIAnswersPage from "@/app/dashboard/brands/[id]/prompts/page";
import { AnswerExplorer, type ExplorerQuestion } from "@/components/dashboard/answer-explorer";

function explorerProps(node: ReactNode): { questions: ExplorerQuestion[]; showFullAnswers: boolean } | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = explorerProps(child);
      if (found) return found;
    }
  }
  if (isValidElement<{ children?: ReactNode; questions: ExplorerQuestion[]; showFullAnswers: boolean }>(node)) {
    if (node.type === AnswerExplorer) return node.props;
    return explorerProps(node.props.children);
  }
}

describe("answer data crossing the server/client boundary", () => {
  it.each(["free", "founder"])("only sends paid answer text and summaries to an entitled %s account", async (plan) => {
    account.mockResolvedValue({ plan, status: "active" });
    const page = await AIAnswersPage({ params: Promise.resolve({ id: "brand" }), searchParams: Promise.resolve({}) });
    const props = explorerProps(page);
    expect(props).toBeDefined();
    const answer = props!.questions[0].answers[0];
    expect(props!.showFullAnswers).toBe(plan !== "free");
    expect(answer.answer).toBe(plan === "free" ? "" : "Private answer text");
    expect(answer.summary).toBe(plan === "free" ? null : "Private answer summary");
    expect(props!.questions[0].question).toBe("Which platform?");
    expect(answer.mentioned).toBe(true);
  });
});
