// @vitest-environment jsdom
import { createElement } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useSearchParams: () =>
    new URLSearchParams(
      "returnTo=%2Fdashboard%2Fscans%2Fnew%3Fdomain%3Dexample.com",
    ),
}));
vi.mock("@/lib/auth/client", () => ({
  authClient: { sendVerificationEmail: vi.fn() },
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { HeroDomainInput } from "@/components/site/hero-domain-input";
import { VerifyEmailCard } from "@/app/verify-email/verify-email-card";
import { BrandMonitoringForm } from "@/components/dashboard/brand-monitoring-form";
import {
  ChartData,
  chartKeyboardIndex,
} from "@/components/dither-kit/chart-data";
import { authClient } from "@/lib/auth/client";
import { toast } from "sonner";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("frontend recovery without layout changes", () => {
  it("pastes a URL and places the caret after the event handler finishes", () => {
    let frame!: FrameRequestCallback;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frame = callback;
      return 1;
    });
    render(createElement(HeroDomainInput));
    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.paste(input, {
      clipboardData: { getData: () => "https://example.com" },
    });
    expect(input.value).toBe("example.com");
    expect(() => frame(0)).not.toThrow();
    expect(input.selectionStart).toBe(input.value.length);
  });

  it("keeps email resend retryable on failure and preserves the audit destination", async () => {
    vi.useFakeTimers();
    vi.mocked(authClient.sendVerificationEmail)
      .mockResolvedValueOnce({
        data: null,
        error: {
          message: "Rate limited",
          status: 429,
          statusText: "Too Many Requests",
        },
      })
      .mockResolvedValueOnce({ data: { status: true }, error: null });
    render(createElement(VerifyEmailCard, { email: "user@example.com" }));
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Resend confirmation email" }),
      );
    });
    expect(toast.error).toHaveBeenCalledWith("Rate limited");
    const retry = screen.getByRole("button", {
      name: "Resend confirmation email",
    }) as HTMLButtonElement;
    expect(retry.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(retry);
    });
    expect(
      (
        screen.getByRole("button", {
          name: "Sent - check your inbox",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    const callback = vi
      .mocked(authClient.sendVerificationEmail)
      .mock.calls.at(-1)![0].callbackURL!;
    expect(
      new URL(callback, "http://localhost").searchParams.get("returnTo"),
    ).toBe("/dashboard/scans/new?domain=example.com");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(
      (
        screen.getByRole("button", {
          name: "Resend confirmation email",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  it("shows a retry action after monitoring fails to load", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("Offline"));
    vi.stubGlobal("fetch", fetch);
    await act(async () => {
      render(
        createElement(BrandMonitoringForm, {
          brandId: "brand-1",
          isPaid: true,
          canEdit: true,
        }),
      );
    });
    expect(screen.getByRole("alert").textContent).toBe("Offline");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("exposes exact chart values and missing data to assistive technology", () => {
    render(
      createElement(ChartData, {
        data: [
          { country: "India", rate: 0 },
          { country: "Japan", rate: null },
        ],
        config: { rate: { label: "Mention rate %", color: "blue" } },
        labelKey: "country",
        label: "Market coverage",
        activeIndex: 1,
      }),
    );
    const table = screen.getByRole("table", { name: "Market coverage data" });
    expect(table.textContent).toContain("India0");
    expect(table.textContent).toContain("JapanNot tested");
    expect(chartKeyboardIndex("End", 0, 2)).toBe(1);
    expect(chartKeyboardIndex("ArrowRight", 1, 2)).toBe(1);
    expect(chartKeyboardIndex("Home", 1, 2)).toBe(0);
    expect(chartKeyboardIndex("Escape", 1, 2)).toBeNull();
    expect(chartKeyboardIndex("Tab", 1, 2)).toBeUndefined();
  });
});
