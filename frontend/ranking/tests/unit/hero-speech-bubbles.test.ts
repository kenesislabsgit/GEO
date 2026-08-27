import { describe, expect, it } from "vitest";
import type { PhonePeepSnapshot } from "@/lib/hero-phone-chats";
import {
  nextSpeechScene,
  peepOnSpeechSide,
  pickSpeechPair,
  pickSpeechSolo,
  SPEECH_SCENES,
  areSpeechNeighbors,
  isQuestionLine,
  nearestSpeechNeighbor,
} from "@/lib/hero-speech-bubbles";

function peep(
  frameIndex: number,
  extras: Partial<PhonePeepSnapshot> = {},
): PhonePeepSnapshot {
  const width = extras.width ?? 120;
  const x = extras.x ?? 400;
  const scaleX = extras.scaleX ?? 1;
  const centerX = extras.centerX ?? x + width / 2;
  return {
    frameIndex,
    x,
    y: 500,
    width,
    height: 160,
    scaleX,
    centerX,
    centerRatio: extras.centerRatio ?? centerX / 1000,
    inStage: true,
    ...extras,
  };
}

describe("hero speech bubbles", () => {
  it("mixes statements with question-and-answer pairs", () => {
    const kinds = new Set(SPEECH_SCENES.map((scene) => scene.kind));
    expect(kinds.has("solo")).toBe(true);
    expect(kinds.has("pair")).toBe(true);

    const joined = SPEECH_SCENES.map((scene) => scene.lines.join(" "));
    expect(joined.some((text) => /ChatGPT/i.test(text))).toBe(true);
    expect(joined.some((text) => /Claude/i.test(text))).toBe(true);

    const questions = SPEECH_SCENES.filter((scene) =>
      scene.lines.some((line) => isQuestionLine(line)),
    );
    expect(questions.length).toBeGreaterThan(0);
    expect(
      questions.every(
        (scene) =>
          scene.kind === "pair" &&
          isQuestionLine(scene.lines[0]) &&
          scene.lines[1] != null &&
          !isQuestionLine(scene.lines[1]),
      ),
    ).toBe(true);

    expect(
      SPEECH_SCENES.some(
        (scene) =>
          scene.kind === "solo" && !isQuestionLine(scene.lines[0]),
      ),
    ).toBe(true);
    expect(
      SPEECH_SCENES.some(
        (scene) =>
          scene.kind === "pair" &&
          !isQuestionLine(scene.lines[0]) &&
          scene.lines[1] != null &&
          !isQuestionLine(scene.lines[1]),
      ),
    ).toBe(true);
  });

  it("keeps bubbles off the center of the hero", () => {
    expect(peepOnSpeechSide(0.3)).toBe(true);
    expect(peepOnSpeechSide(0.5)).toBe(false);
    expect(peepOnSpeechSide(0.72)).toBe(true);
  });

  it("picks a side peep and skips reserved frames", () => {
    const pick = pickSpeechSolo(
      [
        peep(1, { centerRatio: 0.5, inStage: true }),
        peep(2, { centerRatio: 0.78, y: 520, inStage: true }),
        peep(3, { centerRatio: 0.8, inStage: true }),
      ],
      new Set([3]),
    );
    expect(pick?.frameIndex).toBe(2);
  });

  it("puts the answer on the person standing next to the asker", () => {
    const asker = peep(10, {
      x: 580,
      centerX: 640,
      centerRatio: 0.64,
      y: 500,
    });
    const neighbor = peep(11, {
      x: 650,
      centerX: 710,
      centerRatio: 0.71,
      y: 505,
    });
    const farther = peep(12, {
      x: 840,
      centerX: 900,
      centerRatio: 0.9,
      y: 500,
    });
    expect(nearestSpeechNeighbor(asker, [asker, neighbor, farther], new Set())?.frameIndex).toBe(
      11,
    );
    expect(
      pickSpeechPair([asker, neighbor, farther], new Set())?.map(
        (item) => item.frameIndex,
      ),
    ).toEqual([10, 11]);
    expect(areSpeechNeighbors(asker, neighbor)).toBe(true);
    expect(areSpeechNeighbors(asker, farther)).toBe(false);
  });

  it("does not pair peeps that are far apart", () => {
    const pair = pickSpeechPair(
      [
        peep(20, { x: 100, centerX: 160, centerRatio: 0.16, y: 500 }),
        peep(21, { x: 800, centerX: 860, centerRatio: 0.86, y: 500 }),
      ],
      new Set(),
    );
    expect(pair).toBeUndefined();
  });

  it("falls back to solos when pairs are not allowed", () => {
    const scene = nextSpeechScene(SPEECH_SCENES, new Set(), false);
    expect(scene.kind).toBe("solo");
  });
});
