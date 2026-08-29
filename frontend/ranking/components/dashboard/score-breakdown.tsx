import { SCORE_WEIGHTS } from "@/lib/constants";
import { scoreBreakdownParts } from "@/lib/scores/format";

export function ScoreBreakdown({
  snapshot,
  tone = "default",
}: {
  snapshot: {
    mention_score?: unknown;
    position_score?: unknown;
    breakdown?: unknown;
  };
  tone?: "default" | "onDark";
}) {
  const parts = scoreBreakdownParts(snapshot);
  if (parts.mention == null && parts.position == null && parts.evidence == null) {
    return null;
  }
  const muted = tone === "onDark" ? "text-white/50" : "text-muted-foreground";
  const value = tone === "onDark" ? "text-white" : "text-foreground";
  const rows = [
    {
      label: "Mention",
      score: parts.mention,
      weight: Math.round(SCORE_WEIGHTS.mention * 100),
    },
    {
      label: "Position",
      score: parts.position,
      weight: Math.round(SCORE_WEIGHTS.position * 100),
    },
    {
      label: "Evidence quality",
      score: parts.evidence,
      weight: Math.round(SCORE_WEIGHTS.dataConfidence * 100),
    },
  ].filter((row) => row.score != null);

  return (
    <div className={`mt-3 grid grid-cols-3 gap-3 ${muted}`}>
      {rows.map((row) => (
        <div key={row.label}>
          <p className="text-[11px] font-medium tracking-wide uppercase">
            {row.label}
            <span className="ml-1 font-normal opacity-70">{row.weight}%</span>
          </p>
          <p className={`arc-tabular mt-0.5 text-sm font-semibold ${value}`}>
            {row.score}
          </p>
        </div>
      ))}
    </div>
  );
}
