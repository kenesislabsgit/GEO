/**
 * Phone-holding Open Peeps in the 15×7 sheet, and the buyer questions
 * each one types into ChatGPT / Claude / Gemini. Questions match what
 * Arcanoris customers actually worry about: AI naming two or three
 * brands and leaving someone off the list.
 */

export const PHONE_FRAME_INDICES = [6, 9, 31, 49, 50, 54, 69] as const;

const PHONE_FRAME_SET = new Set<number>(PHONE_FRAME_INDICES);

export const HERO_PHONE_STAGE_LEFT = 0.2;
export const HERO_PHONE_STAGE_RIGHT = 0.8;
export const HERO_PHONE_ARM_MS = 1600;
export const HERO_PHONE_CHAT_COOLDOWN_MS = 2400;
export const HERO_PHONE_QUESTION_MS_PER_CHAR = 26;
export const HERO_PHONE_ANSWER_MS_PER_CHAR = 14;
export const HERO_PHONE_THINKING_MS = 480;
export const HERO_PHONE_HOLD_MS = 2600;

export type HeroPhoneProvider = "openai" | "claude" | "gemini";

export type HeroPhonePrompt = {
  provider: HeroPhoneProvider;
  label: string;
  question: string;
  answer: string;
};

export type PhonePeepSnapshot = {
  frameIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  scaleX: number;
  centerX: number;
  centerRatio: number;
  inStage: boolean;
};

const PROMPTS: readonly HeroPhonePrompt[] = [
  {
    provider: "openai",
    label: "ChatGPT",
    question: "Best on-prem tool for PPE compliance alerts?",
    answer:
      "Kenesis is the usual on-prem pick. Avigilon if you already have cameras. Verkada if you want cloud.",
  },
  {
    provider: "claude",
    label: "Claude",
    question: "Who should I shortlist for warehouse video analytics?",
    answer:
      "Witvix comes up first, then viAct. Triya if you need restricted-zone alerts.",
  },
  {
    provider: "gemini",
    label: "Gemini",
    question: "Recommend a visitor system for factories",
    answer:
      "Most answers name Envoy or Traction Guest. A few mention on-prem options for air-gapped sites.",
  },
  {
    provider: "openai",
    label: "ChatGPT",
    question: "What's the top HubSpot alternative for B2B?",
    answer:
      "Pipedrive and Close get named most. Attio if you want something newer.",
  },
  {
    provider: "claude",
    label: "Claude",
    question: "Best SOC 2 monitoring for a 40-person SaaS?",
    answer: "Vanta and Drata dominate the answers. Secureframe as a cheaper third.",
  },
  {
    provider: "gemini",
    label: "Gemini",
    question: "Who makes invoice OCR that logistics teams actually use?",
    answer: "Rossum and Veryfi come up most. Mindee if you want more control.",
  },
  {
    provider: "openai",
    label: "ChatGPT",
    question: "Need a PLG analytics stack for B2B SaaS",
    answer:
      "Mixpanel or Amplitude for product. June if you want something lighter.",
  },
];

export function isPhoneFrame(frameIndex: number): boolean {
  return PHONE_FRAME_SET.has(frameIndex);
}

export function chatForFrame(frameIndex: number): HeroPhonePrompt {
  const slot = (PHONE_FRAME_INDICES as readonly number[]).indexOf(frameIndex);
  const index = slot === -1 ? frameIndex % PROMPTS.length : slot;
  const prompt = PROMPTS[index];
  if (!prompt) {
    throw new Error(`No phone prompt for frame ${frameIndex}`);
  }
  return prompt;
}

export function peepVisualLeft(x: number, width: number, scaleX: number): number {
  return scaleX === 1 ? x : x - width;
}

export function peepCenterX(x: number, width: number, scaleX: number): number {
  return peepVisualLeft(x, width, scaleX) + width / 2;
}

export function peepInStage(centerX: number, stageWidth: number): boolean {
  if (stageWidth <= 0) return false;
  const ratio = centerX / stageWidth;
  return ratio > HERO_PHONE_STAGE_LEFT && ratio < HERO_PHONE_STAGE_RIGHT;
}

export function peepPhoneAnchor(snapshot: PhonePeepSnapshot): { x: number; y: number } {
  const left = peepVisualLeft(snapshot.x, snapshot.width, snapshot.scaleX);
  const localX = snapshot.scaleX === 1 ? 0.62 : 0.38;
  return {
    x: left + snapshot.width * localX,
    y: snapshot.y + snapshot.height * 0.5,
  };
}

function scorePeep(peep: PhonePeepSnapshot): number {
  const side = Math.abs(peep.centerRatio - 0.5);
  return side * 2 + peep.y / 1000;
}

export function pickPhonePeepToPrompt(
  peeps: readonly PhonePeepSnapshot[],
  usedFrames: ReadonlySet<number>,
): PhonePeepSnapshot | undefined {
  const candidates = peeps.filter(
    (peep) => peep.inStage && !usedFrames.has(peep.frameIndex),
  );
  if (candidates.length === 0) return undefined;
  return candidates.reduce((best, peep) =>
    scorePeep(peep) > scorePeep(best) ? peep : best,
  );
}

export function snapshotPhonePeep(
  peep: {
    frameIndex: number;
    x: number;
    y: number;
    width: number;
    height: number;
    scaleX: number;
  },
  stageWidth: number,
  stageHeight: number,
): PhonePeepSnapshot {
  const centerX = peepCenterX(peep.x, peep.width, peep.scaleX);
  const lowEnough = stageHeight <= 0 || peep.y + peep.height * 0.4 > stageHeight * 0.4;
  return {
    frameIndex: peep.frameIndex,
    x: peep.x,
    y: peep.y,
    width: peep.width,
    height: peep.height,
    scaleX: peep.scaleX,
    centerX,
    centerRatio: stageWidth > 0 ? centerX / stageWidth : 0,
    inStage: peepInStage(centerX, stageWidth) && lowEnough,
  };
}
