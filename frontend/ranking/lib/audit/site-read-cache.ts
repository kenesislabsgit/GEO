import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  access,
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { renameWithRetry, writeFileAtomic } from "@/lib/utils/atomic-file";

/**
 * Shared website reads.
 *
 * Several people may audit the same website. The only thing worth sharing
 * between their audits is the raw read of that website — the pages we fetched.
 * Everything after that (company profile, buyer questions, provider answers,
 * score, report) is generated per audit and never shared.
 *
 * This module keeps one recent read per domain on disk and makes sure that when
 * two audits for the same domain start at the same time, the site is fetched
 * once and the second audit waits for it instead of hammering the site twice.
 * Waiting is always best-effort: if the first read stalls, the second audit
 * falls back to reading the site itself rather than failing.
 */

const SHARED_DIR = "_shared_site_reads";
const SNAPSHOT_FILE = "website_snapshot.json";
const META_FILE = "meta.json";
const LOCK_FILE = "read.lock";

function envNumber(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** How long a stored website read stays reusable. */
export function siteReadTtlHours(): number {
  return envNumber("SITE_READ_TTL_HOURS", 24 * 7);
}

/** How long one audit may hold the "I am reading this site" lease. */
function leaseMs(): number {
  return envNumber("SITE_READ_LEASE_SECONDS", 8 * 60) * 1000;
}

/** How long a second audit waits for an in-flight read before doing its own. */
function maxWaitMs(): number {
  return envNumber("SITE_READ_WAIT_SECONDS", 150) * 1000;
}

type SiteReadMeta = {
  domain: string;
  published_at: string;
  pages: number;
  source_run: string | null;
};

type LockFile = {
  holder: string;
  expires_at: string;
};

export type SiteReadLease = {
  /** Path to a reusable website read, or null when this audit must read the site. */
  snapshotPath: string | null;
  /** True when this audit waited for another audit's in-flight read. */
  waited: boolean;
  /** Plain-English note for the progress stream. */
  note: string;
  /** Age of the reused read in hours, when reused. */
  ageHours: number | null;
  /** Store this audit's fresh read so later audits of the same site can reuse it. */
  publish: (runDir: string) => Promise<void>;
  /** Always call when the audit finishes or fails. */
  release: () => Promise<void>;
};

function safeDomainKey(domain: string): string {
  return domain.toLowerCase().replace(/[^a-z0-9.-]/g, "_");
}

function domainDir(geoRoot: string, domain: string): string {
  return path.resolve(geoRoot, "outputs", SHARED_DIR, safeDomainKey(domain));
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await writeFileAtomic(file, JSON.stringify(value, null, 2));
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/** A stored read that is still inside its shelf life, or null. */
async function findFreshRead(
  dir: string,
): Promise<{ snapshotPath: string; ageHours: number } | null> {
  const meta = await readJson<SiteReadMeta>(path.join(dir, META_FILE));
  if (!meta?.published_at) return null;
  const snapshotPath = path.join(dir, SNAPSHOT_FILE);
  if (!(await exists(snapshotPath))) return null;
  const ageMs = Date.now() - new Date(meta.published_at).getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0) return null;
  const ageHours = ageMs / (60 * 60 * 1000);
  if (ageHours > siteReadTtlHours()) return null;
  return { snapshotPath, ageHours };
}

/** Take the read lease if it is free or expired. */
async function tryTakeLease(dir: string, holder: string): Promise<boolean> {
  const lockPath = path.join(dir, LOCK_FILE);
  const payload: LockFile = {
    holder,
    expires_at: new Date(Date.now() + leaseMs()).toISOString(),
  };
  try {
    // "wx" fails when the file already exists, which makes this the atomic step.
    await writeFile(lockPath, JSON.stringify(payload), { flag: "wx" });
    return true;
  } catch {
    const current = await readJson<LockFile>(lockPath);
    const expired =
      !current?.expires_at || new Date(current.expires_at).getTime() <= Date.now();
    if (!expired) return false;
    // Someone left a stale lease behind (crash, restart). Clear and retry once.
    await rm(lockPath, { force: true });
    try {
      await writeFile(lockPath, JSON.stringify(payload), { flag: "wx" });
      return true;
    } catch {
      return false;
    }
  }
}

async function releaseLease(dir: string, holder: string): Promise<void> {
  const lockPath = path.join(dir, LOCK_FILE);
  const current = await readJson<LockFile>(lockPath);
  if (!current || current.holder === holder) {
    await rm(lockPath, { force: true });
  }
}

function noopLease(note: string): SiteReadLease {
  return {
    snapshotPath: null,
    waited: false,
    note,
    ageHours: null,
    publish: async () => {},
    release: async () => {},
  };
}

/**
 * Decide whether this audit can reuse a recent read of the website, or must
 * read it itself. Never throws: on any problem the caller simply reads the site.
 */
export async function acquireSiteRead(
  geoRoot: string,
  domain: string,
  options: { onWait?: (note: string) => void } = {},
): Promise<SiteReadLease> {
  const dir = domainDir(geoRoot, domain);
  const holder = randomUUID();

  try {
    await mkdir(dir, { recursive: true });

    const fresh = await findFreshRead(dir);
    if (fresh) {
      return {
        snapshotPath: fresh.snapshotPath,
        waited: false,
        note: `Reusing a read of this website from ${describeAge(fresh.ageHours)} ago`,
        ageHours: fresh.ageHours,
        publish: async () => {},
        release: async () => {},
      };
    }

    if (await tryTakeLease(dir, holder)) {
      return {
        snapshotPath: null,
        waited: false,
        note: "Reading the website for this audit",
        ageHours: null,
        publish: (runDir) => publishRead(dir, domain, runDir),
        release: () => releaseLease(dir, holder),
      };
    }

    // Another audit for the same website is reading it right now. Wait for it.
    options.onWait?.("Another audit is reading this website — waiting for it");
    const deadline = Date.now() + maxWaitMs();
    while (Date.now() < deadline) {
      await sleep(1500);
      const published = await findFreshRead(dir);
      if (published) {
        return {
          snapshotPath: published.snapshotPath,
          waited: true,
          note: "Reusing the website read from the audit that started just before this one",
          ageHours: published.ageHours,
          publish: async () => {},
          release: async () => {},
        };
      }
      if (await tryTakeLease(dir, holder)) {
        return {
          snapshotPath: null,
          waited: true,
          note: "The earlier website read did not finish — reading the website for this audit",
          ageHours: null,
          publish: (runDir) => publishRead(dir, domain, runDir),
          release: () => releaseLease(dir, holder),
        };
      }
    }

    // Waited long enough. Read the site ourselves rather than block the user.
    return noopLease("Reading the website for this audit");
  } catch {
    return noopLease("Reading the website for this audit");
  }
}

/** Copy this audit's fresh website read into the shared slot for the domain. */
async function publishRead(
  dir: string,
  domain: string,
  runDir: string,
): Promise<void> {
  try {
    const source = path.join(runDir, SNAPSHOT_FILE);
    if (!(await exists(source))) return;
    const snapshot = await readJson<{ pages?: unknown[] }>(source);
    if (!snapshot?.pages?.length) return;
    await mkdir(dir, { recursive: true });
    const target = path.join(dir, SNAPSHOT_FILE);
    const tmp = `${target}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
    await copyFile(source, tmp);
    await renameWithRetry(tmp, target);
    const meta: SiteReadMeta = {
      domain,
      published_at: new Date().toISOString(),
      pages: snapshot.pages.length,
      source_run: runDir,
    };
    await writeJsonAtomic(path.join(dir, META_FILE), meta);
  } catch {
    // Sharing is an optimisation. Failing to store it must never fail the audit.
  }
}

function describeAge(ageHours: number): string {
  if (ageHours < 1) return `${Math.max(1, Math.round(ageHours * 60))} minutes`;
  if (ageHours < 48) return `${Math.round(ageHours)} hours`;
  return `${Math.round(ageHours / 24)} days`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
