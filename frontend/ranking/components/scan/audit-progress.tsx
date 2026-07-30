import { Check, Circle, Loader2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

const stages = [
  { at: 5, label: "Reading your website" },
  { at: 18, label: "Understanding your company" },
  { at: 32, label: "Creating buyer questions" },
  { at: 48, label: "Asking AI providers" },
  { at: 76, label: "Checking competitors and sources" },
  { at: 92, label: "Building your report" },
] as const;

export function AuditProgress({
  progress,
  message,
  questionCount,
  providerCount,
}: {
  progress: number;
  message: string | null;
  questionCount: number;
  providerCount: number;
}) {
  const activeIndex = Math.max(
    0,
    stages.findLastIndex((stage) => progress >= stage.at),
  );

  return (
    <div className="mt-4 border-t border-border pt-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium">Audit in progress</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {questionCount} questions · {providerCount} AI {providerCount === 1 ? "provider" : "providers"}
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
              key={stage.label}
              className={cn(
                "flex items-center gap-2 text-xs",
                complete || active ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {complete ? (
                <Check className="size-3.5 text-[color:var(--rb-green)]" />
              ) : active ? (
                <Loader2 className="size-3.5 animate-spin text-[color:var(--rb-blue)]" />
              ) : (
                <Circle className="size-3.5" />
              )}
              {stage.label}
            </div>
          );
        })}
      </div>
      {message ? (
        <p className="mt-3 font-mono text-[11px] text-muted-foreground">
          {message}
        </p>
      ) : null}
    </div>
  );
}
