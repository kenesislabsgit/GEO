"use client";

import { useEffect, useRef } from "react";
import type { PhonePeepSnapshot } from "@/lib/hero-phone-chats";
import { speechAnchor } from "@/lib/hero-speech-bubbles";

const BUBBLE_HALF_WIDTH_PX = 76;

type HeroSpeechBubbleProps = {
  frameIndex: number;
  text: string;
  snapshot: PhonePeepSnapshot;
  livePeepsRef: { current: Map<number, PhonePeepSnapshot> };
};

function placeBubble(el: HTMLDivElement, peep: PhonePeepSnapshot): void {
  const anchor = speechAnchor(peep);
  el.style.left = `clamp(${BUBBLE_HALF_WIDTH_PX}px, ${anchor.x}px, calc(100% - ${BUBBLE_HALF_WIDTH_PX}px))`;
  el.style.top = `${anchor.y}px`;
}

/**
 * Tiny comic bubble above a walking peep. Follows them; clicks pass through.
 */
export function HeroSpeechBubble({
  frameIndex,
  text,
  snapshot,
  livePeepsRef,
}: HeroSpeechBubbleProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const anchor = speechAnchor(snapshot);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;

    const live = livePeepsRef.current.get(frameIndex) ?? snapshot;
    placeBubble(box, live);

    let frame = 0;
    const tick = () => {
      const next = livePeepsRef.current.get(frameIndex);
      if (next) placeBubble(box, next);
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [frameIndex, livePeepsRef, snapshot]);

  return (
    <div
      ref={boxRef}
      className="hero-speech-bubble absolute z-10 w-max max-w-[10.5rem] -translate-x-1/2 -translate-y-[calc(100%+6px)]"
      style={{
        left: `clamp(${BUBBLE_HALF_WIDTH_PX}px, ${anchor.x}px, calc(100% - ${BUBBLE_HALF_WIDTH_PX}px))`,
        top: anchor.y,
      }}
    >
      <div className="hero-speech-bubble-inner rounded-2xl rounded-bl-md border border-foreground/18 bg-background px-2 py-1.5 text-[10px] leading-snug text-foreground/85 shadow-[0_8px_22px_-16px_rgba(0,0,0,0.5)]">
        {text}
      </div>
      <span
        aria-hidden
        className="absolute top-full left-1/2 -mt-px size-1.5 -translate-x-1/2 rotate-45 border-r border-b border-foreground/18 bg-background"
      />
    </div>
  );
}
