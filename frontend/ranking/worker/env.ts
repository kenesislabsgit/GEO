import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Environment bootstrap for the worker. Next.js loads .env.local for the web
 * app; this standalone process must do it itself. Real environments set real
 * variables - files only fill in what is missing, never override.
 */
for (const name of [".env.local", ".env"]) {
  try {
    const text = readFileSync(path.join(process.cwd(), name), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match && process.env[match[1]] === undefined) {
        process.env[match[1]] = match[2].trim();
      }
    }
  } catch {
    // File absent is fine; production uses real env vars.
  }
}
