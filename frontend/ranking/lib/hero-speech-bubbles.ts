/**
 * Comic speech bubbles for walking peeps. Mix of statements (found this
 * on ChatGPT) and two-person Q&A. Questions always get an answer.
 */

import {
  type PhonePeepSnapshot,
  peepVisualLeft,
} from "@/lib/hero-phone-chats";

export const HERO_SPEECH_ARM_MS = 2400;
export const HERO_SPEECH_HOLD_MS = 4400;
export const HERO_SPEECH_GAP_MS = 3200;
export const HERO_SPEECH_REPLY_MS = 520;
export const HERO_SPEECH_MAX = 2;
export const SPEECH_PAIR_MIN_DX = 36;
export const SPEECH_PAIR_MAX_DX = 125;
export const SPEECH_PAIR_MAX_DY = 72;
export const SPEECH_SIDE_INNER = 0.42;
export const SPEECH_SIDE_OUTER = 0.58;

export type SpeechSceneKind = "solo" | "pair";

export type SpeechScene = {
  id: string;
  kind: SpeechSceneKind;
  lines: readonly [string] | readonly [string, string];
};

/** True when a line is a question that needs a reply in the other bubble. */
export function isQuestionLine(text: string): boolean {
  return text.trimEnd().endsWith("?");
}

export const SPEECH_SCENES: readonly SpeechScene[] = [
  {
    id: "naples-rec",
    kind: "solo",
    lines: ["ChatGPT sent me this place in Naples."],
  },
  {
    id: "pizza-qa",
    kind: "pair",
    lines: ["Best pizza in Naples?", "ChatGPT said L'Antica."],
  },
  {
    id: "agency-rec",
    kind: "pair",
    lines: ["Found this web agency on ChatGPT.", "Send it — we're hiring."],
  },
  {
    id: "kyoto-rec",
    kind: "solo",
    lines: ["Claude said stay at Tawaraya in Kyoto."],
  },
  {
    id: "agency-qa",
    kind: "pair",
    lines: ["Who's the best web agency in Austin?", "Claude named them first."],
  },
  {
    id: "named-first",
    kind: "pair",
    lines: ["Gemini put them at the top.", "Same list for me."],
  },
];

export function peepOnSpeechSide(centerRatio: number): boolean {
  return centerRatio < SPEECH_SIDE_INNER || centerRatio > SPEECH_SIDE_OUTER;
}

export function speechAnchor(snapshot: PhonePeepSnapshot): { x: number; y: number } {
  const left = peepVisualLeft(snapshot.x, snapshot.width, snapshot.scaleX);
  return {
    x: left + snapshot.width * 0.5,
    y: snapshot.y + snapshot.height * 0.12,
  };
}

function sideScore(peep: PhonePeepSnapshot): number {
  const inward =
    peep.centerRatio < 0.5 ? peep.scaleX === 1 : peep.scaleX === -1;
  return Math.abs(peep.centerRatio - 0.5) * 2 + peep.y / 1000 + (inward ? 1 : 0);
}

export function pickSpeechSolo(
  peeps: readonly PhonePeepSnapshot[],
  reserved: ReadonlySet<number>,
): PhonePeepSnapshot | undefined {
  const candidates = peeps.filter(
    (peep) =>
      peep.inStage &&
      peepOnSpeechSide(peep.centerRatio) &&
      !reserved.has(peep.frameIndex),
  );
  if (candidates.length === 0) return undefined;
  return candidates.reduce((best, peep) =>
    sideScore(peep) > sideScore(best) ? peep : best,
  );
}

function neighborDistance(a: PhonePeepSnapshot, b: PhonePeepSnapshot): number {
  const dx = Math.abs(a.centerX - b.centerX);
  const dy = Math.abs(a.y - b.y);
  return dx + dy * 1.5;
}

export function areSpeechNeighbors(
  a: PhonePeepSnapshot,
  b: PhonePeepSnapshot,
): boolean {
  const dx = Math.abs(a.centerX - b.centerX);
  const dy = Math.abs(a.y - b.y);
  return (
    dx >= SPEECH_PAIR_MIN_DX &&
    dx <= SPEECH_PAIR_MAX_DX * 1.35 &&
    dy <= SPEECH_PAIR_MAX_DY * 1.35
  );
}

/** Closest peep standing next to `asker`, or undefined if nobody is adjacent. */
export function nearestSpeechNeighbor(
  asker: PhonePeepSnapshot,
  peeps: readonly PhonePeepSnapshot[],
  reserved: ReadonlySet<number>,
): PhonePeepSnapshot | undefined {
  let best: PhonePeepSnapshot | undefined;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const peep of peeps) {
    if (peep.frameIndex === asker.frameIndex) continue;
    if (!peep.inStage || reserved.has(peep.frameIndex)) continue;
    const dx = Math.abs(peep.centerX - asker.centerX);
    const dy = Math.abs(peep.y - asker.y);
    if (dx < SPEECH_PAIR_MIN_DX || dx > SPEECH_PAIR_MAX_DX) continue;
    if (dy > SPEECH_PAIR_MAX_DY) continue;
    const dist =
      neighborDistance(asker, peep) *
      (peep.scaleX === asker.scaleX ? 0.65 : 1.35);
    if (dist < bestDist) {
      bestDist = dist;
      best = peep;
    }
  }
  return best;
}

export function pickSpeechPair(
  peeps: readonly PhonePeepSnapshot[],
  reserved: ReadonlySet<number>,
): [PhonePeepSnapshot, PhonePeepSnapshot] | undefined {
  const askers = peeps.filter(
    (peep) =>
      peep.inStage &&
      !reserved.has(peep.frameIndex) &&
      peepOnSpeechSide(peep.centerRatio),
  );
  let best: [PhonePeepSnapshot, PhonePeepSnapshot] | undefined;
  let bestDist = Number.POSITIVE_INFINITY;

  for (const asker of askers) {
    const neighbor = nearestSpeechNeighbor(asker, peeps, reserved);
    if (!neighbor) continue;
    const dist = neighborDistance(asker, neighbor);
    if (dist < bestDist) {
      bestDist = dist;
      best = [asker, neighbor];
    }
  }
  return best;
}

export function nextSpeechScene(
  scenes: readonly SpeechScene[],
  usedIds: ReadonlySet<string>,
  allowPair: boolean,
): SpeechScene {
  const pool = scenes.filter(
    (scene) => !usedIds.has(scene.id) && (allowPair || scene.kind === "solo"),
  );
  const fallback = scenes.filter((scene) => allowPair || scene.kind === "solo");
  const source = pool.length > 0 ? pool : fallback;
  const scene = source[0];
  if (!scene) {
    throw new Error("No speech scenes available");
  }
  return scene;
}