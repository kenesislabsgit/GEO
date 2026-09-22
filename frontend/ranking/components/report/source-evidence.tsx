import { ExternalLink } from "lucide-react";
import { passageUrl, type ReportSource } from "@/lib/reports/evidence";

export function SourceEvidence({ source, id }: { source: ReportSource; id: string }) {
  const passage = passageUrl(source);
  return (
    <div id={id} className="min-w-0 scroll-mt-20 space-y-2">
      <p className="text-sm font-medium">{source.label}</p>
      {source.excerpt ? (
        <blockquote className="border-l-2 border-[color:var(--arc-accent)] pl-3 text-sm leading-relaxed text-foreground/80">
          {source.excerpt}
        </blockquote>
      ) : (
        <p className="text-xs text-muted-foreground">No page passage was saved for this link.</p>
      )}
      {source.url ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
          <a href={source.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-w-0 items-start gap-1 text-[color:var(--arc-accent)] hover:underline">
            <ExternalLink className="mt-0.5 size-3 shrink-0" aria-hidden />
            <span className="break-all">{source.url}</span>
          </a>
          {passage ? (
            <a href={passage} target="_blank" rel="noopener noreferrer" className="text-[color:var(--arc-accent)] underline underline-offset-4">
              Open passage
            </a>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No source URL was saved for this passage.</p>
      )}
    </div>
  );
}
