/**
 * Display rounding for scores. The numbers themselves come from the audit
 * engine's stored snapshots - the frontend formats, it never recomputes.
 */
export function roundForDisplay(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export const SCORE_DISPLAY_MAX = 100;

/** Clamp visual fills without changing the stored or displayed score. */
export function scoreFillPercent(value: number): number {
  return Number.isFinite(value) ? Math.min(SCORE_DISPLAY_MAX, Math.max(0, value)) : 0;
}
