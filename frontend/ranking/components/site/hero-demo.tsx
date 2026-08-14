"use client";

import { useEffect, useRef, useState } from "react";
import { ProviderLogo } from "@/components/providers/provider-logo";

type Result =
  | { kind: "pos"; pos: string }
  | { kind: "cited" }
  | { kind: "miss" }
  | { kind: "more"; text: string };

type Question = {
  text: string;
  results: Result[]; // one per row in ROWS order
};

const ROWS = [
  { id: "openai", name: "ChatGPT" },
  { id: "claude", name: "Claude" },
  { id: "gemini", name: "Gemini" },
  { id: "perplexity", name: "Perplexity" },
  { id: "more", name: "+6 more providers" },
] as const;

// Scripted scans - no live requests. Same question to every model at once;
// each returns a compact verdict, and the strip below is the combination.
const QUESTIONS: Question[] = [
  {
    text: "What's the best analytics tool for an early-stage startup?",
    results: [
      { kind: "pos", pos: "#2" },
      { kind: "miss" },
      { kind: "pos", pos: "#4" },
      { kind: "cited" },
      { kind: "more", text: "2 of 6 mention you" },
    ],
  },
  {
    text: "Which analytics platforms are worth paying for?",
    results: [
      { kind: "miss" },
      { kind: "pos", pos: "#3" },
      { kind: "miss" },
      { kind: "pos", pos: "#5" },
      { kind: "more", text: "1 of 6 mentions you" },
    ],
  },
];

// Millisecond gap before each row's answer lands, in row order.
const RESOLVE_GAPS = [450, 330, 390, 310, 430];

const STATS = [
  ["Visibility", "62/100"],
  ["Mention rate", "6/10"],
  ["Avg position", "#3.2"],
  ["Citations", "4"],
] as const;

function ResultChip({ result }: { result: Result }) {
  if (result.kind === "miss") {
    return (
      <span className="rounded-full bg-[#ff6166]/15 px-2.5 py-0.5 text-[11px] font-medium text-[#ff8a8d]">
        Not mentioned
      </span>
    );
  }
  if (result.kind === "more") {
    return <span className="text-xs text-white/45">{result.text}</span>;
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="rounded-full bg-[#3ecf7a]/15 px-2.5 py-0.5 text-[11px] font-medium text-[#7fe3a8]">
        Mentioned
      </span>
      {result.kind === "pos" ? (
        <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-medium text-white/80">
          {result.pos}
        </span>
      ) : (
        <span className="rounded-full bg-[#52a8ff]/15 px-2 py-0.5 text-[11px] font-medium text-[#8cc5ff]">
          cited
        </span>
      )}
    </span>
  );
}

function QueryingDots() {
  return (
    <span className="inline-flex items-center gap-1" aria-label="querying">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="size-1 animate-pulse rounded-full bg-white/45"
          style={{ animationDelay: `${i * 160}ms` }}
        />
      ))}
    </span>
  );
}

/**
 * The hero's product preview: one buyer question fans out to every provider
 * at once, each returns a compact verdict, and the verdicts combine into the
 * numbers the product measures. Fully scripted; the server renders the
 * finished frame and motion never starts for reduced-motion visitors.
 */
