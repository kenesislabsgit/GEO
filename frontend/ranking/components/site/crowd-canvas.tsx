"use client";

import { gsap } from "gsap";
import { useEffect, useRef } from "react";
import {
  snapshotPhonePeep,
  type PhonePeepSnapshot,
} from "@/lib/hero-phone-chats";

const SHEET_COLUMNS = 15;
const SHEET_ROWS = 7;
const WALK_X_DURATION = 10;
const WALK_Y_DURATION = 0.25;
const WALK_SPEED_MIN = 0.5;
const WALK_SPEED_MAX = 1.5;
/** Crowd keeps walking during a phone chat, just not at full speed. */
const CHAT_WALK_TIME_SCALE = 0.32;
const BOB_OFFSET = 10;
const SPAWN_Y_BASE = 100;
const SPAWN_Y_SPREAD = 250;

export type { PhonePeepSnapshot };

type CrowdCanvasProps = {
  src: string;
  rows?: number;
  cols?: number;
  paused?: boolean;
  slowed?: boolean;
  className?: string;
  onPeeps?: (peeps: PhonePeepSnapshot[]) => void;
};

type WalkProps = {
  startX: number;
  startY: number;
  endX: number;
};

type StageSize = {
  width: number;
  height: number;
};

type Peep = {
  image: HTMLImageElement;
  frameIndex: number;
  rect: [number, number, number, number];
  width: number;
  height: number;
  x: number;
  y: number;
  anchorY: number;
  scaleX: number;
  walk: gsap.core.Timeline | null;
  baseTimeScale: number;
  setRect: (rect: [number, number, number, number]) => void;
  render: (ctx: CanvasRenderingContext2D) => void;
};

function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randomIndex(length: number): number {
  if (length <= 0) return 0;
  return Math.floor(randomRange(0, length));
}

function removeAt<T>(array: T[], index: number): T | undefined {
  if (index < 0 || index >= array.length) return undefined;
  return array.splice(index, 1)[0];
}

function removeItem<T>(array: T[], item: T): T | undefined {
  return removeAt(array, array.indexOf(item));
}

function takeRandom<T>(array: T[]): T | undefined {
  return removeAt(array, randomIndex(array.length));
}

function pickRandom<T>(array: readonly T[]): T | undefined {
  if (array.length === 0) return undefined;
  return array[randomIndex(array.length)];
}

function resetPeep(stage: StageSize, peep: Peep): WalkProps {
  const direction = Math.random() > 0.5 ? 1 : -1;
  const offsetY = SPAWN_Y_BASE - SPAWN_Y_SPREAD * gsap.parseEase("power2.in")(Math.random());
  const startY = stage.height - peep.height + offsetY;
  const walkingRight = direction === 1;
  const startX = walkingRight ? -peep.width : stage.width + peep.width;
  const endX = walkingRight ? stage.width : 0;

  peep.scaleX = walkingRight ? 1 : -1;
  peep.x = startX;
  peep.y = startY;
  peep.anchorY = startY;

  return { startX, startY, endX };
}

function normalWalk(peep: Peep, props: WalkProps): gsap.core.Timeline {
  const { startY, endX } = props;
  const tl = gsap.timeline();
  const scale = randomRange(WALK_SPEED_MIN, WALK_SPEED_MAX);
  tl.timeScale(scale);
  peep.baseTimeScale = scale;
  tl.to(peep, { duration: WALK_X_DURATION, x: endX, ease: "none" }, 0);
  tl.to(
    peep,
    {
      duration: WALK_Y_DURATION,
      repeat: WALK_X_DURATION / WALK_Y_DURATION,
      yoyo: true,
      y: startY - BOB_OFFSET,
    },
    0,
  );
  return tl;
}

function createPeep(
  image: HTMLImageElement,
  rect: [number, number, number, number],
  frameIndex: number,
): Peep {
  const peep: Peep = {
    image,
    frameIndex,
    rect: [0, 0, 0, 0],
    width: 0,
    height: 0,
    x: 0,
    y: 0,
    anchorY: 0,
    scaleX: 1,
    walk: null,
    baseTimeScale: 1,
    setRect: (next) => {
      peep.rect = next;
      peep.width = next[2];
      peep.height = next[3];
    },
    render: (ctx) => {
      ctx.save();
      ctx.translate(peep.x, peep.y);
      ctx.scale(peep.scaleX, 1);
      ctx.drawImage(
        peep.image,
        peep.rect[0],
        peep.rect[1],
        peep.rect[2],
        peep.rect[3],
        0,
        0,
        peep.width,
        peep.height,
      );
      ctx.restore();
    },
  };
  peep.setRect(rect);
  return peep;
}

type CrowdControls = {
  applyRates: () => void;
};

/**
 * Walking Open Peeps crowd. Sprite grid matches the original sheet
 * (15 frames across, 7 down). Reduced-motion freezes people; a phone
 * chat only slows the walk so the crowd never hard-stops.
 */
