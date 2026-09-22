export function average(values: number[]): number | null {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
}

/** Compare only websites represented in both periods. */
export function comparableDelta<T>(
  cards: Array<{ latest?: T; previous?: T }>,
  value: (score: T) => number,
): number | null {
  return average(
    cards.flatMap(({ latest, previous }) =>
      latest !== undefined && previous !== undefined
        ? [value(latest) - value(previous)]
        : [],
    ),
  );
}

export type OverviewSnapshot = {
  brand_id: string;
  created_at: string;
  overall_score: number;
  mention_rate: number;
  is_baseline: boolean;
};

/** Carry each website's latest score forward, keeping the cohort fixed. */
export function accountTrend(snapshots: OverviewSnapshot[]) {
  const brandCount = new Set(snapshots.map((row) => row.brand_id)).size;
  const latest = new Map<string, OverviewSnapshot>();
  const rows: Array<{
    created_at: string;
    overall_score: number;
    mention_rate: number;
  }> = [];
  const ordered = [...snapshots].sort(
    (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at),
  );
  for (let index = 0; index < ordered.length;) {
    const at = ordered[index].created_at;
    let visible = false;
    do {
      const row = ordered[index++];
      latest.set(row.brand_id, row);
      visible ||= !row.is_baseline;
    } while (
      index < ordered.length &&
      Date.parse(ordered[index].created_at) === Date.parse(at)
    );
    if (!visible || latest.size !== brandCount) continue;
    const values = [...latest.values()];
    rows.push({
      created_at: at,
      overall_score: average(values.map((row) => row.overall_score))!,
      mention_rate: average(values.map((row) => row.mention_rate))!,
    });
  }
  return rows;
}
