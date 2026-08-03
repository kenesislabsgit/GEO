import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock is hoisted above the imports, so the switch it reads has to be too.
const renameFault = vi.hoisted(() => ({ remaining: 0, code: "EPERM" }));

vi.mock("node:fs/promises", async () => {
  const actual =
    await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  return {
    ...actual,
    default: actual,
    rename: async (from: string, to: string) => {
      if (renameFault.remaining > 0) {
        renameFault.remaining -= 1;
        const error = new Error(`${renameFault.code}: rename failed`);
        (error as NodeJS.ErrnoException).code = renameFault.code;
        throw error;
      }
      return actual.rename(from, to);
    },
  };
});

const { renameWithRetry, writeFileAtomic } = await import(
  "@/lib/utils/atomic-file"
);

describe("atomic file writes", () => {
  let dir = "";

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "atomic-"));
    renameFault.remaining = 0;
    renameFault.code = "EPERM";
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("replaces a file that already exists", async () => {
    const file = path.join(dir, "store.json");
    await writeFile(file, '{"v":1}', "utf8");
    await writeFileAtomic(file, '{"v":2}');
    expect(await readFile(file, "utf8")).toBe('{"v":2}');
  });

  it("leaves no temporary file behind", async () => {
    await writeFileAtomic(path.join(dir, "store.json"), "{}");
    expect((await readdir(dir)).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });

  it("waits out a Windows lock rather than failing the caller", async () => {
    // Defender scanning the file we have just written is enough to make
    // Windows refuse the rename, and that killed a free audit mid-import.
    renameFault.remaining = 2;
    const file = path.join(dir, "store.json");
    await writeFile(file, "old", "utf8");

    await writeFileAtomic(file, "new");

    expect(renameFault.remaining).toBe(0);
    expect(await readFile(file, "utf8")).toBe("new");
  });

  it("gives up on an error that waiting cannot fix, and cleans up", async () => {
    renameFault.remaining = 99;
    renameFault.code = "ENOSPC";
    const source = path.join(dir, "from.tmp");
    await writeFile(source, "x", "utf8");

    await expect(
      renameWithRetry(source, path.join(dir, "to.json")),
    ).rejects.toThrow(/ENOSPC/);
    expect((await readdir(dir)).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });

  it("stops retrying once the attempts run out", async () => {
    renameFault.remaining = 99;
    const source = path.join(dir, "from.tmp");
    await writeFile(source, "x", "utf8");

    await expect(
      renameWithRetry(source, path.join(dir, "to.json")),
    ).rejects.toThrow(/EPERM/);
    // Four retries after the first attempt, and no more.
    expect(renameFault.remaining).toBe(94);
  });
});
