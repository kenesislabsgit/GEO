/**
 * Display rounding for scores. The numbers themselves come from the audit
 * engine's stored snapshots - the frontend formats, it never recomputes.
 */
export function roundForDisplay(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function finiteScore(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? roundForDisplay(n) : null;
}

/** Mention, position, and evidence-quality pieces stored with a snapshot. */
export function scoreBreakdownParts(snapshot: {
  mention_score?: unknown;
  position_score?: unknown;
  breakdown?: unknown;
}): { mention: number | null; position: number | null; evidence: number | null } {
  let evidence: number | null = null;
  const breakdown = snapshot.breakdown;
  if (breakdown && typeof breakdown === "object") {
    const record = breakdown as Record<string, unknown>;
    evidence = finiteScore(record.data_confidence_score);
  }
  return {
    mention: finiteScore(snapshot.mention_score),
    position: finiteScore(snapshot.position_score),
    evidence,
  };
}
