export type UsageWarningLevel = "none" | "warn70" | "warn80" | "exhausted";

export function getUsageWarningLevel(
  used: number,
  limit: number,
): UsageWarningLevel {
  if (limit <= 0) return "none";
  const pct = (used / limit) * 100;
  if (pct >= 100) return "exhausted";
  if (pct >= 80) return "warn80";
  if (pct >= 70) return "warn70";
  return "none";
}

/** Calm one-liner for the dashboard. Not a warning. */
export function usageNudgeCopy(level: UsageWarningLevel): string | null {
  switch (level) {
    case "warn70":
      return "You've used 70% of this month's checks. Upgrade anytime if you want more room.";
    case "warn80":
      return "You've used 80% of this month's checks. Add more from billing if you want to keep going.";
    case "exhausted":
      return "This month's checks are used up. They refresh next period, or you can add more from billing.";
    default:
      return null;
  }
}
