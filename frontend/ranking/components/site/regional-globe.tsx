"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "@/components/theme-provider";
import type { COBEOptions } from "cobe";
import { Globe } from "@/components/site/globe";
import { SUN, SEA } from "@/lib/brand";

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const SUN_RGB = hexToRgb(SUN);
const SEA_RGB = hexToRgb(SEA);

// Real markets the product tracks - same coordinates used for the "Markets"
// dashboard page, so the pins here aren't decorative fiction. Colors
// alternate between the two logo marks (the sun and the sea).
const MARKERS: COBEOptions["markers"] = [
  { location: [37.7749, -122.4194], size: 0.035, color: SEA_RGB }, // San Francisco
  { location: [51.5072, -0.1276], size: 0.028, color: SUN_RGB }, // London
  { location: [19.076, 72.8777], size: 0.035, color: SEA_RGB }, // Mumbai
  { location: [-23.5505, -46.6333], size: 0.028, color: SUN_RGB }, // Sao Paulo
  { location: [-33.8688, 151.2093], size: 0.028, color: SEA_RGB }, // Sydney
];

const BASE_CONFIG = {
  width: 800,
  height: 800,
  devicePixelRatio: 2,
  phi: 0.4,
  theta: 0.28,
  mapSamples: 16000,
  markers: MARKERS,
};

// Ocean/land contrast flips with the theme; marker colors stay the logo's
// sun/sea pair in both so the globe reads as on-brand either way.
const LIGHT_CONFIG: COBEOptions = {
  ...BASE_CONFIG,
  dark: 0,
  diffuse: 1.2,
  mapBrightness: 6,
  baseColor: [0.8, 0.83, 0.9],
  markerColor: SEA_RGB,
  glowColor: [0.9, 0.93, 1],
};

const DARK_CONFIG: COBEOptions = {
  ...BASE_CONFIG,
  dark: 1,
  diffuse: 0.4,
  mapBrightness: 1.4,
  baseColor: [0.26, 0.3, 0.38],
  markerColor: SEA_RGB,
  glowColor: [0.16, 0.22, 0.34],
};

const emptySubscribe = () => () => {};
// True only after hydration - resolvedTheme is unknown on the server, and
// creating the WebGL globe with a guessed theme would mean tearing it down
// and rebuilding it a frame later.
function useMounted(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}

export function RegionalGlobe({ className }: { className?: string }) {
  const { resolvedTheme } = useTheme();
  const mounted = useMounted();

  if (!mounted) {
    return <div className={className} aria-hidden />;
  }

  return (
    <div className={className} aria-hidden>
      <Globe config={resolvedTheme === "light" ? LIGHT_CONFIG : DARK_CONFIG} />
    </div>
  );
}
