"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  THEME_MEDIA_QUERY,
  THEME_STORAGE_KEY,
  type ResolvedTheme,
  type Theme,
} from "@/lib/theme";

type ThemeContextValue = {
  theme: Theme;
  setTheme: (theme: Theme | ((current: Theme) => Theme)) => void;
  resolvedTheme: ResolvedTheme;
  themes: readonly Theme[];
  systemTheme: ResolvedTheme;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") {
      return stored;
    }
  } catch {
    // Safari private mode can throw on localStorage.
  }
  return "system";
}

function systemTheme(): ResolvedTheme {
  return window.matchMedia(THEME_MEDIA_QUERY).matches ? "dark" : "light";
}

function resolveTheme(theme: Theme): ResolvedTheme {
  return theme === "system" ? systemTheme() : theme;
}

function applyTheme(resolved: ResolvedTheme, disableTransition: boolean) {
  const root = document.documentElement;
  let restore: (() => void) | undefined;
  if (disableTransition) {
    const style = document.createElement("style");
    style.appendChild(
      document.createTextNode(
        "*,*::before,*::after{-webkit-transition:none!important;transition:none!important}",
      ),
    );
    document.head.appendChild(style);
    restore = () => {
      window.getComputedStyle(document.body);
      window.setTimeout(() => {
        style.parentNode?.removeChild(style);
      }, 1);
    };
  }
  root.classList.remove("light", "dark");
  root.classList.add(resolved);
  root.style.colorScheme = resolved;
  restore?.();
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("system");
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>("light");
  const [system, setSystem] = useState<ResolvedTheme>("light");
  const themeRef = useRef(theme);
  themeRef.current = theme;

  useEffect(() => {
    const stored = readStoredTheme();
    const sys = systemTheme();
    const resolved = stored === "system" ? sys : stored;
    setThemeState(stored);
    setSystem(sys);
    setResolvedTheme(resolved);
    applyTheme(resolved, false);

    const media = window.matchMedia(THEME_MEDIA_QUERY);
    const onMedia = () => {
      const nextSystem = systemTheme();
      setSystem(nextSystem);
      if (themeRef.current === "system") {
        setResolvedTheme(nextSystem);
        applyTheme(nextSystem, true);
      }
    };
    media.addEventListener("change", onMedia);

    const onStorage = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY) return;
      const next = readStoredTheme();
      const nextResolved = resolveTheme(next);
      setThemeState(next);
      setResolvedTheme(nextResolved);
      applyTheme(nextResolved, true);
    };
    window.addEventListener("storage", onStorage);

    return () => {
      media.removeEventListener("change", onMedia);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const setTheme = useCallback((next: Theme | ((current: Theme) => Theme)) => {
    const value = typeof next === "function" ? next(themeRef.current) : next;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, value);
    } catch {
      // Preference is still applied for this tab.
    }
    const resolved = resolveTheme(value);
    setThemeState(value);
    setResolvedTheme(resolved);
    applyTheme(resolved, true);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      setTheme,
      resolvedTheme,
      themes: ["light", "dark", "system"],
      systemTheme: system,
    }),
    [theme, setTheme, resolvedTheme, system],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return context;
}
