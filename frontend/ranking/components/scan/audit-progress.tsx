"use client";

import { ThinkingOrb } from "thinking-orbs";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import {
  activeStageIndex,
  auditStages,
  describeAssistants,
  type AuditPlan,
} from "@/lib/audit/progress-copy";
import {
  orbStateForStage,
  ReasoningTimeline,
} from "@/components/scan/reasoning-timeline";
import type { AuditFeedEvent } from "@/components/scan/use-detached-audit";

export function AuditProgress({
  progress,
  step,
  plan,
  providers,
  questionCount,
  events = [],
  className = "mt-4 border-t border-border pt-4",
}: {
  progress: number;
  /** Runner step name from the stream. Null until the first event lands. */
  step: string | null;
  plan: AuditPlan;
  providers: readonly string[];
  questionCount: number;
  /** Live per-answer events; the feed that fills the long provider wait. */
  events?: AuditFeedEvent[];
  /** Wrapper classes - the default suits embedding under a form button. */
  className?: string;
}) {
  const stages = auditStages(plan);
  // Driven by the step the runner reports, not by where the percentage happens
  // to sit. The two disagree: the bar sits at 65 for as long as the assistants
  // take to answer, and a stage list reading the number alone would light up
  // whichever stage that crossed rather than the one actually running.
  const activeIndex = activeStageIndex(stages, step, progress);

  return (
    <div className={cn("min-w-0", className)}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <ThinkingOrb
            state={orbStateForStage(stages[activeIndex]?.id)}
            size={64}
            aria-label="Audit in progress"
            style={{ width: 40, height: 40 }}
          />
          <div className="min-w-0">
            <p className="arc-shimmer w-fit text-sm font-medium">
              Audit in progress
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {questionCount} questions · {describeAssistants(providers)}
            </p>
          </div>
        </div>
        <span className="font-mono text-xs text-muted-foreground">
          {Math.round(progress)}%
        </span>
      </div>
      <Progress value={progress} className="mt-3" />
      <ReasoningTimeline
        stages={stages}
        activeIndex={activeIndex}
        complete={progress >= 100}
        providers={providers}
        events={events}
      />
    </div>
  );
}
