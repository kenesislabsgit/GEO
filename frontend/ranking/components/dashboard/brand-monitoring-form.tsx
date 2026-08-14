"use client";

import { useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { providerDisplayName, SUPPORTED_COUNTRIES, SUPPORTED_LANGUAGES } from "@/lib/constants";

type MonitoringResponse = {
  settings: {
    enabled?: boolean;
    monitoringFrequency: "daily" | "weekly";
    dayOfWeek?: number;
    hourLocal?: number;
    timezone?: string;
    providers: string[];
    country: string;
    language: string;
    alerts: { scoreDrop?: boolean; competitor?: boolean; citation?: boolean };
  } | null;
  brand: { country: string; language: string; visibility: string };
  plan: {
    id: string;
    dailyMonitoring: boolean;
    providers: string[];
    providersPerScan: number;
  };
};

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function BrandMonitoringForm({
  brandId,
  isPaid,
}: {
  brandId: string;
  isPaid: boolean;
}) {
  const [data, setData] = useState<MonitoringResponse | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    enabled: true,
    frequency: "weekly" as "daily" | "weekly",
    dayOfWeek: 0,
    hourLocal: 9,
    timezone: "UTC",
    providers: [] as string[],
    country: "us",
    language: "en",
    alerts: { scoreDrop: true, competitor: true, citation: false },
  });

  useEffect(() => {
    void (async () => {
      const res = await fetch(`/api/brands/${brandId}/monitoring`);
      if (!res.ok) return;
      const payload = (await res.json()) as MonitoringResponse;
      setData(payload);
      const s = payload.settings;
      setForm({
        enabled: s?.enabled ?? true,
        frequency: s?.monitoringFrequency ?? "weekly",
        dayOfWeek: s?.dayOfWeek ?? 0,
        hourLocal: s?.hourLocal ?? 9,
        timezone:
          s?.timezone ??
          Intl.DateTimeFormat().resolvedOptions().timeZone ??
          "UTC",
        providers: s?.providers ?? [],
        country: (s?.country ?? payload.brand.country ?? "us").toLowerCase(),
        language: (s?.language ?? payload.brand.language ?? "en").toLowerCase(),
        alerts: {
          scoreDrop: s?.alerts?.scoreDrop ?? true,
          competitor: s?.alerts?.competitor ?? true,
          citation: s?.alerts?.citation ?? false,
        },
      });
    })();
  }, [brandId]);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/brands/${brandId}/monitoring`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: form.enabled,
          frequency: form.frequency,
          dayOfWeek: form.dayOfWeek,
          hourLocal: form.hourLocal,
          timezone: form.timezone,
          providers: form.providers,
          country: form.country,
          language: form.language,
          alerts: form.alerts,
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "Could not save settings");
      toast.success("Monitoring settings saved.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save settings",
      );
    } finally {
      setSaving(false);
    }
  }

  if (!isPaid) {
    return (
      <div className="rb-panel p-6 text-sm text-muted-foreground">
        Scheduled monitoring and alerts are part of the paid plans. Your saved
        report stays available on the free plan.
      </div>
    );
  }
  if (!data) {
    return (
      <div className="rb-panel flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading settings…
      </div>
    );
  }

  const toggleProvider = (id: string) => {
    setForm((prev) => {
      const has = prev.providers.includes(id);
      if (has) {
        return { ...prev, providers: prev.providers.filter((p) => p !== id) };
      }
      if (prev.providers.length >= data.plan.providersPerScan) return prev;
      return { ...prev, providers: [...prev.providers, id] };
    });
  };

  const selectClass =
    "h-9 rounded-md border border-border bg-background px-2 text-sm";

  return (
    <div className="space-y-4">
      <section className="rb-panel space-y-5 p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Scheduled monitoring</p>
            <p className="text-xs text-muted-foreground">
              Re-audits this website automatically and raises alerts on change.
            </p>
          </div>
          <Switch
            checked={form.enabled}
            onCheckedChange={(enabled) => setForm((p) => ({ ...p, enabled }))}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="flex flex-col gap-1.5 text-sm">
            Frequency
            <select
              className={selectClass}
              value={form.frequency}
              onChange={(e) =>
                setForm((p) => ({
                  ...p,
                  frequency: e.target.value as "daily" | "weekly",
                }))
              }
            >
              <option value="weekly">Weekly</option>
              {data.plan.dailyMonitoring ? (
                <option value="daily">Daily</option>
              ) : null}
            </select>
          </label>
          {form.frequency === "weekly" ? (
            <label className="flex flex-col gap-1.5 text-sm">
              Day
              <select
                className={selectClass}
                value={form.dayOfWeek}
                onChange={(e) =>
                  setForm((p) => ({ ...p, dayOfWeek: Number(e.target.value) }))
                }
              >
                {DAYS.map((day, index) => (
                  <option key={day} value={index}>
                    {day}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="flex flex-col gap-1.5 text-sm">
            From (local hour)
            <select
              className={selectClass}
              value={form.hourLocal}
              onChange={(e) =>
                setForm((p) => ({ ...p, hourLocal: Number(e.target.value) }))
              }
            >
              {Array.from({ length: 24 }, (_, hour) => (
                <option key={hour} value={hour}>
                  {String(hour).padStart(2, "0")}:00
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            Timezone
            <input
              className={selectClass}
              value={form.timezone}
              onChange={(e) =>
                setForm((p) => ({ ...p, timezone: e.target.value }))
              }
            />
          </label>
        </div>
      </section>

      <section className="rb-panel space-y-4 p-6">
        <div>
          <p className="text-sm font-medium">Market</p>
          <p className="text-xs text-muted-foreground">
            Country and language used for scheduled audits of this website.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-sm">
            Country
            <select
              className={selectClass}
              value={form.country}
              onChange={(e) =>
                setForm((p) => ({ ...p, country: e.target.value }))
              }
            >
              {SUPPORTED_COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            Language
            <select
              className={selectClass}
              value={form.language}
              onChange={(e) =>
                setForm((p) => ({ ...p, language: e.target.value }))
              }
            >
              {SUPPORTED_LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="rb-panel space-y-4 p-6">
        <div>
          <p className="text-sm font-medium">
            Providers ({form.providers.length} of {data.plan.providersPerScan})
          </p>
          <p className="text-xs text-muted-foreground">
            Which AI providers scheduled audits ask. Empty means the plan
            default.
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {data.plan.providers.map((provider) => (
            <label
              key={provider}
              className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"
            >
              <input
                type="checkbox"
                checked={form.providers.includes(provider)}
                onChange={() => toggleProvider(provider)}
              />
              {providerDisplayName(provider)}
            </label>
          ))}
        </div>
      </section>

      <section className="rb-panel space-y-4 p-6">
        <div>
          <p className="text-sm font-medium">Alerts</p>
          <p className="text-xs text-muted-foreground">
            What raises an alert (and an email, on plans with email alerts).
          </p>
        </div>
        {(
          [
            ["scoreDrop", "Score moves by 5 points or more"],
            ["competitor", "A competitor appears or disappears"],
            ["citation", "A cited source appears or disappears"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="flex items-center justify-between text-sm">
            {label}
            <Switch
              checked={form.alerts[key]}
              onCheckedChange={(value) =>
                setForm((p) => ({
                  ...p,
                  alerts: { ...p.alerts, [key]: value },
                }))
              }
            />
          </label>
        ))}
      </section>

      <Button onClick={save} disabled={saving}>
        {saving ? (
          <Loader2 data-icon="inline-start" className="animate-spin" />
        ) : (
          <Save data-icon="inline-start" />
        )}
        Save settings
      </Button>
    </div>
  );
}