export function HeroDemo() {
  const [qi, setQi] = useState(0);
  // Rows keep showing the previous scan's results while the next question
  // types, so the panel never spoils - or blanks - the upcoming reveal.
  const [resultsQi, setResultsQi] = useState(0);
  const [typed, setTyped] = useState(QUESTIONS[0].text.length);
  const [phase, setPhase] = useState<"typing" | "scan" | "hold">("hold");
  const [resolvedCount, setResolvedCount] = useState<number>(ROWS.length);
  const started = useRef(false);

  const question = QUESTIONS[qi];
  const results = QUESTIONS[resultsQi].results;

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setQi(0);
    setTyped(0);
    setPhase("typing");
    setResolvedCount(0);
  }, []);

  // Type the question, then dispatch the scan.
  useEffect(() => {
    if (phase !== "typing") return;
    if (typed >= question.text.length) {
      const t = setTimeout(() => {
        setResultsQi(qi);
        setResolvedCount(0);
        setPhase("scan");
      }, 350);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setTyped((n) => n + 1), 24);
    return () => clearTimeout(t);
  }, [phase, typed, qi, question.text.length]);

  // Providers answer one by one; when the last lands, hold, then rescan
  // with the next question.
  useEffect(() => {
    if (phase !== "scan") return;
    if (resolvedCount >= ROWS.length) {
      const t = setTimeout(() => {
        setQi((n) => (n + 1) % QUESTIONS.length);
        setTyped(0);
        setPhase("typing");
      }, 3600);
      return () => clearTimeout(t);
    }
    const t = setTimeout(
      () => setResolvedCount((n) => n + 1),
      RESOLVE_GAPS[resolvedCount],
    );
    return () => clearTimeout(t);
  }, [phase, resolvedCount]);

  const typing = phase === "typing";
  const scanning = phase === "scan" && resolvedCount < ROWS.length;
  const complete = resolvedCount >= ROWS.length;

  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-[color:var(--rb-ink)] text-white shadow-[0_48px_96px_-48px_rgba(0,0,0,0.65)]">
      <div aria-hidden className="rb-noise pointer-events-none absolute inset-0 opacity-[0.06]" />

      <div className="relative flex items-center gap-2 border-b border-white/10 px-4 py-3">
        <span aria-hidden className="size-2 rounded-full bg-[#3ecf7a]" />
        <span className="text-xs font-medium text-white/70">Answer scan</span>
        <span className="ml-auto font-mono text-[10px] tracking-[0.14em] text-white/30 uppercase">
          Product preview
        </span>
      </div>

      <div className="relative space-y-3 p-4 sm:p-5">
        {/* The buyer question. */}
        <p className="flex min-h-10 items-start gap-2 text-sm leading-relaxed text-white/85">
          <span aria-hidden className="mt-px font-mono text-[#52a8ff]">›</span>
          <span>
            {question.text.slice(0, typed)}
            <span
              aria-hidden
              className={`ml-0.5 inline-block h-4 w-0.5 translate-y-0.5 bg-white/80 ${
                typing ? "animate-pulse" : "opacity-0"
              }`}
            />
          </span>
        </p>

        {/* Scan status - never blank: ready, scanning, or combined. */}
        <p className="flex items-center gap-2 text-xs text-white/45">
          {scanning ? (
            <>
              <span className="rb-pulse-dot size-1.5 rounded-full bg-[#52a8ff]" />
              Asking 10 providers at once&hellip;
            </>
          ) : complete ? (
            <>
              <span className="size-1.5 rounded-full bg-[#3ecf7a]" />
              Scan complete - combined into your score below
            </>
          ) : (
            <>
              <span className="size-1.5 rounded-full bg-white/30" />
              Sending to 10 providers&hellip;
            </>
          )}
        </p>

        {/* One row per provider, answering in parallel. */}
        <div className="space-y-2">
          {ROWS.map((row, i) => {
            const pending = phase === "scan" && i >= resolvedCount;
            const isMore = row.id === "more";
            return (
              <div
                key={row.id}
                className={`flex min-h-11 items-center gap-3 rounded-lg border px-3 py-2 transition-colors duration-300 ${
                  pending
                    ? "border-white/10 bg-white/[0.02]"
                    : "border-white/10 bg-white/[0.05]"
                }`}
              >
                {isMore ? (
                  <span aria-hidden className="flex size-4 items-center justify-center">
                    <span className="size-1 rounded-full bg-white/40 shadow-[5px_0_0_rgba(255,255,255,0.4),-5px_0_0_rgba(255,255,255,0.4)]" />
                  </span>
                ) : (
                  <ProviderLogo provider={row.id} className="size-4" />
                )}
                <span className={`text-sm font-medium ${isMore ? "text-white/55" : ""}`}>
                  {row.name}
                </span>
                <span className="ml-auto">
                  {pending ? <QueryingDots /> : <ResultChip result={results[i]} />}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* The combination: what the product actually measures. */}
      <div className="relative border-t border-white/10">
        <div className="grid grid-cols-4 divide-x divide-white/10">
          {STATS.map(([label, value], i) => (
            <div
              key={label}
              className={`px-3 py-3 text-center transition-all duration-500 sm:px-4 ${
                complete ? "opacity-100" : "opacity-40"
              }`}
              style={{ transitionDelay: complete ? `${i * 90}ms` : "0ms" }}
            >
              <p className="rb-tabular font-heading text-base font-semibold sm:text-lg">
                {value}
              </p>
              <p className="mt-0.5 font-mono text-[9px] tracking-[0.12em] text-white/35 uppercase sm:text-[10px]">
                {label}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
