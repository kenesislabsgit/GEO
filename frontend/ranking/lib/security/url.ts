import { z } from "zod";

const PRIVATE_IPV4 = [
  /^127\./,
  /^10\./,
  /^0\./,
  /^169\.254\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^100\.(6[4-9]|[7-9]\d|1[0-2]\d)\./,
  /^198\.1[8-9]\./,
];

const BLOCKED_HOSTS = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "metadata",
  "0.0.0.0",
]);

export class UrlValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UrlValidationError";
  }
}

export function stripWww(hostname: string): string {
  return hostname.replace(/^www\./i, "").toLowerCase();
}

export function normalizeDomain(input: string): string {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) {
    throw new UrlValidationError("Domain is required.");
  }

  let candidate = trimmed;
  if (!/^https?:\/\//i.test(candidate)) {
    candidate = `https://${candidate}`;
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new UrlValidationError("Enter a valid domain, for example example.com.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UrlValidationError("Only http and https URLs are supported.");
  }

  const hostname = stripWww(url.hostname);
  assertSafeHostname(hostname);

  if (!hostname.includes(".") && hostname !== "localhost") {
    throw new UrlValidationError("Enter a fully qualified domain name.");
  }

  return hostname;
}

export function toSafeHttpsUrl(domainOrUrl: string): string {
  const domain = normalizeDomain(domainOrUrl);
  return `https://${domain}`;
}

export function assertSafeHostname(hostname: string): void {
  const host = hostname.toLowerCase();

  if (!host || host.length > 253) {
    throw new UrlValidationError("Invalid hostname.");
  }

  if (BLOCKED_HOSTS.has(host) || host.endsWith(".localhost") || host.endsWith(".local")) {
    throw new UrlValidationError("Local and internal hosts are not allowed.");
  }

  if (host.includes(":") || host.startsWith("[") || host.endsWith("]")) {
    throw new UrlValidationError("IPv6 and bracketed hosts are not allowed.");
  }

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    if (PRIVATE_IPV4.some((re) => re.test(host))) {
      throw new UrlValidationError("Private or reserved IP addresses are not allowed.");
    }
    throw new UrlValidationError("Raw IP addresses are not allowed. Use a domain name.");
  }

  if (host === "metadata.google.internal" || host.endsWith(".internal")) {
    throw new UrlValidationError("Internal network hosts are not allowed.");
  }
}

export function isSafePublicUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    assertSafeHostname(url.hostname);
    return true;
  } catch {
    return false;
  }
}

export const domainInputSchema = z
  .string()
  .min(1, "Domain is required")
  .max(253)
  .superRefine((value, ctx) => {
    try {
      normalizeDomain(value);
    } catch (error) {
      ctx.addIssue({
        code: "custom",
        message:
          error instanceof UrlValidationError
            ? error.message
            : "Invalid domain",
      });
    }
  })
  .transform((value) => normalizeDomain(value));
