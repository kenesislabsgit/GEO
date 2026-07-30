import { assertSafeHostname, toSafeHttpsUrl } from "@/lib/security/url";

const FETCH_TIMEOUT_MS = 8_000;
const MAX_BYTES = 500_000;
const ALLOWED_TYPES = ["text/html", "application/xhtml+xml", "text/plain"];

export type FetchedPage = {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string;
  body: string;
};

export async function safeFetchPage(domainOrUrl: string): Promise<FetchedPage> {
  const url = domainOrUrl.startsWith("http")
    ? domainOrUrl
    : toSafeHttpsUrl(domainOrUrl);

  const parsed = new URL(url);
  assertSafeHostname(parsed.hostname);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "RankedByAIBot/1.0 (+https://rankedbyai.com)",
        Accept: "text/html,application/xhtml+xml",
      },
    });

    const contentType = response.headers.get("content-type") ?? "";
    const typeOk = ALLOWED_TYPES.some((t) => contentType.includes(t));
    if (!typeOk) {
      throw new Error(`Unsupported content type: ${contentType || "unknown"}`);
    }

    const finalUrl = response.url;
    const finalHost = new URL(finalUrl).hostname;
    assertSafeHostname(finalHost);

    const reader = response.body?.getReader();
    if (!reader) {
      const text = await response.text();
      return {
        url,
        finalUrl,
        status: response.status,
        contentType,
        body: text.slice(0, MAX_BYTES),
      };
    }

    const chunks: Uint8Array[] = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      received += value.byteLength;
      if (received > MAX_BYTES) {
        chunks.push(value.slice(0, Math.max(0, MAX_BYTES - (received - value.byteLength))));
        break;
      }
      chunks.push(value);
    }

    const body = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
    return {
      url,
      finalUrl,
      status: response.status,
      contentType,
      body,
    };
  } finally {
    clearTimeout(timer);
  }
}

export function extractLinks(html: string, baseUrl: string): string[] {
  const hrefs = Array.from(html.matchAll(/href=["']([^"']+)["']/gi)).map(
    (m) => m[1]!,
  );
  const results: string[] = [];
  for (const href of hrefs) {
    try {
      const absolute = new URL(href, baseUrl).toString();
      results.push(absolute);
    } catch {
      // ignore
    }
  }
  return results;
}

export function pickSupportingPages(links: string[], origin: string): string[] {
  const priorities = [/about/i, /pricing/i, /product/i, /solutions/i];
  const picked: string[] = [];
  for (const pattern of priorities) {
    const match = links.find(
      (link) => link.startsWith(origin) && pattern.test(link),
    );
    if (match && !picked.includes(match)) picked.push(match);
    if (picked.length >= 2) break;
  }
  return picked;
}
