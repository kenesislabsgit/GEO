import { describe, expect, it } from "vitest";
import {
  accountTrend,
  comparableDelta,
  type OverviewSnapshot,
} from "@/lib/scores/overview";

describe("account overview", () => {
  it("does not treat a newly added website as a score decline", () => {
    expect(
      comparableDelta(
        [
          { latest: { score: 80 }, previous: { score: 80 } },
          { latest: { score: 20 } },
        ],
        (row) => row.score,
      ),
    ).toBe(0);
    expect(comparableDelta([{ latest: 20 }], Number)).toBeNull();
  });

  it("carries forward website scores and waits for a common cohort", () => {
    const row = (
      brand_id: string,
      day: number,
      overall_score: number,
      is_baseline = false,
    ): OverviewSnapshot => ({
      brand_id,
      created_at: `2026-09-${String(day).padStart(2, "0")}T00:00:00Z`,
      overall_score,
      mention_rate: overall_score / 100,
      is_baseline,
    });
    const trend = accountTrend([
      row("a", 1, 80),
      row("b", 2, 20),
      row("a", 3, 100),
    ]);
    expect(trend.map((point) => point.overall_score)).toEqual([50, 60]);
    expect(trend.map((point) => point.mention_rate)).toEqual([0.5, 0.6]);
    expect(trend[0].created_at).toContain("09-02");
  });

  it("uses pre-window baselines without plotting them", () => {
    expect(
      accountTrend([
        {
          brand_id: "a",
          created_at: "2026-01-01",
          overall_score: 80,
          mention_rate: 0.8,
          is_baseline: true,
        },
        {
          brand_id: "b",
          created_at: "2026-09-01",
          overall_score: 40,
          mention_rate: 0.4,
          is_baseline: false,
        },
      ]),
    ).toEqual([
      {
        created_at: "2026-09-01",
        overall_score: 60,
        mention_rate: expect.closeTo(0.6),
      },
    ]);
  });
});
