"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

export const HERO_FLIP_WORDS = [
  "brand",
  "agency",
  "company",
  "shop",
  "studio",
  "product",
] as const;

const HOLD_MS = 2400;

const FLIP = {
  duration: 0.5,
  ease: [0.22, 1, 0.36, 1] as const,
};

const WIDTH_TRANSITION = "width 0.5s cubic-bezier(0.22, 1, 0.36, 1)";

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

function useFlipWordWidths() {
  const measureRef = useRef<HTMLSpanElement>(null);
  const [widths, setWidths] = useState<Record<string, number>>({});

  useLayoutEffect(() => {
    const root = measureRef.current;
    if (!root) {
      return;
    }

    const read = () => {
      const next: Record<string, number> = {};
      for (const node of root.querySelectorAll("[data-flip-word]")) {
        const key = node.getAttribute("data-flip-word");
        if (key) {
          next[key] = node.getBoundingClientRect().width;
        }
      }
      setWidths(next);
    };

    read();
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);

  return { widths, measureRef };
}

/**
 * Slot-style word rotate for the hero line: "your brand?"
 * In-flow sizer keeps the glyph on the same baseline as the sentence.
 */
export function HeroWordFlip() {
  const reduceMotion = usePrefersReducedMotion();
  const [index, setIndex] = useState(0);
  const { widths, measureRef } = useFlipWordWidths();
  const word = HERO_FLIP_WORDS[index];
  const label = `${word}?`;
  const width = widths[word];

  useEffect(() => {
    if (reduceMotion) {
      return;
    }

    const id = window.setInterval(() => {
      if (document.hidden) {
        return;
      }
      setIndex((current) => (current + 1) % HERO_FLIP_WORDS.length);
    }, HOLD_MS);

    return () => window.clearInterval(id);
  }, [reduceMotion]);

  if (reduceMotion) {
    return <span aria-hidden>brand?</span>;
  }

  return (
    <span
      aria-hidden
      className="relative inline-block align-baseline"
      style={{
        width: width ?? undefined,
        transition: width == null ? undefined : WIDTH_TRANSITION,
      }}
    >
      <span
        ref={measureRef}
        className="pointer-events-none invisible absolute top-0 left-0"
      >
        {HERO_FLIP_WORDS.map((item) => (
          <span
            key={item}
            data-flip-word={item}
            className="absolute top-0 left-0 whitespace-nowrap"
          >
            {item}?
          </span>
        ))}
      </span>
      <span className="invisible whitespace-nowrap">{label}</span>
      <span className="absolute inset-0 overflow-hidden">
        <AnimatePresence initial={false}>
          <motion.span
            key={label}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "-100%" }}
            transition={FLIP}
            className="absolute top-0 left-0 whitespace-nowrap"
          >
            {label}
          </motion.span>
        </AnimatePresence>
      </span>
    </span>
  );
}
