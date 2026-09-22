import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/rate-limit", () => ({
  limitAction: vi.fn(async () => ({ success: true })),
}));
vi.mock("@/lib/email/smtp", () => ({
  sendContactEmail: vi.fn(async () => ({ ok: true })),
}));
import { POST } from "@/app/api/contact/route";
import { sendContactEmail } from "@/lib/email/smtp";

const send = (body: unknown) =>
  POST(
    new Request("http://localhost/api/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
beforeEach(() => vi.clearAllMocks());
describe("support inquiry endpoint", () => {
  it("routes a minimal support request without requiring or parsing a website", async () => {
    expect(
      (
        await send({
          interest: "support",
          workEmail: "customer@example.com",
          needs: "I was billed twice for September.",
        })
      ).status,
    ).toBe(200);
    expect(sendContactEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        replyTo: "customer@example.com",
        subject: expect.stringContaining("Account or billing support"),
        body: expect.stringContaining("I was billed twice"),
      }),
    );
  });
  it("rejects incomplete sales inquiries and empty support messages", async () => {
    expect(
      (
        await send({
          interest: "pro",
          workEmail: "customer@example.com",
          needs: "Need a quote",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await send({
          interest: "support",
          workEmail: "customer@example.com",
          needs: "",
        })
      ).status,
    ).toBe(400);
    expect(sendContactEmail).not.toHaveBeenCalled();
  });
});
