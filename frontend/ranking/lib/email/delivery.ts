import { SendEmailCommand, SESv2Client } from "@aws-sdk/client-sesv2";
import { APP_NAME } from "@/lib/constants";
import { log } from "@/lib/log";

type Provider = "brevo" | "ses";

export type EmailDeliveryResult = {
  ok: boolean;
  demo?: boolean;
  id?: string;
  error?: string;
  provider?: Provider;
  fallbackUsed?: boolean;
};

type EmailInput = {
  to: string;
  subject: string;
  body: string;
  replyTo?: string;
  actionLabel?: string;
  actionUrl?: string;
};

type ProviderResult = EmailDeliveryResult & { retryable?: boolean };

export function isEmailDeliveryConfigured(): boolean {
  return Boolean(process.env.BREVO_API_KEY?.trim() || process.env.AWS_REGION?.trim());
}

function sender(): { name: string; email: string; formatted: string } {
  const formatted =
    process.env.EMAIL_FROM?.trim() || `${APP_NAME} <no-reply@arcanoris.in>`;
  const match = formatted.match(/^\s*(.*?)\s*<([^<>\s]+@[^<>\s]+)>\s*$/);
  if (match) {
    return {
      name: match[1].replace(/^"|"$/g, "").trim() || APP_NAME,
      email: match[2],
      formatted,
    };
  }
  return { name: APP_NAME, email: formatted, formatted };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function plainText(input: EmailInput): string {
  return input.actionUrl
    ? `${input.body}\n\n${input.actionLabel ?? "Continue"}: ${input.actionUrl}`
    : input.body;
}

function brandedHtml(input: EmailInput): string {
  const content = input.body
    .split(/\n{2,}/)
    .filter(Boolean)
    .map((paragraph) =>
      `<p style="margin:0 0 16px;color:#475569;font-size:15px;line-height:1.6">${escapeHtml(paragraph).replaceAll("\n", "<br>")}</p>`,
    )
    .join("");
  const action =
    input.actionLabel && input.actionUrl
      ? `<p style="margin:24px 0"><a href="${escapeHtml(input.actionUrl)}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px">${escapeHtml(input.actionLabel)}</a></p><p style="margin:0 0 16px;color:#64748b;font-size:12px;line-height:1.5;word-break:break-all">If the button does not work, copy this link:<br><a href="${escapeHtml(input.actionUrl)}" style="color:#2563eb">${escapeHtml(input.actionUrl)}</a></p>`
      : "";

  return `<!doctype html><html><body style="margin:0;background:#f4f7fb;font-family:Arial,sans-serif"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:32px 16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px"><tr><td style="padding:28px"><div style="color:#0f172a;font-size:22px;font-weight:700;margin-bottom:24px">Arcanoris</div><h1 style="margin:0 0 16px;color:#0f172a;font-size:22px;line-height:1.3">${escapeHtml(input.subject)}</h1>${content}${action}<p style="margin:24px 0 0;padding-top:20px;border-top:1px solid #e2e8f0;color:#94a3b8;font-size:12px">Arcanoris · AI visibility audits</p></td></tr></table></td></tr></table></body></html>`;
}

async function sendWithBrevo(input: EmailInput): Promise<ProviderResult> {
  const key = process.env.BREVO_API_KEY?.trim();
  if (!key) return { ok: false, error: "Brevo is not configured.", retryable: true };

  try {
    const from = sender();
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        accept: "application/json",
        "api-key": key,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        sender: { name: from.name, email: from.email },
        to: [{ email: input.to }],
        ...(input.replyTo ? { replyTo: { email: input.replyTo } } : {}),
        subject: `[${APP_NAME}] ${input.subject}`,
        textContent: plainText(input),
        htmlContent: brandedHtml(input),
      }),
    });
    const data = (await response.json().catch(() => ({}))) as {
      messageId?: string;
      message?: string;
    };
    if (response.ok) {
      return { ok: true, id: data.messageId, provider: "brevo" };
    }
    const retryable =
      response.status === 401 ||
      response.status === 403 ||
      response.status === 429 ||
      response.status >= 500;
    log.warn("email_provider_failed", {
      provider: "brevo",
      status: response.status,
      retryable,
    });
    return {
      ok: false,
      error: `Brevo rejected the email (${response.status}).`,
      retryable,
      provider: "brevo",
    };
  } catch {
    log.warn("email_provider_failed", {
      provider: "brevo",
      status: 0,
      retryable: true,
    });
    return {
      ok: false,
      error: "Brevo could not be reached.",
      retryable: true,
      provider: "brevo",
    };
  }
}

async function sendWithSes(input: EmailInput): Promise<ProviderResult> {
  const region = process.env.AWS_REGION?.trim();
  if (!region) return { ok: false, error: "AWS SES is not configured." };

  try {
    const from = sender();
    const client = new SESv2Client({ region });
    const response = await client.send(
      new SendEmailCommand({
        FromEmailAddress: from.formatted,
        Destination: { ToAddresses: [input.to] },
        ReplyToAddresses: input.replyTo ? [input.replyTo] : undefined,
        Content: {
          Simple: {
            Subject: { Data: `[${APP_NAME}] ${input.subject}`, Charset: "UTF-8" },
            Body: {
              Text: { Data: plainText(input), Charset: "UTF-8" },
              Html: { Data: brandedHtml(input), Charset: "UTF-8" },
            },
          },
        },
      }),
    );
    return { ok: true, id: response.MessageId, provider: "ses" };
  } catch (error) {
    const errorName = error instanceof Error ? error.name : "UnknownError";
    log.error("email_provider_failed", {
      provider: "ses",
      errorType: errorName,
      retryable: false,
    });
    return { ok: false, error: `AWS SES failed (${errorName}).`, provider: "ses" };
  }
}

export async function sendAlertEmail(input: EmailInput): Promise<EmailDeliveryResult> {
  if (!isEmailDeliveryConfigured()) {
    if (process.env.NODE_ENV === "production") {
      log.error("email_delivery_unconfigured", {});
      return { ok: false, error: "Email delivery is not configured." };
    }
    log.info("email_demo", {});
    return { ok: true, demo: true };
  }

  const primary = await sendWithBrevo(input);
  if (primary.ok || !primary.retryable) return primary;

  log.warn("email_fallback_started", {
    fromProvider: "brevo",
    toProvider: "ses",
  });
  const fallback = await sendWithSes(input);
  if (fallback.ok) {
    log.info("email_fallback_succeeded", { provider: "ses" });
    return { ...fallback, fallbackUsed: true };
  }

  log.error("email_delivery_failed", {
    primaryProvider: "brevo",
    fallbackProvider: "ses",
  });
  return {
    ok: false,
    error: `${primary.error ?? "Brevo failed"} ${fallback.error ?? "AWS SES failed"}`,
    provider: "ses",
    fallbackUsed: true,
  };
}