export function CrowdCanvas({
  src,
  rows = SHEET_COLUMNS,
  cols = SHEET_ROWS,
  paused = false,
  slowed = false,
  className,
  onPeeps,
}: CrowdCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pausedRef = useRef(paused);
  const slowedRef = useRef(slowed);
  const onPeepsRef = useRef(onPeeps);
  const controlsRef = useRef<CrowdControls | null>(null);

  pausedRef.current = paused;
  slowedRef.current = slowed;
  onPeepsRef.current = onPeeps;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const stage: StageSize = { width: 0, height: 0 };
    const allPeeps: Peep[] = [];
    const availablePeeps: Peep[] = [];
    const crowd: Peep[] = [];
    let cancelled = false;
    let ticking = false;

    const emitPeeps = () => {
      const snapshots: PhonePeepSnapshot[] = [];
      for (const peep of crowd) {
        snapshots.push(snapshotPhonePeep(peep, stage.width, stage.height));
      }
      onPeepsRef.current?.(snapshots);
    };

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.scale(devicePixelRatio, devicePixelRatio);
      for (const peep of crowd) {
        peep.render(ctx);
      }
      ctx.restore();
      emitPeeps();
    };

    const startTicker = () => {
      if (ticking || cancelled) return;
      gsap.ticker.add(render);
      ticking = true;
    };

    const stopTicker = () => {
      if (!ticking) return;
      gsap.ticker.remove(render);
      ticking = false;
    };

    const applyRates = () => {
      const freeze = pausedRef.current;
      const slow = slowedRef.current;
      for (const peep of crowd) {
        if (!peep.walk) continue;
        if (freeze) {
          peep.walk.pause();
          continue;
        }
        peep.walk.resume();
        peep.walk.timeScale(
          peep.baseTimeScale * (slow ? CHAT_WALK_TIME_SCALE : 1),
        );
      }
      render();
      if (freeze) stopTicker();
      else startTicker();
    };

    controlsRef.current = { applyRates };

    const stopWalks = () => {
      for (const peep of crowd) {
        peep.walk?.kill();
        peep.walk = null;
      }
    };

    const removePeepFromCrowd = (peep: Peep) => {
      removeItem(crowd, peep);
      availablePeeps.push(peep);
    };

    const addPeepToCrowd = (): Peep | undefined => {
      const peep = takeRandom(availablePeeps);
      if (!peep) return undefined;

      const walk = normalWalk(peep, resetPeep(stage, peep)).eventCallback(
        "onComplete",
        () => {
          if (cancelled) return;
          removePeepFromCrowd(peep);
          addPeepToCrowd();
        },
      );

      if (pausedRef.current) {
        walk.progress(Math.random()).pause();
      } else {
        walk.timeScale(
          peep.baseTimeScale * (slowedRef.current ? CHAT_WALK_TIME_SCALE : 1),
        );
      }

      peep.walk = walk;
      crowd.push(peep);
      crowd.sort((a, b) => a.anchorY - b.anchorY);
      return peep;
    };

    const initCrowd = () => {
      while (availablePeeps.length) {
        const peep = addPeepToCrowd();
        if (!pausedRef.current && peep?.walk) {
          peep.walk.progress(Math.random());
        }
      }
    };

    const resize = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (width <= 0 || height <= 0) return;

      stage.width = width;
      stage.height = height;
      canvas.width = Math.floor(width * devicePixelRatio);
      canvas.height = Math.floor(height * devicePixelRatio);

      stopWalks();
      crowd.length = 0;
      availablePeeps.length = 0;
      availablePeeps.push(...allPeeps);
      initCrowd();
      render();
      if (pausedRef.current) {
        stopTicker();
      } else {
        startTicker();
      }
    };

    const createPeeps = (image: HTMLImageElement) => {
      const { naturalWidth: width, naturalHeight: height } = image;
      if (width <= 0 || height <= 0) {
        throw new Error("Crowd sprite sheet has no dimensions");
      }

      const total = rows * cols;
      const rectWidth = width / rows;
      const rectHeight = height / cols;

      for (let i = 0; i < total; i += 1) {
        allPeeps.push(
          createPeep(
            image,
            [
              (i % rows) * rectWidth,
              Math.floor(i / rows) * rectHeight,
              rectWidth,
              rectHeight,
            ],
            i,
          ),
        );
      }
    };

    const img = new Image();
    const observer = new ResizeObserver(resize);

    const start = () => {
      if (cancelled) return;
      try {
        createPeeps(img);
      } catch {
        return;
      }
      observer.observe(canvas);
      resize();
    };

    const onError = () => {
      if (cancelled) return;
      console.error("Crowd sprite sheet failed to load:", src);
    };

    img.addEventListener("load", start);
    img.addEventListener("error", onError);
    img.src = src;

    return () => {
      cancelled = true;
      img.removeEventListener("load", start);
      img.removeEventListener("error", onError);
      img.src = "";
      observer.disconnect();
      stopTicker();
      stopWalks();
      controlsRef.current = null;
      crowd.length = 0;
      availablePeeps.length = 0;
      allPeeps.length = 0;
    };
  }, [src, rows, cols]);

  useEffect(() => {
    controlsRef.current?.applyRates();
  }, [paused, slowed]);

  return <canvas ref={canvasRef} className={className} aria-hidden />;
}
