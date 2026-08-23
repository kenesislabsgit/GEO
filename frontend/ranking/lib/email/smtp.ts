import nodemailer from "nodemailer";
import { APP_NAME, SUPPORT_EMAIL } from "@/lib/constants";

const SMTP_HOST = process.env.SMTP_HOST ?? "smtp.zoho.in";
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_FROM = process.env.SMTP_FROM ?? SUPPORT_EMAIL;

type SmtpTransport = {
  host: string;
  port: number;
  secure: boolean;
};

/** The Zoho India endpoint that authenticated in our tests. */
const ZOHO_SSL: SmtpTransport = {
  host: SMTP_HOST,
  port: Number(process.env.SMTP_PORT ?? "465"),
  secure: process.env.SMTP_SECURE !== "false",
};

/** Fallback if a network path rejects implicit TLS on 465. */
const ZOHO_STARTTLS: SmtpTransport = {
  host: SMTP_HOST,
  port: 587,
  secure: false,
};

function configured(): boolean {
  return Boolean(SMTP_USER && SMTP_PASS);
}

function isConnectError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /econn|etimedout|eprotocol|wrong version number|ssl|tls|socket/i.test(
    message,
  );
}

async function sendWith(
  transport: SmtpTransport,
  input: {
    to: string;
    replyTo: string;
    subject: string;
    body: string;
  },
): Promise<{ ok: true; id?: string } | { ok: false; error: string }> {
  const transporter = nodemailer.createTransport({
    host: transport.host,
    port: transport.port,
    secure: transport.secure,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  try {
    const info = await transporter.sendMail({
      from: `${APP_NAME} <${SMTP_FROM}>`,
      to: input.to,
      replyTo: input.replyTo,
      subject: `[${APP_NAME}] ${input.subject}`,
      text: input.body,
    });
    return { ok: true, id: info.messageId };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "SMTP send failed",
    };
  } finally {
    transporter.close();
  }
}

export async function sendContactEmail(input: {
  to: string;
  replyTo: string;
  subject: string;
  body: string;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  if (!configured()) {
    return {
      ok: false,
      error: "SMTP is not configured. Set SMTP_USER and SMTP_PASS.",
    };
  }

  const primary = await sendWith(ZOHO_SSL, input);
  if (primary.ok) return primary;
  if (!isConnectError(primary.error)) return primary;

  return sendWith(ZOHO_STARTTLS, input);
}
