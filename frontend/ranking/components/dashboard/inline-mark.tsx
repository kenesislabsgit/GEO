import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A name or company, with a one-letter mark, sitting inside a sentence. */
export function EntityMark({ name }: { name: string }) {
  const letter = name.trim().slice(0, 1).toUpperCase() || "?";
  return (
    <span className="mx-0.5 inline-flex translate-y-px items-center gap-1 rounded-full border border-border bg-muted/70 py-0.5 pr-2 pl-0.5 align-middle text-[13px] font-medium text-foreground">
      <span
        className="flex size-4 shrink-0 items-center justify-center rounded-full bg-[color:var(--arc-amber)] text-[10px] font-semibold text-background"
        aria-hidden
      >
        {letter}
      </span>
      {name}
    </span>
  );
}

/** A number or short fact that should pop without leaving the sentence. */
export function ValueMark({
  children,
  tone = "good",
}: {
  children: ReactNode;
  tone?: "good" | "warn" | "neutral";
}) {
  return (
    <span
      className={cn(
        "mx-0.5 inline-flex translate-y-px items-center rounded-md px-1.5 py-0.5 align-middle font-mono text-[12px] font-medium",
        tone === "good" &&
          "bg-[color:var(--arc-green)]/12 text-[color:var(--arc-green)]",
        tone === "warn" &&
          "bg-[color:var(--arc-amber)]/15 text-[color:var(--arc-amber)]",
        tone === "neutral" && "bg-muted text-foreground",
      )}
    >
      {children}
    </span>
  );
}

/** A source domain, like a citation sitting in the line. */
export function SourceMark({
  href,
  label,
}: {
  href?: string | null;
  label: string;
}) {
  const inner = (
    <span className="inline-flex translate-y-px items-center gap-1 rounded-full border border-border bg-muted/60 px-1.5 py-0.5 align-middle text-[12px] text-foreground">
      <span
        className="size-1.5 rounded-full bg-[color:var(--arc-green)]"
        aria-hidden
      />
      {label}
    </span>
  );
  if (!href) return <span className="mx-0.5">{inner}</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="mx-0.5 hover:opacity-80"
    >
      {inner}
    </a>
  );
}

export function sourceHost(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}
