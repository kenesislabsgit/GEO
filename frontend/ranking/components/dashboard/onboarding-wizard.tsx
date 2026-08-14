"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronLeft, ChevronRight, Loader2, Play } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  ONBOARDING_STEP_COUNT,
  ONBOARDING_STEPS,
  type OnboardingState,
} from "@/types/onboarding";
import type { ProviderId } from "@/types/database";
import {
  providerDisplayName,
  SUPPORTED_COUNTRIES,
  SUPPORTED_LANGUAGES,
} from "@/lib/constants";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";

type PromptRow = {
  id: string;
  prompt: string;
  prompt_type: string;
  buyer_stage: string;
  country: string;
  language: string;
  active: boolean;
};

type PlanInfo = {
  id: string;
  name: string;
  providers: ProviderId[];
  providersPerScan: number;
  competitorsPerBrand: number;
  countries: number;
  languages: number;
  weeklyMonitoring: boolean;
  dailyMonitoring: boolean;
  emailAlerts: boolean;
};

export function OnboardingWizard({
  initialState,
  initialPlan,
  initialPrompts,
}: {
  initialState: OnboardingState;
  initialPlan: PlanInfo;
  initialPrompts: PromptRow[];
}) {
  const router = useRouter();
  const [state, setState] = useState(initialState);
  const [plan] = useState(initialPlan);
  const [prompts, setPrompts] = useState(initialPrompts);
  const [saving, setSaving] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const step = state.currentStep;
  const countryOptions = useMemo(
    () => SUPPORTED_COUNTRIES.slice(0, Math.max(plan.countries, 1)),
    [plan.countries],
  );
  const languageOptions = useMemo(
    () => SUPPORTED_LANGUAGES.slice(0, Math.max(plan.languages, 1)),
    [plan.languages],
  );

  const saveState = useCallback(
    async (patch: Partial<OnboardingState>, nextStep?: number) => {
      setSaving(true);
      setError(null);
      try {
        const res = await fetch(routes.api.onboarding, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...patch,
            ...(nextStep !== undefined ? { currentStep: nextStep } : {}),
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to save progress");
        setState(data.state as OnboardingState);
        return data.state as OnboardingState;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to save";
        setError(message);
        toast.error(message);
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (state.brandId) {
      fetch(`${routes.api.prompts}?brandId=${encodeURIComponent(state.brandId)}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.prompts) setPrompts(data.prompts);
        })
        .catch(() => undefined);
    }
  }, [state.brandId]);

  function togglePrompt(id: string) {
    setState((prev) => {
      const active = new Set(prev.activePromptIds);
      if (active.has(id)) active.delete(id);
      else active.add(id);
      return { ...prev, activePromptIds: [...active] };
    });
  }

  function toggleProvider(id: string) {
    setState((prev) => {
      const selected = new Set(prev.providers);
      if (selected.has(id as OnboardingState["providers"][number])) {
        if (selected.size === 1) return prev;
        selected.delete(id as OnboardingState["providers"][number]);
      } else {
        // The plan offers more providers than one audit can run.
        if (selected.size >= plan.providersPerScan) return prev;
        selected.add(id as OnboardingState["providers"][number]);
      }
      return { ...prev, providers: [...selected] as OnboardingState["providers"] };
    });
  }

  function updateCompetitor(
    index: number,
    field: "name" | "domain",
    value: string,
  ) {
    setState((prev) => {
      const next = [...prev.competitors];
      const row = next[index];
      if (!row) return prev;
      next[index] = {
        ...row,
        [field]: field === "domain" ? value || null : value,
      };
      return { ...prev, competitors: next };
    });
  }

  function addCompetitor() {
    if (state.competitors.length >= plan.competitorsPerBrand) return;
    setState((prev) => ({
      ...prev,
      competitors: [...prev.competitors, { name: "", domain: null }],
    }));
  }

  function removeCompetitor(index: number) {
    setState((prev) => ({
      ...prev,
      competitors: prev.competitors.filter((_, i) => i !== index),
    }));
  }

  async function goNext() {
    if (step === 1 && !state.company.name.trim()) {
      setError("Company name is required.");
      return;
    }
    if (step === 3 && state.activePromptIds.length === 0) {
      setError("Select at least one buyer question.");
      return;
    }
    if (step === 4 && state.providers.length === 0) {
      setError("Select at least one provider.");
      return;
    }

    const patch: Partial<OnboardingState> = {
      company: state.company,
      competitors: state.competitors.filter((c) => c.name.trim()),
      activePromptIds: state.activePromptIds,
      providers: state.providers,
      country: state.country,
      language: state.language,
      monitoringFrequency: state.monitoringFrequency,
      alerts: state.alerts,
    };

    try {
      await saveState(patch, Math.min(step + 1, ONBOARDING_STEP_COUNT));
    } catch {
      // error surfaced via toast
    }
  }

  async function goBack() {
    if (step <= 1) return;
    try {
      await saveState({}, step - 1);
    } catch {
      // error surfaced via toast
    }
  }

  async function finishOnboarding() {
    setFinishing(true);
    setError(null);
    try {
      await saveState({
        company: state.company,
        competitors: state.competitors.filter((c) => c.name.trim()),
        activePromptIds: state.activePromptIds,
        providers: state.providers,
        country: state.country,
        language: state.language,
        monitoringFrequency: state.monitoringFrequency,
        alerts: state.alerts,
        currentStep: 8,
      });

      const res = await fetch(`${routes.api.onboarding}/complete`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to start scan");
      router.push(routes.scanProgress(data.scanRunId));
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to complete onboarding";
      setError(message);
      toast.error(message);
      setFinishing(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Premium setup · Step {step} of {ONBOARDING_STEP_COUNT}
        </p>
        <h1 className="mt-2 font-heading text-2xl font-semibold tracking-tight">
          {ONBOARDING_STEPS[step - 1]}
        </h1>
        <div className="mt-4 flex gap-1">
          {ONBOARDING_STEPS.map((label, index) => (
            <div
              key={label}
              className={cn(
                "h-1 flex-1 rounded-full",
                index < step ? "bg-foreground" : "bg-muted",
              )}
              title={label}
            />
          ))}
        </div>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Something went wrong</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {step === 1 ? (
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="company-name">Company name</FieldLabel>
            <Input
              id="company-name"
              value={state.company.name}
              onChange={(e) =>
                setState((prev) => ({
                  ...prev,
                  company: { ...prev.company, name: e.target.value },
                }))
              }
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="company-category">Category</FieldLabel>
            <Input
              id="company-category"
              value={state.company.category}
              onChange={(e) =>
                setState((prev) => ({
                  ...prev,
                  company: { ...prev.company, category: e.target.value },
                }))
              }
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="company-domain">Domain</FieldLabel>
            <Input id="company-domain" value={state.company.domain} disabled />
          </Field>
          <Field>
            <FieldLabel htmlFor="company-description">Description</FieldLabel>
            <Textarea
              id="company-description"
              value={state.company.description}
              onChange={(e) =>
                setState((prev) => ({
                  ...prev,
                  company: { ...prev.company, description: e.target.value },
                }))
              }
              rows={4}
            />
          </Field>
        </FieldGroup>
      ) : null}

      {step === 2 ? (
        <div className="space-y-4">
          <FieldDescription>
            Up to {plan.competitorsPerBrand} competitors on the {plan.name} plan.
          </FieldDescription>
          {state.competitors.map((competitor, index) => (
            <div
              key={`competitor-${index}`}
              className="grid gap-3 rb-panel p-4 sm:grid-cols-[1fr_1fr_auto]"
            >
              <Input
                placeholder="Competitor name"
                value={competitor.name}
                onChange={(e) => updateCompetitor(index, "name", e.target.value)}
              />
              <Input
                placeholder="domain.com"
                value={competitor.domain ?? ""}
                onChange={(e) => updateCompetitor(index, "domain", e.target.value)}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => removeCompetitor(index)}
              >
                Remove
              </Button>
            </div>
          ))}
          {state.competitors.length < plan.competitorsPerBrand ? (
            <Button type="button" variant="outline" size="sm" onClick={addCompetitor}>
              Add competitor
            </Button>
          ) : null}
        </div>
      ) : null}

      {step === 3 ? (
        <div className="rb-list">
          <div className="divide-y divide-border">
            {prompts.map((prompt) => {
              const active = state.activePromptIds.includes(prompt.id);
              return (
                <label
                  key={prompt.id}
                  className="flex cursor-pointer items-start gap-3 bg-card px-5 py-3.5 hover:bg-muted/40"
                >
                  <Checkbox
                    checked={active}
                    onCheckedChange={() => togglePrompt(prompt.id)}
                    className="mt-0.5"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{prompt.prompt}</p>
                    <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                      {prompt.buyer_stage} · {prompt.country}/{prompt.language}
                    </p>
                  </div>
                  <Badge variant="secondary" className="shrink-0 text-[11px]">
                    {prompt.prompt_type.replaceAll("_", " ")}
                  </Badge>
                </label>
              );
            })}
          </div>
        </div>
      ) : null}

      {step === 4 ? (
        <div className="space-y-3">
          {plan.providers.length > plan.providersPerScan ? (
            <p className="text-xs text-muted-foreground">
              {state.providers.length} of {plan.providersPerScan} selected - 
              deselect one to swap in another.
            </p>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-3">
          {plan.providers.map((provider) => {
            const selected = state.providers.includes(provider);
            return (
              <button
                key={provider}
                type="button"
                onClick={() => toggleProvider(provider)}
                className={cn(
                  "rounded-xl border p-4 text-left transition-colors",
                  selected
                    ? "border-foreground bg-muted/50"
                    : "border-border bg-card hover:bg-muted/30",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">
                    {providerDisplayName(provider)}
                  </span>
                  {selected ? <Check className="size-4" /> : null}
                </div>
              </button>
            );
          })}
          </div>
        </div>
      ) : null}

      {step === 5 ? (
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="onboarding-country">Country</FieldLabel>
            <select
              id="onboarding-country"
              className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
              value={state.country}
              onChange={(e) =>
                setState((prev) => ({ ...prev, country: e.target.value }))
              }
            >
              {countryOptions.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
          <Field>
            <FieldLabel htmlFor="onboarding-language">Language</FieldLabel>
            <select
              id="onboarding-language"
              className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
              value={state.language}
              onChange={(e) =>
                setState((prev) => ({ ...prev, language: e.target.value }))
              }
            >
              {languageOptions.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </Field>
        </FieldGroup>
      ) : null}

      {step === 6 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {(
            [
              {
                id: "weekly" as const,
                label: "Weekly",
                enabled: plan.weeklyMonitoring,
              },
              {
                id: "daily" as const,
                label: "Daily",
                enabled: plan.dailyMonitoring,
              },
            ] as const
          ).map((option) => (
            <button
              key={option.id}
              type="button"
              disabled={!option.enabled}
              onClick={() =>
                setState((prev) => ({
                  ...prev,
                  monitoringFrequency: option.id,
                }))
              }
              className={cn(
                "rounded-xl border p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                state.monitoringFrequency === option.id
                  ? "border-foreground bg-muted/50"
                  : "border-border bg-card",
              )}
            >
              <p className="text-sm font-medium">{option.label}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {option.enabled
                  ? "Automated scans on this schedule"
                  : "Upgrade required"}
              </p>
            </button>
          ))}
        </div>
      ) : null}

      {step === 7 ? (
        <div className="space-y-3">
          {!plan.emailAlerts ? (
            <FieldDescription>
              Email alerts are not included on your plan. In-app alerts still apply.
            </FieldDescription>
          ) : null}
          {(
            [
              ["scoreDrop", "Score drop alerts"],
              ["competitor", "Competitor mention alerts"],
              ["citation", "Citation change alerts"],
            ] as const
          ).map(([key, label]) => (
            <label
              key={key}
              className="flex items-center gap-3 rb-panel px-5 py-3.5"
            >
              <Checkbox
                checked={state.alerts[key]}
                disabled={!plan.emailAlerts}
                onCheckedChange={(checked) =>
                  setState((prev) => ({
                    ...prev,
                    alerts: {
                      ...prev.alerts,
                      [key]: checked === true,
                    },
                  }))
                }
              />
              <span className="text-sm">{label}</span>
            </label>
          ))}
        </div>
      ) : null}

      {step === 8 ? (
        <div className="rb-panel p-6">
          <p className="text-sm text-muted-foreground">
            We&apos;ll apply your company details, competitors, active questions,
            providers ({state.providers.map(providerDisplayName).join(", ")}),
            and region ({state.country.toUpperCase()}/{state.language}) - then
            run your first premium scan.
          </p>
          <p className="mt-3 text-sm">
            Monitoring:{" "}
            <span className="font-medium capitalize">
              {state.monitoringFrequency}
            </span>
          </p>
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-3 border-t border-border pt-6">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={goBack}
          disabled={step <= 1 || saving || finishing}
        >
          <ChevronLeft data-icon="inline-start" />
          Back
        </Button>

        {step < ONBOARDING_STEP_COUNT ? (
          <Button
            type="button"
            size="sm"
            onClick={goNext}
            disabled={saving || finishing}
          >
            {saving ? (
              <>
                <Loader2 data-icon="inline-start" className="animate-spin" />
                Saving…
              </>
            ) : (
              <>
                Continue
                <ChevronRight data-icon="inline-end" />
              </>
            )}
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            onClick={finishOnboarding}
            disabled={saving || finishing}
          >
            {finishing ? (
              <>
                <Loader2 data-icon="inline-start" className="animate-spin" />
                Starting scan…
              </>
            ) : (
              <>
                Run first scan
                <Play data-icon="inline-end" />
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
