"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { CrowdCanvas, type PhonePeepSnapshot } from "@/components/site/crowd-canvas";
import { HeroPhoneChat } from "@/components/site/hero-phone-chat";
import { HeroSpeechBubble } from "@/components/site/hero-speech-bubble";
import {
  HERO_PHONE_ARM_MS,
  HERO_PHONE_CHAT_COOLDOWN_MS,
  PHONE_FRAME_INDICES,
  chatForFrame,
  isPhoneFrame,
  pickPhonePeepToPrompt,
  type HeroPhonePrompt,
} from "@/lib/hero-phone-chats";
import {
  HERO_SPEECH_ARM_MS,
  HERO_SPEECH_GAP_MS,
  HERO_SPEECH_HOLD_MS,
  HERO_SPEECH_REPLY_MS,
  SPEECH_SCENES,
  areSpeechNeighbors,
  nextSpeechScene,
  pickSpeechPair,
  pickSpeechSolo,
} from "@/lib/hero-speech-bubbles";

const PEEP_SHEET_SRC = "/images/peeps/all-peeps.png";
const PEEP_SHEET_COLUMNS = 15;
const PEEP_SHEET_ROWS = 7;

type ActivePhoneChat = {
  snapshot: PhonePeepSnapshot;
  prompt: HeroPhonePrompt;
  instant: boolean;
};

type ActiveSpeechBubble = {
  id: string;
  frameIndex: number;
  text: string;
  snapshot: PhonePeepSnapshot;
};

function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (onStoreChange) => {
      const media = window.matchMedia("(prefers-reduced-motion: reduce)");
      media.addEventListener("change", onStoreChange);
      return () => media.removeEventListener("change", onStoreChange);
    },
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}

/**
 * Full-bleed walking crowd behind the landing hero. Phone peeps get a tiny
 * AI chat; everyone else can pop a short speech bubble — one or two at a
 * time. Pointer-events stay off so the form remains usable.
 */
