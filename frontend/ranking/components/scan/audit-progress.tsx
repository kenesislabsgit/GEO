import { Check, Circle, Loader2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import {
  activeStageIndex,
  auditStages,
  describeAssistants,
  stageLabel,
  type AuditPlan,
} from "@/lib/audit/progress-copy";

export function AuditProgress({
  progress,
  step,
  plan,
  providers,
  questionCount,
}: {
  progress: number;
  /** Runner step name from the stream. Null until the first event lands. */
  step: string | null;
  plan: AuditPlan;
  providers: readonly string[];
  questionCount: number;
}) {
  const stages = auditStages(plan);
  // Driven by the step the runner reports, not by where the percentage happens
  // to sit. The two disagree: the bar sits at 65 for as long as the assistants
  // take to answer, and a stage list reading the number alone would light up
  // whichever stage that crossed rather than the one actually running.
  const activeIndex = activeStageIndex(stages, step, progress);

  return (
    <div className="mt-4 border-t border-border pt-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium">Audit in progress</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {questionCount} questions · {describeAssistants(providers)}
          </p>
        </div>
        <span className="font-mono text-xs text-muted-foreground">
          {Math.round(progress)}%
        </span>
      </div>
      <Progress value={progress} className="mt-3" />
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {stages.map((stage, index) => {
          const complete = index < activeIndex || progress >= 100;
          const active = index === activeIndex && progress < 100;
          return (
            <div
              key={stage.id}
              data-stage={stage.id}
              data-state={complete ? "complete" : active ? "active" : "pending"}
              className={cn(
                "flex items-center gap-2 text-xs",
                complete || active ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {complete ? (
                <Check className="size-3.5 shrink-0 text-[color:var(--rb-green)]" />
              ) : active ? (
                <Loader2 className="size-3.5 shrink-0 animate-spin text-[color:var(--rb-blue)]" />
              ) : (
                <Circle className="size-3.5 shrink-0" />
              )}
              {stageLabel(stage, providers)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
