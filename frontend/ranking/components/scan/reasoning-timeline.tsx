"use client";

import { Check } from "lucide-react";
import { ThinkingOrb, type OrbState } from "thinking-orbs";
import { cn } from "@/lib/utils";
import {
  assistantNames,
  stageLabel,
  type AuditStage,
} from "@/lib/audit/progress-copy";
import type { AuditFeedEvent } from "@/components/scan/use-detached-audit";
import { ProviderLogo } from "@/components/providers/provider-logo";

/** Which orb animation fits each audit stage. */
const ORB_STATE_BY_STAGE: Record<string, OrbState> = {
  read: "searching",
  understand: "solving",
  questions: "composing",
  asking: "connecting",
  counting: "working",
  knowledge: "searching",
  rivals: "weaving",
  gaps: "shaping",
  actions: "composing",
  finish: "working",
};

export function orbStateForStage(stageId: string | undefined): OrbState {
  return ORB_STATE_BY_STAGE[stageId ?? ""] ?? "working";
}

/**
 * The audit as a chain of reasoning steps: done stages collapse to a quiet
 * check, the active stage carries a shimmering label and a live feed of what
 * the engine is actually doing right now, pending stages wait dimmed. One
 * component for every place an audit shows progress.
 */
export function ReasoningTimeline({
  stages,
  activeIndex,
  complete,
  providers,
  events = [],
}: {
  stages: readonly AuditStage[];
  activeIndex: number;
  complete: boolean;
  providers: readonly string[];
  events?: AuditFeedEvent[];
}) {
  return (
    <ol className="mt-4">
      {stages.map((stage, index) => {
        const done = complete || index < activeIndex;
        const active = !complete && index === activeIndex;
        const last = index === stages.length - 1;
        return (
          <li key={stage.id} className="flex gap-3">
            {/* Marker + connector. The running stage gets its thinking orb. */}
            <div className="flex flex-col items-center">
              {active ? (
                <ThinkingOrb
                  state={orbStateForStage(stage.id)}
                  size={20}
                  aria-label={`${stage.id} in progress`}
                />
              ) : (
                <span
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full border",
                    done
                      ? "border-foreground bg-foreground text-background"
                      : "border-border",
                  )}
                >
                  {done ? <Check className="size-3" aria-hidden /> : null}
                </span>
              )}
              {!last ? (
                <span
                  aria-hidden
                  className={cn(
                    "w-px flex-1",
                    done ? "bg-foreground/30" : "bg-border",
                  )}
                />
              ) : null}
            </div>

            {/* Label + live reasoning while this stage runs */}
            <div className={cn("min-w-0 flex-1", last ? "" : "pb-4")}>
              <p
                className={cn(
                  "pt-0.5 text-sm",
                  done
                    ? "text-muted-foreground"
                    : active
                      ? "font-medium"
                      : "text-muted-foreground/70",
                )}
              >
                {active ? (
                  <span className="rb-shimmer">{stageLabel(stage, providers)}</span>
                ) : (
                  stageLabel(stage, providers)
                )}
              </p>
              {active ? <ReasoningFeed events={events} /> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** What the engine just did, as short lines under the running stage. */
function ReasoningFeed({ events }: { events: AuditFeedEvent[] }) {
  const lines: Array<{ provider: string | null; text: string }> = [];
  for (const event of events) {
    let line: { provider: string | null; text: string } | null = null;
    if (event.assistant && event.questions.length) {
      const name = assistantNames([event.assistant])[0] ?? "Assistant";
      line = {
        provider: event.assistant,
        text: `${name} answered “${event.questions[0]}”${
          event.questions.length > 1
            ? ` and ${event.questions.length - 1} more`
            : ""
        }`,
      };
    } else if (event.message) {
      line = { provider: null, text: event.message };
    }
    if (line && lines[lines.length - 1]?.text !== line.text) lines.push(line);
  }
  const recent = lines.slice(-4);

  return (
    <div className="mt-2 space-y-1.5 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
      {recent.map((line, index) => (
        <p
          key={`${index}-${line.text}`}
          className={cn(
            "flex items-start gap-1.5 text-xs leading-relaxed",
            index === recent.length - 1
              ? "rb-fade-up text-foreground"
              : "text-muted-foreground",
          )}
        >
          {line.provider ? (
            <ProviderLogo provider={line.provider} className="mt-0.5 size-3" />
          ) : null}
          <span className="min-w-0 break-words">{line.text}</span>
        </p>
      ))}
      <p className="rb-shimmer w-fit text-xs font-medium">Thinking…</p>
    </div>
  );
}
