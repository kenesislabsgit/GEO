/**
 * Structured logging: one JSON object per line, so any log collector can
 * parse it. Fields are explicit - never log secrets, session tokens, raw
 * payment payloads, or free-text user data.
 */

type Fields = Record<string, string | number | boolean | null | undefined>;

function write(level: "info" | "warn" | "error", event: string, fields: Fields) {
  const line = JSON.stringify({
    at: new Date().toISOString(),
    level,
    event,
    ...fields,
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  info: (event: string, fields: Fields = {}) => write("info", event, fields),
  warn: (event: string, fields: Fields = {}) => write("warn", event, fields),
  error: (event: string, fields: Fields = {}) => write("error", event, fields),
};
