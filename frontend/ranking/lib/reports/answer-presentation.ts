/** Keep the original response available while hiding machine-readable metadata. */
export function readableAnswer(raw: string, summary?: string | null) {
  let structured = false;
  const fallback =
    summary?.trim() || "See the recommended companies and sources below.";
  function extract(value: string): string | null {
    try {
      const parsed: unknown = JSON.parse(value.trim());
      if (!parsed || typeof parsed !== "object") return null;
      structured = true;
      const record = parsed as Record<string, unknown>;
      return (
        [
          record.answer,
          record.answer_text,
          record.response,
          record.summary,
        ].find(
          (text): text is string =>
            typeof text === "string" && Boolean(text.trim()),
        ) ?? ""
      );
    } catch {
      return null;
    }
  }
  const whole = extract(raw);
  const prose =
    whole !== null
      ? whole
      : raw.replace(
          /```(?:json)?\s*([\s\S]*?)```/gi,
          (block, body: string) => extract(body) ?? block,
        );
  return { prose: prose.trim() || fallback, structured };
}
