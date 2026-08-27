import type { ProviderId } from "@/types/database";

export type MonitoringFrequency = "weekly" | "daily";

export type AlertPreferences = {
  scoreDrop: boolean;
  competitor: boolean;
  citation: boolean;
};

export type BrandMonitoringSettings = {
  monitoringFrequency: MonitoringFrequency;
  alerts: AlertPreferences;
  providers: ProviderId[];
  /** The fixed five questions repeated by every monitoring audit. */
  monitoringQuestions: string[];
  country: string;
  language: string;
  enabled?: boolean;
  /** 0 = Monday .. 6 = Sunday; weekly schedules only. */
  dayOfWeek?: number;
  hourLocal?: number;
  timezone?: string;
  updatedAt: string;
};
