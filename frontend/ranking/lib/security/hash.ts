import { createHash } from "crypto";

/**
 * Hash an IP for abuse records. The salt must be a real secret: with a known
 * salt the whole IPv4 space rainbow-tables in minutes. Production refuses to
 * run without one; development gets a fixed dev-only salt.
 */
function salt(): string {
  const value = process.env.IP_HASH_SALT;
  if (value) return value;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "IP_HASH_SALT is not set. Generate one (openssl rand -hex 32) and set it.",
    );
  }
  return "rankedbyai-dev-only";
}

export function hashIp(ip: string): string {
  return createHash("sha256").update(`${salt()}:${ip}`).digest("hex");
}
