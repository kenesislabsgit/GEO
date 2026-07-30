export async function verifyTurnstile(
  token: string | null | undefined,
  ip?: string | null,
): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    // Local/dev without Turnstile: allow, but never in production with secret unset intentionally.
    if (process.env.NODE_ENV === "production" && process.env.FORCE_DEMO_MODE !== "true") {
      return false;
    }
    return true;
  }
  if (!token) return false;

  const body = new URLSearchParams();
  body.set("secret", secret);
  body.set("response", token);
  if (ip) body.set("remoteip", ip);

  const response = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    { method: "POST", body },
  );
  const data = (await response.json()) as { success?: boolean };
  return Boolean(data.success);
}
