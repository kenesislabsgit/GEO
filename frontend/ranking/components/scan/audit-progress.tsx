import { Check, Circle, Loader2, MessageSquare } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import {
  activeStageIndex,
  assistantNames,
  auditStages,
  describeAssistants,
  stageLabel,
  type AuditPlan,
} from "@/lib/audit/progress-copy";
import type { AuditFeedEvent } from "@/components/scan/use-detached-audit";

export function AuditProgress({
  progress,
  step,
  plan,
  providers,
  questionCount,
  events = [],
}: {
  progress: number;
  /** Runner step name from the stream. Null until the first event lands. */
  step: string | null;
  plan: AuditPlan;
  providers: readonly string[];
  questionCount: number;
  /** Live per-answer events; the feed that fills the long provider wait. */
  events?: AuditFeedEvent[];
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
      <LiveAnswerFeed events={events} />
    </div>
  );
}

/**
 * The last few provider answers as they land. Newest first, capped short —
 * this is a heartbeat, not a log viewer.
 */
function LiveAnswerFeed({ events }: { events: AuditFeedEvent[] }) {
  const answers = events
    .filter((event) => event.assistant && event.questions.length)
    .slice(-5)
    .reverse();
  if (!answers.length) return null;

  return (
    <div className="mt-4 space-y-1.5 border-t border-border pt-3">
      {answers.map((event, index) => (
        <div
          key={event.seq}
          className={cn(
            "flex items-start gap-2 text-xs",
            index === 0 ? "rb-fade-up text-foreground" : "text-muted-foreground",
          )}
        >
          <MessageSquare className="mt-0.5 size-3 shrink-0" aria-hidden />
          <p className="min-w-0 leading-relaxed">
            <span className="font-medium">
              {assistantNames([event.assistant ?? ""])[0] ?? "Assistant"}
            </span>{" "}
            answered{" "}
            {event.questions.slice(0, 1).map((question) => (
              <span key={question} className="text-muted-foreground">
                &ldquo;{question}&rdquo;
              </span>
            ))}
            {event.questions.length > 1
              ? ` and ${event.questions.length - 1} more`
              : ""}
          </p>
        </div>
      ))}
    </div>
  );
}
