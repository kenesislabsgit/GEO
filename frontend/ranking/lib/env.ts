/**
 * Environment validation. Production refuses to boot with required
 * configuration missing - a half-configured deploy must fail loudly at
 * startup, not quietly simulate billing or skip email verification at
 * request time.
 *
 * Imported for its side effect by the root layout (web) and worker/index.ts.
 */

const isProduction = process.env.NODE_ENV === "production";

type Requirement = { name: string; why: string; workerToo?: boolean };

const REQUIRED_IN_PRODUCTION: Requirement[] = [
  { name: "DATABASE_URL", why: "the database", workerToo: true },
  { name: "BETTER_AUTH_SECRET", why: "session signing" },
  { name: "BETTER_AUTH_URL", why: "auth callbacks" },
  { name: "NEXT_PUBLIC_APP_URL", why: "absolute URLs in emails and checkout" },
  { name: "IP_HASH_SALT", why: "hashing IPs in abuse records" },
  { name: "DODO_PAYMENTS_API_KEY", why: "real checkout (no simulation exists)" },
  { name: "DODO_PAYMENTS_WEBHOOK_KEY", why: "verifying billing webhooks" },
  { name: "DODO_FOUNDER_MONTHLY_PRODUCT_ID", why: "the Pro plan product" },
  { name: "DODO_GROWTH_MONTHLY_PRODUCT_ID", why: "the Pro+ plan product" },
  { name: "RESEND_API_KEY", why: "verification and alert email" },
  { name: "EMAIL_FROM", why: "the sending address" },
];

const REQUIRED_FOR_WORKER: Requirement[] = [
  { name: "DATABASE_URL", why: "the database" },
  { name: "GEO_AUDIT_ROOT", why: "locating the audit engine" },
];

export function validateEnv(role: "web" | "worker"): void {
  if (!isProduction) return;
  // `next build` runs with NODE_ENV=production but needs no runtime
  // services; the check guards serving, not compiling.
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const required =
    role === "worker" ? REQUIRED_FOR_WORKER : REQUIRED_IN_PRODUCTION;
  const missing = required.filter((item) => !process.env[item.name]);
  if (missing.length > 0) {
    const lines = missing
      .map((item) => `  ${item.name} - needed for ${item.why}`)
      .join("\n");
    throw new Error(
      `Refusing to start: required production configuration is missing.\n${lines}`,
    );
  }
}
