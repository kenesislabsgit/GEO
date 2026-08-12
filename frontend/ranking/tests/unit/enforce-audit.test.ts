import { describe, expect, it, vi } from "vitest";

// The door check, tested against a faked account so no database is needed.
vi.mock("@/lib/billing/account", () => ({
  getAccountEntitlements: vi.fn(),
}));

import { getAccountEntitlements } from "@/lib/billing/account";
import { authorizeAudit } from "@/lib/billing/enforce";

const mocked = vi.mocked(getAccountEntitlements);

function account(overrides: Partial<Awaited<ReturnType<typeof getAccountEntitlements>>>) {
  return {
    plan: "free" as const,
    status: "inactive" as const,
    providerChecksUsed: 0,
    brandCount: 0,
    activePromptCount: 0,
    planName: "Free",
    ...overrides,
  };
}

describe("authorizeAudit", () => {
  it("refuses a Pro run on a free account", async () => {
    mocked.mockResolvedValueOnce(account({}));
    const result = await authorizeAudit("u1", {
      mode: "pro",
      assistants: ["openai_search"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(402);
  });

  it("refuses paid-only providers on a free run", async () => {
    mocked.mockResolvedValueOnce(account({}));
    const result = await authorizeAudit("u1", {
      mode: "free",
      assistants: ["bedrock_claude"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
  });

  it("accepts bedrock_nova for a Pro+ subscriber", async () => {
    mocked.mockResolvedValueOnce(
      account({ plan: "growth", status: "active", planName: "Pro+" }),
    );
    const result = await authorizeAudit("u1", {
      mode: "pro",
      assistants: ["bedrock_nova", "openai_search"],
      limitPerAssistant: 20,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.assistants).toContain("bedrock_nova");
      expect(result.limitPerAssistant).toBe(20);
    }
  });

  it("clamps question counts to the plan's size", async () => {
    mocked.mockResolvedValueOnce(account({}));
    const result = await authorizeAudit("u1", {
      mode: "free",
      assistants: ["openai_search"],
      limitPerAssistant: 20,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.limitPerAssistant).toBe(5);
  });

  it("refuses when the monthly allowance is spent", async () => {
    mocked.mockResolvedValueOnce(
      account({ plan: "founder", status: "active", providerChecksUsed: 400, planName: "Pro" }),
    );
    const result = await authorizeAudit("u1", {
      mode: "pro",
      assistants: ["openai_search"],
      limitPerAssistant: 20,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(402);
  });
});
