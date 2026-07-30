import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { understandWebsite } from "./understand";
import { normalizeDomain } from "@/lib/security/url";
import type { BrandUnderstanding } from "@/lib/ai/schemas/analysis";

/**
 * Shared reading of a website.
 *
 * Many people can audit the same website, and the pages of that website are the
 * same for all of them, so the read is shared and reused for a while. Anything
 * personal to an audit — the buyer questions, the AI answers, the score and the
 * report — is always produced fresh per audit and never shared.
 */

const CACHE_DIR = path.join(process.cwd(), ".data", "site-reads");

function ttlMs(): number {
  const hours = Number(process.env.SITE_READ_TTL_HOURS);
  return (Number.isFinite(hours) && hours > 0 ? hours : 24 * 7) * 60 * 60 * 1000;
}

type CachedRead = {
  domain: string;
  read_at: string;
  understanding: BrandUnderstanding;
};

// Two audits starting at the same moment share one in-flight read.
const inFlight = new Map<string, Promise<BrandUnderstanding>>();

function cacheFile(domain: string): string {
  return path.join(CACHE_DIR, `${domain.replace(/[^a-z0-9.-]/gi, "_")}.json`);
}

async function readCache(domain: string): Promise<CachedRead | null> {
  try {
    const cached = JSON.parse(
      await readFile(cacheFile(domain), "utf8"),
    ) as CachedRead;
    const age = Date.now() - new Date(cached.read_at).getTime();
    if (!Number.isFinite(age) || age < 0 || age > ttlMs()) return null;
    return cached;
  } catch {
    return null;
  }
}

async function writeCache(
  domain: string,
  understanding: BrandUnderstanding,
): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    const target = cacheFile(domain);
    const tmp = `${target}.${randomUUID().slice(0, 8)}.tmp`;
    const payload: CachedRead = {
      domain,
      read_at: new Date().toISOString(),
      understanding,
    };
    await writeFile(tmp, JSON.stringify(payload, null, 2), "utf8");
    await rename(tmp, target);
  } catch {
    // Caching is an optimisation; never fail an audit because of it.
  }
}

/**
 * Read a website, reusing a recent read of the same website when there is one.
 * Set `force` to always fetch the site again.
 */
export async function readWebsiteShared(
  domainInput: string,
  options: { force?: boolean } = {},
): Promise<{ understanding: BrandUnderstanding; reused: boolean }> {
  const domain = normalizeDomain(domainInput);

  if (!options.force) {
    const cached = await readCache(domain);
    if (cached) return { understanding: cached.understanding, reused: true };

    const pending = inFlight.get(domain);
    if (pending) return { understanding: await pending, reused: true };
  }

  const task = understandWebsite(domain).then(async (understanding) => {
    await writeCache(domain, understanding);
    return understanding;
  });
  inFlight.set(domain, task);
  try {
    return { understanding: await task, reused: false };
  } finally {
    inFlight.delete(domain);
  }
}
