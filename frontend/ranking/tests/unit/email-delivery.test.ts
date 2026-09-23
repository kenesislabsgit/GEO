import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { sesSend } = vi.hoisted(() => ({ sesSend: vi.fn() }));

vi.mock("@aws-sdk/client-sesv2", () => ({
  SESv2Client: class {
    send = sesSend;
  },
  SendEmailCommand: class {
    constructor(readonly input: unknown) {}
  },
}));

import { sendAlertEmail } from "@/lib/email/delivery";

const savedEnv = { ...process.env };
const input = {
  to: "person@example.com",
  subject: "Confirm your email address",
  body: "Open the confirmation link.",
};

describe("email delivery", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    sesSend.mockReset();
    process.env = { ...savedEnv, NODE_ENV: "test" };
    delete process.env.BREVO_API_KEY;
    delete process.env.AWS_REGION;
    process.env.EMAIL_FROM = "Arcanoris <no-reply@arcanoris.in>";
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it("uses demo delivery only outside production when no provider is configured", async () => {
    await expect(sendAlertEmail(input)).resolves.toMatchObject({
      ok: true,
      demo: true,
    });
  });

  it("sends through Brevo first", async () => {
    process.env.BREVO_API_KEY = "brevo-test";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ messageId: "brevo-1" }), { status: 201 }),
      ),
    );

    await expect(sendAlertEmail({
      ...input,
      replyTo: "reply@example.com",
      actionLabel: "Confirm email",
      actionUrl: "https://arcanoris.in/confirm?token=test",
    })).resolves.toMatchObject({
      ok: true,
      provider: "brevo",
      id: "brevo-1",
    });
    const request = vi.mocked(fetch).mock.calls[0]?.[1];
    const payload = JSON.parse(String(request?.body));
    expect(payload.htmlContent).toContain("Confirm email");
    expect(payload.htmlContent).toContain("https://arcanoris.in/confirm?token=test");
    expect(payload.textContent).toContain("https://arcanoris.in/confirm?token=test");
    expect(payload.replyTo.email).toBe("reply@example.com");
    expect(sesSend).not.toHaveBeenCalled();
  });

  it("fails closed when production email is not configured", async () => {
    process.env = { ...process.env, NODE_ENV: "production" };
    await expect(sendAlertEmail(input)).resolves.toMatchObject({ ok: false });
  });

  it("keeps action links in plain text when using SES alone", async () => {
    process.env.AWS_REGION = "ap-south-1";
    sesSend.mockResolvedValue({ MessageId: "ses-plain" });
    await expect(sendAlertEmail({ ...input, actionUrl: "https://example.com/reset", actionLabel: "Reset password" })).resolves.toMatchObject({ ok: true, provider: "ses" });
    const command = sesSend.mock.calls[0][0];
    expect(command.input.Content.Simple.Body.Text.Data).toContain("https://example.com/reset");
  });

  it("falls back to AWS SES when Brevo is unavailable or out of capacity", async () => {
    process.env.BREVO_API_KEY = "brevo-test";
    process.env.AWS_REGION = "ap-south-1";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: "rate limited" }), { status: 429 }),
      ),
    );
    sesSend.mockResolvedValue({ MessageId: "ses-1" });

    await expect(sendAlertEmail(input)).resolves.toMatchObject({
      ok: true,
      provider: "ses",
      id: "ses-1",
      fallbackUsed: true,
    });
  });

  it("does not retry a permanently invalid request through AWS", async () => {
    process.env.BREVO_API_KEY = "brevo-test";
    process.env.AWS_REGION = "ap-south-1";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: "invalid recipient" }), { status: 400 }),
      ),
    );

    await expect(sendAlertEmail(input)).resolves.toMatchObject({
      ok: false,
      provider: "brevo",
    });
    expect(sesSend).not.toHaveBeenCalled();
  });
});
