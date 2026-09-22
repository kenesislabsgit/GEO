// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { runVisibleFrames } from "@/lib/visible-animation";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("offscreen animation lifecycle", () => {
  it("pauses offscreen, resumes without resetting, and cleans up completely", () => {
    const frames = new Map<number, FrameRequestCallback>();
    let nextId = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.set(++nextId, callback);
      return nextId;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    let intersect!: (entries: Array<{ isIntersecting: boolean }>) => void;
    const disconnect = vi.fn();
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: typeof intersect) {
          intersect = callback;
        }
        observe() {}
        disconnect = disconnect;
      },
    );
    const canvas = document.createElement("canvas");
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      top: 0,
      bottom: 100,
    } as DOMRect);
    let hidden = false;
    vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
    const draw = vi.fn();
    const stop = runVisibleFrames(canvas, draw);
    const advance = () => {
      const [id, callback] = [...frames][0];
      frames.delete(id);
      callback(100);
    };
    advance();
    expect(draw).toHaveBeenCalledOnce();
    intersect([{ isIntersecting: false }]);
    expect(frames.size).toBe(0);
    intersect([{ isIntersecting: true }]);
    advance();
    expect(draw).toHaveBeenCalledTimes(2);
    hidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
    expect(frames.size).toBe(0);
    hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    expect(frames.size).toBe(1);
    stop();
    expect(disconnect).toHaveBeenCalledOnce();
    intersect([{ isIntersecting: true }]);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(frames.size).toBe(0);
  });
});
