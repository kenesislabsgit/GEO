export function normalizePromptText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function wordJaccardSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.split(" ").filter(Boolean));
  const wordsB = new Set(b.split(" ").filter(Boolean));
  if (wordsA.size === 0 && wordsB.size === 0) return 1;
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let intersection = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) intersection += 1;
  }
  const union = new Set([...wordsA, ...wordsB]).size;
  return intersection / union;
}

export function promptTextsAreDuplicate(a: string, b: string): boolean {
  const left = normalizePromptText(a);
  const right = normalizePromptText(b);
  if (!left || !right) return false;
  if (left === right) return true;

  if (left.includes(right) || right.includes(left)) {
    const shorter = Math.min(left.length, right.length);
    const longer = Math.max(left.length, right.length);
    if (shorter / longer >= 0.9) return true;
  }

  return wordJaccardSimilarity(left, right) >= 0.85;
}

export function findDuplicatePrompt(
  candidate: string,
  existing: Array<{ id: string; prompt: string }>,
  excludeId?: string,
): { id: string; prompt: string } | null {
  for (const row of existing) {
    if (excludeId && row.id === excludeId) continue;
    if (promptTextsAreDuplicate(candidate, row.prompt)) return row;
  }
  return null;
}
