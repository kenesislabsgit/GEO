import dns from "node:dns/promises";
import net from "node:net";
import { isPublicIpAddress } from "@/lib/security/ip-ranges";

/**
 * SSRF-safe fetch for the few server-side requests the web app makes to
 * user-controlled hosts (domain-verification checks). Rules:
 *
 * - https only, default port only, no credentials in the URL
 * - the hostname must resolve, and EVERY resolved address must be public
 * - redirects are never followed - the well-known check has one exact URL
 * - hard timeout and a small response-size cap
 *
 * The audit crawler runs in the Python engine with its own guard; this is
 * only for the web app's own outbound checks.
 */

export class SafeFetchError extends Error {}

const MAX_BYTES = 64 * 1024;
const TIMEOUT_MS = 10_000;

export async function assertPublicHost(hostname: string): Promise<void> {
  if (net.isIP(hostname)) {
    if (!isPublicIpAddress(hostname)) {
      throw new SafeFetchError("Literal IP addresses are not allowed.");
    }
    return;
  }
  let addresses: Array<{ address: string }>;
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new SafeFetchError("The domain does not resolve.");
  }
  if (addresses.length === 0) {
    throw new SafeFetchError("The domain does not resolve.");
  }
  // Every address must be public: a DNS-rebinding host mixing one public and
  // one private record fails here.
  for (const { address } of addresses) {
    if (!isPublicIpAddress(address)) {
      throw new SafeFetchError("The domain resolves to a non-public address.");
    }
  }
}

export async function safeFetchText(url: string): Promise<string> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") {
    throw new SafeFetchError("Only https URLs are allowed.");
  }
  if (parsed.username || parsed.password) {
    throw new SafeFetchError("Credentials in URLs are not allowed.");
  }
  if (parsed.port && parsed.port !== "443") {
    throw new SafeFetchError("Non-standard ports are not allowed.");
  }
  await assertPublicHost(parsed.hostname);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(parsed.toString(), {
      redirect: "manual",
      signal: controller.signal,
      headers: { "user-agent": "Arcanoris-Verification/1.0" },
    });
    if (response.status >= 300 && response.status < 400) {
      throw new SafeFetchError(
        "The verification file must be served directly, without redirects.",
      );
    }
    if (!response.ok) {
      throw new SafeFetchError(`The server answered ${response.status}.`);
    }
    const type = response.headers.get("content-type") ?? "";
    if (type && !/text\/plain|text\/html|application\/octet-stream/i.test(type)) {
      throw new SafeFetchError("Unexpected content type for a verification file.");
    }
    const reader = response.body?.getReader();
    if (!reader) return "";
    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_BYTES) {
        await reader.cancel().catch(() => {});
        throw new SafeFetchError("The verification file is too large.");
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } catch (error) {
    if (error instanceof SafeFetchError) throw error;
    throw new SafeFetchError("The verification file could not be fetched.");
  } finally {
    clearTimeout(timer);
  }
}
