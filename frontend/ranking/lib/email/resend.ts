import { Resend } from "resend";
import { APP_NAME } from "@/lib/constants";

export function isEmailDeliveryConfigured(): boolean {
  const key = process.env.RESEND_API_KEY?.trim();
  return Boolean(key && !key.startsWith("re_dummy_"));
}

export async function sendAlertEmail(input: {
  to: string;
  subject: string;
  body: string;
}): Promise<{ ok: boolean; demo?: boolean; id?: string; error?: string }> {
  if (!isEmailDeliveryConfigured()) {
    console.info(`[email:demo] to=${input.to} subject=${input.subject}`);
    return { ok: true, demo: true };
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const from = process.env.EMAIL_FROM ?? `${APP_NAME} <onboarding@resend.dev>`;
  const { data, error } = await resend.emails.send({
    from,
    to: input.to,
    subject: `[${APP_NAME}] ${input.subject}`,
    text: input.body,
  });

  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true, id: data?.id };
}
