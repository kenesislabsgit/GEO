import { describe, expect, it } from "vitest";
import {
  PHONE_FRAME_INDICES,
  chatForFrame,
  peepCenterX,
  peepInStage,
  pickPhonePeepToPrompt,
  snapshotPhonePeep,
  type PhonePeepSnapshot,
} from "@/lib/hero-phone-chats";

function peep(
  frameIndex: number,
  extras: Partial<PhonePeepSnapshot> = {},
): PhonePeepSnapshot {
  return {
    frameIndex,
    x: 400,
    y: 500,
    width: 120,
    height: 160,
    scaleX: 1,
    centerX: 460,
    centerRatio: 0.46,
    inStage: true,
    ...extras,
  };
}

describe("hero phone chats", () => {
  it("gives each phone frame a different question", () => {
    const questions = PHONE_FRAME_INDICES.map(
      (frame) => chatForFrame(frame).question,
    );
    expect(new Set(questions).size).toBe(PHONE_FRAME_INDICES.length);
  });

  it("treats the middle of the canvas as on stage", () => {
    expect(peepInStage(500, 1000)).toBe(true);
    expect(peepInStage(50, 1000)).toBe(false);
    expect(peepInStage(950, 1000)).toBe(false);
  });

  it("accounts for a flipped peep when finding the center", () => {
    expect(peepCenterX(400, 120, 1)).toBe(460);
    expect(peepCenterX(400, 120, -1)).toBe(340);
  });

  it("picks an unused on-stage phone peep and prefers the sides", () => {
    const used = new Set<number>([6]);
    const pick = pickPhonePeepToPrompt(
      [
        peep(6, { centerRatio: 0.8, inStage: true }),
        peep(9, { centerRatio: 0.5, y: 400, inStage: true }),
        peep(31, { centerRatio: 0.78, y: 520, inStage: true }),
        peep(49, { inStage: false }),
      ],
      used,
    );
    expect(pick?.frameIndex).toBe(31);
  });

  it("builds a snapshot that marks edge peeps as off stage", () => {
    const shot = snapshotPhonePeep(
      { frameIndex: 6, x: 10, y: 200, width: 80, height: 100, scaleX: 1 },
      1000,
      800,
    );
    expect(shot.inStage).toBe(false);
    expect(shot.centerX).toBe(50);
  });
});
