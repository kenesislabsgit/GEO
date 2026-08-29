"use client";

import { useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { providerDisplayName } from "@/lib/constants";
import { ProviderLogo } from "@/components/providers/provider-logo";

type MonitoringResponse = {
  settings: {
    enabled?: boolean;
    monitoringFrequency: "daily" | "weekly";
    dayOfWeek?: number;
    hourLocal?: number;
    timezone?: string;
    providers: string[];
    monitoringQuestions: string[];
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
  questionSets: Array<{
    scanId: string;
    createdAt: string;
    questions: string[];
  }>;
};

const DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

export function BrandMonitoringForm({
  brandId,
  isPaid,
  canEdit,
}: {
  brandId: string;
  isPaid: boolean;
  canEdit: boolean;
}) {
  const [data, setData] = useState<MonitoringResponse | null>(null);
  const [saving, setSaving] = useState(false);
  const [selectedScanId, setSelectedScanId] = useState("");
  const [choosingQuestions, setChoosingQuestions] = useState(false);
  const [form, setForm] = useState({
    enabled: true,
    frequency: "weekly" as "daily" | "weekly",
    dayOfWeek: 0,
    hourLocal: 9,
    timezone: "UTC",
    providers: [] as string[],
    monitoringQuestions: [] as string[],
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
      const hasSavedQuestions = s?.monitoringQuestions?.length === 5;
      setChoosingQuestions(!hasSavedQuestions);
      const matchingSet = payload.questionSets.find((set) =>
        (s?.monitoringQuestions ?? []).some((question) =>
          set.questions.includes(question),
        ),
      );
      setSelectedScanId(
        matchingSet?.scanId ?? payload.questionSets[0]?.scanId ?? "",
      );
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
        monitoringQuestions: hasSavedQuestions ? s.monitoringQuestions : [],
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
          monitoringQuestions: form.monitoringQuestions,
          country: form.country,
          language: form.language,
          alerts: form.alerts,
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "Could not save settings");
      setChoosingQuestions(false);
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
      <div className="arc-panel p-6 text-sm text-muted-foreground">
        Scheduled monitoring and alerts are part of the paid plans. Your saved
        report stays available on the free plan.
      </div>
    );
  }
  if (!data) {
    return (
      <div className="arc-panel flex items-center gap-2 p-6 text-sm text-muted-foreground">
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

  const selectedQuestionSet = data.questionSets.find(
    (set) => set.scanId === selectedScanId,
  );

  const chooseAudit = (scanId: string) => {
    setSelectedScanId(scanId);
    setForm((prev) => ({
      ...prev,
      monitoringQuestions: [],
    }));
  };

  const toggleQuestion = (question: string) => {
    setForm((prev) => {
      const selected = prev.monitoringQuestions.includes(question);
      if (selected) {
        return {
          ...prev,
          monitoringQuestions: prev.monitoringQuestions.filter(
            (item) => item !== question,
          ),
        };
      }
      if (prev.monitoringQuestions.length >= 5) return prev;
      return {
        ...prev,
        monitoringQuestions: [...prev.monitoringQuestions, question],
      };
    });
  };

  return (
    <div className="space-y-4">
      {!canEdit ? (
        <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          Monthly checks are used up. You can turn monitoring off, but other
          changes resume next billing period.
        </p>
      ) : null}
      <section className="arc-panel space-y-5 p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Scheduled monitoring</p>
            <p className="text-xs text-muted-foreground">
              Re-audits this website automatically and raises alerts on change.
            </p>
          </div>
          <Switch
            checked={form.enabled}
            disabled={!canEdit && !form.enabled}
            onCheckedChange={(enabled) => setForm((p) => ({ ...p, enabled }))}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="flex flex-col gap-1.5 text-sm">
            Frequency
            <select
              disabled={!canEdit}
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
                disabled={!canEdit}
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
              disabled={!canEdit}
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
              disabled={!canEdit}
              className={selectClass}
              value={form.timezone}
              onChange={(e) =>
                setForm((p) => ({ ...p, timezone: e.target.value }))
              }
            />
          </label>
        </div>
      </section>

      <section className="arc-panel space-y-4 p-6">
        <div>
          <p className="text-sm font-medium">Weekly monitoring questions</p>
          <p className="text-xs text-muted-foreground">
            Choose exactly five from a previous audit. The same questions repeat
            each week so changes are comparable.
          </p>
        </div>
        {data.questionSets.length > 0 ? (
          <>
            {form.monitoringQuestions.length > 0 ? (
              <div className="space-y-2">
                {form.monitoringQuestions.map((question, index) => (
                  <div key={index} className="flex items-start gap-2">
                    <textarea
                      disabled={!canEdit}
                      className="min-h-16 flex-1 resize-y rounded-md border border-border bg-background px-3 py-2 text-sm"
                      value={question}
                      onChange={(event) =>
                        setForm((prev) => ({
                          ...prev,
                          monitoringQuestions: prev.monitoringQuestions.map(
                            (item, itemIndex) =>
                              itemIndex === index ? event.target.value : item,
                          ),
                        }))
                      }
                    />
                    {choosingQuestions ? (
                      <button
                        type="button"
                        className="mt-2 text-xs text-muted-foreground hover:text-destructive"
                        onClick={() =>
                          setForm((prev) => ({
                            ...prev,
                            monitoringQuestions:
                              prev.monitoringQuestions.filter(
                                (_, itemIndex) => itemIndex !== index,
                              ),
                          }))
                        }
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => setChoosingQuestions((open) => !open)}
                disabled={!canEdit}
              >
                {choosingQuestions ? "Hide choices" : "Choose questions"}
              </Button>
              <span className="text-xs text-muted-foreground">
                {form.monitoringQuestions.length} of 5 selected
              </span>
            </div>
            {choosingQuestions ? (
              <div className="space-y-3 border-t border-border pt-4">
                <label className="flex flex-col gap-1.5 text-sm">
                  Questions from audit
                  <select
                    disabled={!canEdit}
                    className={selectClass}
                    value={selectedScanId || data.questionSets[0].scanId}
                    onChange={(event) => chooseAudit(event.target.value)}
                  >
                    {data.questionSets.map((set, index) => (
                      <option key={set.scanId} value={set.scanId}>
                        {index === 0 ? "Latest audit" : `Audit ${index + 1}`} —{" "}
                        {new Date(set.createdAt).toLocaleDateString()}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="space-y-2">
                  {(selectedQuestionSet ?? data.questionSets[0]).questions.map(
                    (question) => (
                      <label
                        key={question}
                        className="flex cursor-pointer items-start gap-2 rounded-lg border border-border px-3 py-2 text-sm"
                      >
                        <input
                          type="checkbox"
                          disabled={!canEdit}
                          className="mt-1"
                          checked={form.monitoringQuestions.includes(question)}
                          onChange={() => toggleQuestion(question)}
                        />
                        <span>{question}</span>
                      </label>
                    ),
                  )}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  disabled={form.monitoringQuestions.length !== 5}
                  onClick={() => setChoosingQuestions(false)}
                >
                  Done choosing
                </Button>
              </div>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Finish one audit before enabling monitoring.
          </p>
        )}
      </section>

      <section className="arc-panel space-y-4 p-6">
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
                disabled={!canEdit}
                checked={form.providers.includes(provider)}
                onChange={() => toggleProvider(provider)}
              />
              <ProviderLogo provider={provider} className="size-4 shrink-0" />
              <span className="truncate">{providerDisplayName(provider)}</span>
            </label>
          ))}
        </div>
      </section>

      <section className="arc-panel space-y-4 p-6">
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
          <label
            key={key}
            className="flex items-center justify-between text-sm"
          >
            {label}
            <Switch
              disabled={!canEdit}
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

      <Button
        onClick={save}
        disabled={
          saving ||
          (form.enabled && !canEdit) ||
          (form.enabled && form.monitoringQuestions.length !== 5)
        }
      >
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