export function HeroCrowd() {
  const reducedMotion = usePrefersReducedMotion();
  const [chat, setChat] = useState<ActivePhoneChat | null>(null);
  const [bubbles, setBubbles] = useState<ActiveSpeechBubble[]>([]);
  const usedPhoneFrames = useRef(new Set<number>());
  const usedSpeechIds = useRef(new Set<string>());
  const phoneBusy = useRef(false);
  const speechBusy = useRef(false);
  const heroVisible = useRef(true);
  const phoneArmedAt = useRef(0);
  const speechArmedAt = useRef(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const livePeepsRef = useRef(new Map<number, PhonePeepSnapshot>());
  const livePhoneRef = useRef<PhonePeepSnapshot | null>(null);
  const activePhoneFrameRef = useRef<number | null>(null);
  const speechFramesRef = useRef(new Set<number>());
  const speechEndTimer = useRef(0);
  const speechReplyTimer = useRef(0);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    phoneArmedAt.current = Date.now() + (reducedMotion ? 0 : HERO_PHONE_ARM_MS);
    speechArmedAt.current = Date.now() + (reducedMotion ? 0 : HERO_SPEECH_ARM_MS);
  }, [reducedMotion]);

  const clearSpeech = useCallback(() => {
    window.clearTimeout(speechEndTimer.current);
    window.clearTimeout(speechReplyTimer.current);
    speechFramesRef.current.clear();
    setBubbles([]);
    window.setTimeout(() => {
      speechBusy.current = false;
      if (usedSpeechIds.current.size >= SPEECH_SCENES.length) {
        usedSpeechIds.current.clear();
      }
    }, HERO_SPEECH_GAP_MS);
  }, []);

  useEffect(() => {
    const node = wrapRef.current;
    if (!node) return;
    setPortalTarget(node.closest("section"));

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        heroVisible.current = entry.isIntersecting;
        if (!entry.isIntersecting) {
          phoneBusy.current = false;
          activePhoneFrameRef.current = null;
          livePhoneRef.current = null;
          setChat(null);
          speechBusy.current = false;
          window.clearTimeout(speechEndTimer.current);
          window.clearTimeout(speechReplyTimer.current);
          speechFramesRef.current.clear();
          setBubbles([]);
        }
      },
      { threshold: 0.28 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    return () => {
      window.clearTimeout(speechEndTimer.current);
      window.clearTimeout(speechReplyTimer.current);
    };
  }, []);

  const startChat = useCallback(
    (pick: PhonePeepSnapshot, instant: boolean) => {
      phoneBusy.current = true;
      usedPhoneFrames.current.add(pick.frameIndex);
      activePhoneFrameRef.current = pick.frameIndex;
      livePhoneRef.current = pick;
      queueMicrotask(() => {
        setChat({
          snapshot: pick,
          prompt: chatForFrame(pick.frameIndex),
          instant,
        });
      });
    },
    [],
  );

  const startSpeech = useCallback(
    (peeps: PhonePeepSnapshot[], instant: boolean) => {
      const reserved = new Set(speechFramesRef.current);
      if (activePhoneFrameRef.current != null) {
        reserved.add(activePhoneFrameRef.current);
      }
      const allowPair = !instant && activePhoneFrameRef.current == null;
      const scene = nextSpeechScene(SPEECH_SCENES, usedSpeechIds.current, allowPair);

      if (scene.kind === "pair") {
        const pair = pickSpeechPair(peeps, reserved);
        const lineA = scene.lines[0];
        const lineB = scene.lines[1];
        if (!pair || !lineB) {
          const solo = pickSpeechSolo(peeps, reserved);
          const fallback = nextSpeechScene(
            SPEECH_SCENES,
            usedSpeechIds.current,
            false,
          );
          if (!solo || !fallback) return;
          speechBusy.current = true;
          usedSpeechIds.current.add(fallback.id);
          speechFramesRef.current = new Set([solo.frameIndex]);
          setBubbles([
            {
              id: `${fallback.id}-${solo.frameIndex}`,
              frameIndex: solo.frameIndex,
              text: fallback.lines[0],
              snapshot: solo,
            },
          ]);
          speechEndTimer.current = window.setTimeout(clearSpeech, HERO_SPEECH_HOLD_MS);
          return;
        }

        speechBusy.current = true;
        usedSpeechIds.current.add(scene.id);
        speechFramesRef.current = new Set([pair[0].frameIndex, pair[1].frameIndex]);
        setBubbles([
          {
            id: `${scene.id}-a`,
            frameIndex: pair[0].frameIndex,
            text: lineA,
            snapshot: pair[0],
          },
        ]);
        speechReplyTimer.current = window.setTimeout(() => {
          setBubbles((current) => [
            ...current,
            {
              id: `${scene.id}-b`,
              frameIndex: pair[1].frameIndex,
              text: lineB,
              snapshot: pair[1],
            },
          ]);
        }, instant ? 0 : HERO_SPEECH_REPLY_MS);
        speechEndTimer.current = window.setTimeout(
          clearSpeech,
          HERO_SPEECH_HOLD_MS + (instant ? 0 : HERO_SPEECH_REPLY_MS),
        );
        return;
      }

      const solo = pickSpeechSolo(peeps, reserved);
      if (!solo) return;
      speechBusy.current = true;
      usedSpeechIds.current.add(scene.id);
      speechFramesRef.current = new Set([solo.frameIndex]);
      setBubbles([
        {
          id: `${scene.id}-${solo.frameIndex}`,
          frameIndex: solo.frameIndex,
          text: scene.lines[0],
          snapshot: solo,
        },
      ]);
      speechEndTimer.current = window.setTimeout(clearSpeech, HERO_SPEECH_HOLD_MS);
    },
    [clearSpeech],
  );

  const onPeeps = useCallback(
    (peeps: PhonePeepSnapshot[]) => {
      if (!heroVisible.current) return;

      const nextLive = new Map<number, PhonePeepSnapshot>();
      for (const peep of peeps) nextLive.set(peep.frameIndex, peep);
      livePeepsRef.current = nextLive;

      if (phoneBusy.current) {
        const frame = activePhoneFrameRef.current;
        if (frame != null) {
          const live = nextLive.get(frame);
          if (live) livePhoneRef.current = live;
        }
      }

      if (speechBusy.current) {
        const frames = [...speechFramesRef.current];
        const livePair = frames.map((frame) => nextLive.get(frame));
        const stillHere = livePair.every(
          (live) =>
            live != null && live.centerRatio > 0.04 && live.centerRatio < 0.96,
        );
        const stillTogether =
          livePair.length < 2 ||
          (livePair[0] != null &&
            livePair[1] != null &&
            areSpeechNeighbors(livePair[0], livePair[1]));
        if (!stillHere || !stillTogether) clearSpeech();
      }

      const now = Date.now();
      const phones = peeps.filter((peep) => isPhoneFrame(peep.frameIndex));

      if (!phoneBusy.current && now >= phoneArmedAt.current) {
        if (reducedMotion) {
          const pick =
            pickPhonePeepToPrompt(phones, usedPhoneFrames.current) ??
            phones.find((peep) => peep.inStage) ??
            phones[0];
          if (pick) startChat(pick, true);
        } else {
          const pick = pickPhonePeepToPrompt(phones, usedPhoneFrames.current);
          if (pick) startChat(pick, false);
        }
      }

      if (!speechBusy.current && now >= speechArmedAt.current) {
        startSpeech(peeps, reducedMotion);
      }
    },
    [clearSpeech, reducedMotion, startChat, startSpeech],
  );

  const onChatComplete = useCallback(() => {
    setChat(null);
    activePhoneFrameRef.current = null;
    livePhoneRef.current = null;
    window.setTimeout(() => {
      phoneBusy.current = false;
      if (usedPhoneFrames.current.size >= PHONE_FRAME_INDICES.length) {
        usedPhoneFrames.current.clear();
      }
    }, HERO_PHONE_CHAT_COOLDOWN_MS);
  }, []);

  const overlay =
    portalTarget && (chat || bubbles.length > 0)
      ? createPortal(
          <div className="pointer-events-none absolute inset-0 z-20" aria-hidden>
            {chat ? (
              <HeroPhoneChat
                snapshot={chat.snapshot}
                liveSnapshotRef={livePhoneRef}
                prompt={chat.prompt}
                instant={chat.instant}
                onComplete={onChatComplete}
              />
            ) : null}
            {bubbles.map((bubble) => (
              <HeroSpeechBubble
                key={bubble.id}
                frameIndex={bubble.frameIndex}
                text={bubble.text}
                snapshot={bubble.snapshot}
                livePeepsRef={livePeepsRef}
              />
            ))}
          </div>,
          portalTarget,
        )
      : null;

  return (
    <div ref={wrapRef} className="pointer-events-none absolute inset-0" aria-hidden>
      <CrowdCanvas
        src={PEEP_SHEET_SRC}
        rows={PEEP_SHEET_COLUMNS}
        cols={PEEP_SHEET_ROWS}
        paused={reducedMotion}
        slowed={chat !== null && !reducedMotion}
        onPeeps={onPeeps}
        className="absolute inset-0 h-full w-full"
      />
      {overlay}
    </div>
  );
}
