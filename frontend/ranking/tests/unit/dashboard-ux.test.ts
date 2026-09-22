// @vitest-environment jsdom
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  AnswerExplorer,
  type ExplorerQuestion,
} from "@/components/dashboard/answer-explorer";
import { ScanProgress } from "@/components/scan/scan-progress";
import { BrandMonitoringForm } from "@/components/dashboard/brand-monitoring-form";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams("q=platform"),
}));
vi.mock("thinking-orbs", () => ({ ThinkingOrb: () => null }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("dashboard state and evidence clarity", () => {
  it("keeps a cancelled audit terminal even while its status connection is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(
      createElement(ScanProgress, {
        scanId: "cancelled",
        destination: { type: "dashboard", brandId: "brand" },
        initialState: {
          status: "cancelled",
          step: null,
          progress: 0,
          completedQueries: 0,
          totalQueries: 5,
          slug: null,
          errorSummary: null,
        },
      }),
    );
    expect(
      screen.getByRole("heading", { name: "Audit cancelled" }),
    ).toBeTruthy();
    expect(
      screen.queryByText("You can leave this page - the audit keeps running."),
    ).toBeNull();
    expect(
      await screen.findByRole("button", { name: "Refresh status" }),
    ).toBeTruthy();
  });
  it("renders structured answers as prose with raw output behind a closed disclosure and supports filtering", () => {
    const questions: ExplorerQuestion[] = [
      {
        promptId: "q1",
        question: "Which platform?",
        promptType: "buyer_question",
        answers: [
          {
            id: "a",
            provider: "gemini",
            assistantName: "Gemini",
            mentioned: false,
            position: null,
            answer: JSON.stringify({
              answer: "Compare these platforms.",
              recommended_companies: ["Example"],
            }),
            recommended: [{ name: "Example", position: 1, reason: null }],
            citations: [],
          },
          {
            id: "b",
            provider: "claude",
            assistantName: "Claude",
            mentioned: false,
            position: null,
            answer: "",
            error: "Timed out",
            recommended: [],
            citations: [],
          },
        ],
      },
    ];
    render(createElement(AnswerExplorer, { questions, brandName: "Acme" }));
    expect(screen.getByText("Compare these platforms.")).toBeTruthy();
    expect(
      screen.getByText("View raw provider response").closest("details")?.open,
    ).toBe(false);
    fireEvent.change(screen.getByLabelText("Filter mention outcome"), {
      target: { value: "unavailable" },
    });
    expect(screen.queryByText("Compare these platforms.")).toBeNull();
    expect(
      screen.getAllByText(/Unavailable|Response unavailable/).length,
    ).toBeGreaterThan(0);
  });
  it("shows incomplete monitoring and names the effective defaults instead of implying an enabled schedule is ready", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue({
          ok: true,
          json: async () => ({
            settings: {
              enabled: true,
              monitoringFrequency: "weekly",
              providers: [],
              monitoringQuestions: [],
              country: "us",
              language: "en",
              alerts: {},
            },
            availableProviders: ["openai_search", "claude"],
            blockingReasons: [],
            lastSuccessfulAt: null,
            brand: { country: "us", language: "en" },
            plan: {
              id: "founder",
              dailyMonitoring: false,
              weeklyMonitoring: true,
              providers: ["openai_search", "claude"],
              providersPerScan: 2,
            },
            countries: [],
            languages: [],
            questionSets: [],
          }),
        }),
    );
    render(
      createElement(BrandMonitoringForm, {
        brandId: "brand",
        isPaid: true,
        canEdit: true,
      }),
    );
    expect(await screen.findByText("Setup incomplete")).toBeTruthy();
    expect(
      screen.getByText(/Effective providers:.*ChatGPT.*Claude/),
    ).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: /Save settings/,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
});
