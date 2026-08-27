"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import Dither, { type Rgb } from "@/components/site/dither";
import { SEA } from "@/lib/brand";

function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const SEA_RGB = hexToRgb(SEA);

const DITHER_LIGHT = {
  waveColor: SEA_RGB,
  waveBg: [0.97, 0.97, 0.96] as Rgb,
};

const DITHER_DARK = {
  waveColor: [0.58, 0.58, 0.6] as Rgb,
  waveBg: [0.02, 0.02, 0.02] as Rgb,
};

const WAVE_SPEED = 0.05;
const WAVE_FREQUENCY = 3;
const WAVE_AMPLITUDE = 0.3;
const COLOR_NUM = 4;
const PIXEL_SIZE = 2;
const MOUSE_RADIUS = 0.3;

const emptySubscribe = () => () => {};

function useMounted(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}

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
 * Full-bleed dithered wave behind the landing hero. Pointer-events are
 * off so the form on top stays usable; the wave still follows the cursor
 * via a window listener inside the effect.
 */
export function HeroDither() {
  const { resolvedTheme } = useTheme();
  const mounted = useMounted();
  const reducedMotion = usePrefersReducedMotion();
  const theme = resolvedTheme === "light" ? DITHER_LIGHT : DITHER_DARK;

  if (!mounted) {
    return <div className="absolute inset-0 bg-background" aria-hidden />;
  }

  return (
    <div className="absolute inset-0 pointer-events-none" aria-hidden>
      <Dither
        waveSpeed={WAVE_SPEED}
        waveFrequency={WAVE_FREQUENCY}
        waveAmplitude={WAVE_AMPLITUDE}
        waveColor={theme.waveColor}
        waveBg={theme.waveBg}
        colorNum={COLOR_NUM}
        pixelSize={PIXEL_SIZE}
        disableAnimation={reducedMotion}
        enableMouseInteraction={!reducedMotion}
        mouseRadius={MOUSE_RADIUS}
      />
    </div>
  );
}
