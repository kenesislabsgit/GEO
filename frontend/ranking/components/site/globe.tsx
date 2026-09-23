"use client";

import { useEffect, useRef } from "react";
import createGlobe, { type COBEOptions } from "cobe";
import { useMotionValue, useSpring } from "motion/react";
import { cn } from "@/lib/utils";
import { runVisibleFrames } from "@/lib/visible-animation";

const MOVEMENT_DAMPING = 1400;
const AUTOROTATE_SPEED = 0.004;

export function Globe({
  className,
  config,
}: {
  className?: string;
  config: COBEOptions;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const phiRef = useRef(config.phi);
  const widthRef = useRef(0);
  const pointerInteracting = useRef<number | null>(null);

  const r = useMotionValue(0);
  const rs = useSpring(r, { mass: 1, damping: 30, stiffness: 100 });

  const updatePointerInteraction = (value: number | null) => {
    pointerInteracting.current = value;
    if (canvasRef.current) {
      canvasRef.current.style.cursor = value !== null ? "grabbing" : "grab";
    }
  };

  const updateMovement = (clientX: number) => {
    if (pointerInteracting.current !== null) {
      const delta = clientX - pointerInteracting.current;
      r.set(r.get() + delta / MOVEMENT_DAMPING);
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onResize = () => {
      widthRef.current = canvas.offsetWidth;
    };
    window.addEventListener("resize", onResize);
    onResize();

    // cobe@2 has no internal render loop - createGlobe paints one frame and
    // hands back `update`, so the caller drives rotation via requestAnimationFrame.
    const globe = createGlobe(canvas, {
      ...config,
      width: widthRef.current * 2,
      height: widthRef.current * 2,
    });

    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const renderFrame = () => {
      if (!media.matches && pointerInteracting.current === null) phiRef.current += AUTOROTATE_SPEED;
      globe.update({
        phi: phiRef.current + rs.get(),
        width: widthRef.current * 2,
        height: widthRef.current * 2,
      });
    };
    let stopFrames: (() => void) | undefined;
    const syncMotion = () => {
      stopFrames?.();
      if (media.matches) renderFrame();
      else stopFrames = runVisibleFrames(canvas, renderFrame);
    };
    syncMotion();
    media.addEventListener("change", syncMotion);
    const unsubscribe = rs.on("change", () => { if (media.matches) renderFrame(); });
    const resizeObserver = new ResizeObserver(() => { onResize(); renderFrame(); });
    resizeObserver.observe(canvas);
    // COBE loads its map texture asynchronously. Refresh on entry so a static,
    // reduced-motion globe includes the land detail once it scrolls into view.
    const visibilityObserver = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting && media.matches) renderFrame();
    });
    visibilityObserver.observe(canvas);
    const opacityFrame = requestAnimationFrame(() => {
      canvas.style.opacity = "1";
    });

    return () => {
      stopFrames?.();
      cancelAnimationFrame(opacityFrame);
      resizeObserver.disconnect();
      visibilityObserver.disconnect();
      unsubscribe();
      media.removeEventListener("change", syncMotion);
      globe.destroy();
      window.removeEventListener("resize", onResize);
    };
  }, [rs, config]);

  return (
    <canvas
      ref={canvasRef}
      className={cn(
        "size-full opacity-0 transition-opacity duration-500 [contain:layout_paint_size]",
        className,
      )}
      onPointerDown={(e) => {
        pointerInteracting.current = e.clientX;
        updatePointerInteraction(e.clientX);
      }}
      onPointerUp={() => updatePointerInteraction(null)}
      onPointerOut={() => updatePointerInteraction(null)}
      onMouseMove={(e) => updateMovement(e.clientX)}
      onTouchMove={(e) => e.touches[0] && updateMovement(e.touches[0].clientX)}
    />
  );
}
