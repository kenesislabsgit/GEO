"use client";

import { useState } from "react";
import { ChevronDown, ExternalLink } from "lucide-react";

export type ExplorerCitation = {
  url: string;
  label: string;
};

export type ExplorerRecommendation = {
  name: string;
  position: number | null;
  reason: string | null;
};

export type ExplorerAnswer = {
  id: string;
  provider: string;
  assistantName: string;
  mentioned: boolean;
  position: number | null;
  answer: string;
  recommended: ExplorerRecommendation[];
  citations: ExplorerCitation[];
};

export type ExplorerQuestion = {
  promptId: string;
  question: string;
  promptType: string | null;
  answers: ExplorerAnswer[];
};

/**
 * One card per buyer question. The collapsed row shows the question and a
 * chip per assistant (green dot = mentioned, muted = absent); the chevron
 * opens the full saved answers with the audited brand highlighted.
 */
export function AnswerExplorer({
  questions,
  brandName,
}: {
  questions: ExplorerQuestion[];
  brandName: string;
}) {
  return (
    <div className="space-y-3">
      {questions.map((question) => (
        <QuestionCard
          key={question.promptId}
          question={question}
          brandName={brandName}
        />
      ))}
    </div>
  );
}

function QuestionCard({
  question,
  brandName,
}: {
  question: ExplorerQuestion;
  brandName: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rb-panel">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-start justify-between gap-3 px-5 py-4 text-left"
      >
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-snug">{question.question}</p>
          {question.promptType ? (
            <p className="mt-1 text-xs capitalize text-muted-foreground">
              {question.promptType.replaceAll("_", " ")}
            </p>
          ) : null}
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {question.answers.map((answer) => (
              <span
                key={answer.id}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted px-2 py-0.5 text-xs"
              >
                <span
                  aria-hidden
                  className="size-1.5 rounded-full"
                  style={{
                    background: answer.mentioned
                      ? "var(--rb-green)"
                      : "var(--border)",
                  }}
                />
                <span className="font-medium">{answer.assistantName}</span>
                <span
                  className={
                    answer.mentioned
                      ? "text-[color:var(--rb-green)]"
                      : "text-muted-foreground"
                  }
                >
                  {answer.mentioned
                    ? `Mentioned${answer.position ? ` #${answer.position}` : ""}`
                    : "Absent"}
                </span>
              </span>
            ))}
          </div>
        </div>
        <ChevronDown
          aria-hidden
          className={`mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open ? (
        <div className="divide-y divide-border border-t border-border">
          {question.answers.map((answer) => (
            <AnswerBlock key={answer.id} answer={answer} brandName={brandName} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function AnswerBlock({
  answer,
  brandName,
}: {
  answer: ExplorerAnswer;
  brandName: string;
}) {
  const brandKey = brandName.trim().toLowerCase();

  return (
    <div className="grid gap-5 px-5 py-5 lg:grid-cols-[1fr_240px]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="rb-eyebrow">{answer.assistantName}</p>
          <span
            className={`text-xs ${answer.mentioned ? "text-[color:var(--rb-green)]" : "text-muted-foreground"}`}
          >
            {answer.mentioned
              ? `Mentions ${brandName}${answer.position ? ` at #${answer.position}` : ""}`
              : `Does not mention ${brandName}`}
          </span>
        </div>
        <div className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">
          {highlightBrand(answer.answer, brandName)}
        </div>
      </div>

      <div className="space-y-5">
        <div>
          <p className="rb-eyebrow">Recommended</p>
          {answer.recommended.length ? (
            <ol className="mt-2 space-y-1.5">
              {answer.recommended.map((company, index) => {
                const isBrand =
                  company.name.trim().toLowerCase() === brandKey;
                return (
                  <li
                    key={`${company.name}-${index}`}
                    className={`text-sm ${isBrand ? "font-semibold" : ""}`}
                  >
                    {company.position ?? index + 1}. {company.name}
                    {company.reason ? (
                      <p className="mt-0.5 text-xs font-normal text-muted-foreground">
                        {company.reason}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">
              No ranked list extracted.
            </p>
          )}
        </div>

        <div>
          <p className="rb-eyebrow">Sources</p>
          {answer.citations.length ? (
            <div className="mt-2 space-y-1.5">
              {answer.citations.map((citation, index) => (
                <a
                  key={`${citation.url}-${index}`}
                  href={citation.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-start gap-1.5 text-xs text-[color:var(--rb-blue)] hover:underline"
                >
                  <ExternalLink aria-hidden className="mt-0.5 size-3 shrink-0" />
                  <span className="break-all">{citation.label}</span>
                </a>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">
              No sources returned.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/** Wrap every occurrence of the brand name in a highlight mark. */
function highlightBrand(text: string, brandName: string) {
  const name = brandName.trim();
  if (!name) return text;
  const expression = new RegExp(`(${escapeRegExp(name)})`, "gi");
  const key = name.toLowerCase();
  return text.split(expression).map((part, index) =>
    part.toLowerCase() === key ? (
      <mark
        key={index}
        className="rounded bg-[color:var(--rb-blue-soft)] px-0.5 font-medium text-inherit"
      >
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
