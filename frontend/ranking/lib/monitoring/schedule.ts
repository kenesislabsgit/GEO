import type { MonitoringFrequency } from "@/types/onboarding";

const DAY_MS = 24 * 60 * 60 * 1000;

export function isMonitoringScanDue(
  lastCompletedAt: string | null | undefined,
  frequency: MonitoringFrequency,
): boolean {
  if (!lastCompletedAt) return true;
  const elapsed = Date.now() - new Date(lastCompletedAt).getTime();
  const threshold = frequency === "daily" ? DAY_MS : 7 * DAY_MS;
  return elapsed >= threshold;
}

export function nextScheduledScanLabel(
  lastCompletedAt: string | null | undefined,
  frequency: MonitoringFrequency,
): string {
  if (!lastCompletedAt) return frequency === "daily" ? "Daily (pending first scan)" : "Weekly (pending first scan)";
  const elapsed = Date.now() - new Date(lastCompletedAt).getTime();
  const threshold = frequency === "daily" ? DAY_MS : 7 * DAY_MS;
  const remaining = Math.max(0, threshold - elapsed);
  const days = Math.ceil(remaining / DAY_MS);
  if (days <= 0) return "Due now";
  return `In ~${days} day${days === 1 ? "" : "s"}`;
}
