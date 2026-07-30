import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acquireSiteRead } from "@/lib/audit/site-read-cache";

/**
 * The website read is the one thing shared between people auditing the same
 * site. Two audits starting together must fetch the site once, and a second
 * audit must never be blocked if the first one stalls.
 */

let geoRoot: string;

beforeAll(async () => {
  geoRoot = await mkdtemp(path.join(tmpdir(), "rbai-geo-"));
  process.env.SITE_READ_WAIT_SECONDS = "2";
});

afterAll(async () => {
  delete process.env.SITE_READ_WAIT_SECONDS;
  await rm(geoRoot, { recursive: true, force: true });
});

async function fakeRunDir(name: string, pages: number): Promise<string> {
  const runDir = path.join(geoRoot, "outputs", name);
  await mkdir(runDir, { recursive: true });
  await writeFile(
    path.join(runDir, "website_snapshot.json"),
    JSON.stringify({
      domain: "example.com",
      generated_at: new Date().toISOString(),
      pages: Array.from({ length: pages }, (_, i) => ({ url: `p${i}` })),
    }),
    "utf8",
  );
  return runDir;
}

describe("shared website read", () => {
  it("makes the first audit read the site, and lets the next one reuse it", async () => {
    const first = await acquireSiteRead(geoRoot, "example.com");
    expect(first.snapshotPath).toBeNull();

    const runDir = await fakeRunDir("run-1", 4);
    await first.publish(runDir);
    await first.release();

    const second = await acquireSiteRead(geoRoot, "example.com");
    expect(second.snapshotPath).not.toBeNull();
    expect(second.waited).toBe(false);
    expect(second.note).toContain("Reusing");
  });

  it("does not block a second audit when the first read never finishes", async () => {
    const first = await acquireSiteRead(geoRoot, "stalled.com");
    expect(first.snapshotPath).toBeNull();

    const waits: string[] = [];
    const second = await acquireSiteRead(geoRoot, "stalled.com", {
      onWait: (note) => waits.push(note),
    });

    // It waited for the in-flight read, then read the site itself rather than fail.
    expect(waits.length).toBe(1);
    expect(second.snapshotPath).toBeNull();
    await first.release();
    await second.release();
  });

  it("ignores a stored read for a different website", async () => {
    const lease = await acquireSiteRead(geoRoot, "other.com");
    const runDir = await fakeRunDir("run-2", 0);
    await lease.publish(runDir);
    await lease.release();

    // An empty read is not worth sharing, so the next audit reads the site.
    const next = await acquireSiteRead(geoRoot, "other.com");
    expect(next.snapshotPath).toBeNull();
    await next.release();
  });
});
