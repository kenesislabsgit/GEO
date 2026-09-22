/** Repair double-escaped prose in older generated recommendations at read time. */
export function reportText(value: string): string {
  return value.replace(/\\+(["'])/g, "$1");
}

export function categoryLabel(value: string): string {
  const text = value.replace(/[_-]+/g, " ").trim();
  return text ? text[0].toUpperCase() + text.slice(1) : "Buyer question";
}

export function utcTimestamp(value: string | null): string {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not recorded" : date.toISOString().replace("T", " ").replace("Z", " UTC");
}

export type ReportSampling = {
  models: Array<{ provider: string; model: string }>;
  answerCount: number;
  failedCount: number;
  repetitions: string;
  settings: string;
  timestampLabel: string;
};

export function reportSampling(rows: Array<{ provider: string; model: string; question: string; error?: string | null; raw_answer: string }>): ReportSampling {
  const counts = new Map<string, number>();
  const models = new Map<string, { provider: string; model: string }>();
  const successful = rows.filter((row) => !row.error && row.raw_answer.trim());
  for (const row of rows) {
    const model = row.model && row.model !== "unknown" ? row.model : "Not recorded";
    models.set(`${row.provider}:${model}`, { provider: row.provider, model });
  }
  for (const row of successful) {
    const key = `${row.provider}:${row.question}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const samples = [...counts.values()];
  const min = samples.length ? Math.min(...samples) : 0;
  const max = samples.length ? Math.max(...samples) : 0;
  return {
    models: [...models.values()], answerCount: successful.length, failedCount: rows.length - successful.length,
    repetitions: `${min === max ? min : `${min}–${max}`} saved ${max === 1 ? "answer" : "answers"} per question/provider pair with a usable response`,
    settings: "Temperature, top-p and random seed were not recorded for this run.",
    timestampLabel: "Scan created",
  };
}
