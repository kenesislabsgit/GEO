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

export function usageWarningMessage(level: UsageWarningLevel): string | null {
  switch (level) {
    case "warn70":
      return "You have used 70% of your monthly AI checks. Consider upgrading or pausing low-priority questions.";
    case "warn80":
      return "You have used 80% of your monthly AI checks. Scheduled scans may skip if you hit the limit.";
    case "exhausted":
      return "Monthly AI check limit reached. Upgrade your plan or wait until the next billing period.";
    default:
      return null;
  }
}
