/**
 * Display rounding for scores. The numbers themselves come from the audit
 * engine's stored snapshots - the frontend formats, it never recomputes.
 */
export function roundForDisplay(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
