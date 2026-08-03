import { rename, rm, writeFile } from "node:fs/promises";

/**
 * Replacing a file by renaming a temporary one over it is atomic on POSIX and
 * usually atomic on Windows, but Windows refuses the rename while anything
 * still holds the destination or the temporary file open. Defender scanning a
 * file we have just written is enough, and a free audit died mid-import with
 *
 *   EPERM: operation not permitted, rename
 *   '.data/local-store.json.18448.1785768733926.tmp' -> '.data/local-store.json'
 *
 * The lock is momentary, so the fix is to wait and try again rather than to
 * give up or to abandon atomic writes. Four retries over roughly 300ms covers
 * a scan; anything longer is a real problem and should surface as one.
 */
const RETRY_DELAYS_MS = [20, 40, 80, 160];
const TRANSIENT_WINDOWS_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);

function isTransient(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return typeof code === "string" && TRANSIENT_WINDOWS_CODES.has(code);
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Rename over an existing file, retrying while Windows holds it open. */
export async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      if (attempt >= RETRY_DELAYS_MS.length || !isTransient(error)) {
        // A temporary file left behind is confusing on its own, and after a
        // few failures the directory fills with them.
        await rm(from, { force: true }).catch(() => {});
        throw error;
      }
      await wait(RETRY_DELAYS_MS[attempt]);
    }
  }
}

/** Write a file so readers see either the old contents or the new ones. */
export async function writeFileAtomic(
  file: string,
  contents: string,
): Promise<void> {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, contents, "utf8");
  await renameWithRetry(tmp, file);
}
