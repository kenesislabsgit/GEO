"use client";

import { useEffect, useRef, useState } from "react";
import { ProviderLogo } from "@/components/providers/provider-logo";
import {
  HERO_PHONE_ANSWER_MS_PER_CHAR,
  HERO_PHONE_HOLD_MS,
  HERO_PHONE_QUESTION_MS_PER_CHAR,
  HERO_PHONE_THINKING_MS,
  peepPhoneAnchor,
  type HeroPhonePrompt,
  type PhonePeepSnapshot,
} from "@/lib/hero-phone-chats";

const PHONE_HALF_WIDTH_PX = 88;

type ChatPhase = "question" | "thinking" | "answer" | "hold";

type HeroPhoneChatProps = {
  snapshot: PhonePeepSnapshot;
  liveSnapshotRef?: { current: PhonePeepSnapshot | null };
  prompt: HeroPhonePrompt;
  instant?: boolean;
  onComplete: () => void;
};

function useTypedText(
  text: string,
  active: boolean,
  msPerChar: number,
  instant: boolean,
): { shown: string; done: boolean } {
  const [shown, setShown] = useState(instant && active ? text : "");

  useEffect(() => {
    if (!active) {
      setShown("");
      return;
    }
    if (instant) {
      setShown(text);
      return;
    }

    setShown("");
    let count = 0;
    let timer = 0;
    const tick = () => {
      count += 1;
      setShown(text.slice(0, count));
      if (count < text.length) {
        timer = window.setTimeout(tick, msPerChar);
      }
    };
    timer = window.setTimeout(tick, msPerChar);
    return () => window.clearTimeout(timer);
  }, [text, active, msPerChar, instant]);

  return { shown, done: active && shown === text };
}

function ThinkingDots() {
  return (
    <span className="inline-flex items-center gap-0.5 py-0.5" aria-hidden>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="size-1 rounded-full bg-foreground/45"
          style={{
            animation: "hero-phone-dot 0.9s ease-in-out infinite",
            animationDelay: `${i * 0.14}s`,
          }}
        />
      ))}
    </span>
  );
}

/**
 * Tiny phone chat pinned to a peep who is looking at their phone.
 * Decorative — clicks pass through to the hero form.
 */
export function HeroPhoneChat({
  snapshot,
  liveSnapshotRef,
  prompt,
  instant = false,
  onComplete,
}: HeroPhoneChatProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<ChatPhase>(instant ? "answer" : "question");
  const question = useTypedText(
    prompt.question,
    phase === "question" || phase === "thinking" || phase === "answer" || phase === "hold",
    HERO_PHONE_QUESTION_MS_PER_CHAR,
    instant || phase !== "question",
  );
  const answer = useTypedText(
    prompt.answer,
    phase === "answer" || phase === "hold",
    HERO_PHONE_ANSWER_MS_PER_CHAR,
    instant || phase === "hold",
  );

  useEffect(() => {
    if (instant) {
      setPhase("hold");
      return;
    }
    setPhase("question");
  }, [prompt.question, instant]);

  useEffect(() => {
    if (phase !== "question" || !question.done || instant) return;
    const timer = window.setTimeout(() => setPhase("thinking"), 120);
    return () => window.clearTimeout(timer);
  }, [phase, question.done, instant]);

  useEffect(() => {
    if (phase !== "thinking") return;
    const timer = window.setTimeout(
      () => setPhase("answer"),
      instant ? 0 : HERO_PHONE_THINKING_MS,
    );
    return () => window.clearTimeout(timer);
  }, [phase, instant]);

  useEffect(() => {
    if (phase !== "answer" || !answer.done) return;
    setPhase("hold");
  }, [phase, answer.done]);

  useEffect(() => {
    if (phase !== "hold") return;
    const timer = window.setTimeout(onComplete, HERO_PHONE_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [phase, onComplete]);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;

    const place = (peep: PhonePeepSnapshot) => {
      const anchor = peepPhoneAnchor(peep);
      box.style.left = `clamp(${PHONE_HALF_WIDTH_PX}px, ${anchor.x}px, calc(100% - ${PHONE_HALF_WIDTH_PX}px))`;
      box.style.top = `${anchor.y}px`;
    };

    place(liveSnapshotRef?.current ?? snapshot);
    if (!liveSnapshotRef) return;

    let frame = 0;
    const tick = () => {
      const live = liveSnapshotRef.current;
      if (live) place(live);
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [snapshot, liveSnapshotRef]);

  const typingQuestion = phase === "question" && !question.done;
  const typingAnswer = phase === "answer" && !answer.done;
  const anchor = peepPhoneAnchor(snapshot);

  return (
    <div
      ref={boxRef}
      className="hero-phone-chat absolute z-10 w-44 -translate-x-1/2 -translate-y-[calc(100%+10px)]"
      style={{
        left: `clamp(${PHONE_HALF_WIDTH_PX}px, ${anchor.x}px, calc(100% - ${PHONE_HALF_WIDTH_PX}px))`,
        top: anchor.y,
      }}
    >
      <div className="hero-phone-chat-inner overflow-hidden rounded-[1.15rem] border border-foreground/20 bg-background shadow-[0_10px_28px_-16px_rgba(0,0,0,0.55)]">
        <div className="flex items-center gap-1.5 border-b border-foreground/10 px-2 py-1">
          <span className="size-1.5 rounded-full bg-foreground/25" />
          <ProviderLogo provider={prompt.provider} className="size-2.5" />
          <span className="text-[9px] font-medium tracking-wide text-foreground/70">
            {prompt.label}
          </span>
        </div>
        <div className="flex flex-col gap-1.5 px-1.5 py-1.5">
          <p className="ml-auto max-w-[92%] rounded-lg rounded-br-sm bg-foreground px-1.5 py-1 text-[10px] leading-snug text-background">
            {question.shown}
            {typingQuestion ? <Caret /> : null}
          </p>
          {phase === "thinking" ? (
            <p className="w-fit max-w-[92%] rounded-lg rounded-bl-sm border border-foreground/10 bg-foreground/[0.04] px-1.5 py-1">
              <ThinkingDots />
            </p>
          ) : null}
          {phase === "answer" || phase === "hold" ? (
            <p className="w-fit max-w-[92%] rounded-lg rounded-bl-sm border border-foreground/10 bg-foreground/[0.04] px-1.5 py-1 text-[10px] leading-snug text-foreground/80">
              {answer.shown}
              {typingAnswer ? <Caret /> : null}
            </p>
          ) : null}
        </div>
      </div>
      <span
        aria-hidden
        className="absolute top-full left-1/2 -mt-px size-2 -translate-x-1/2 rotate-45 border-r border-b border-foreground/20 bg-background"
      />
    </div>
  );
}

function Caret() {
  return (
    <span
      className="ml-px inline-block h-[0.85em] w-px translate-y-[0.1em] bg-current"
      style={{ animation: "hero-phone-caret 0.9s steps(1) infinite" }}
      aria-hidden
    />
  );
}
