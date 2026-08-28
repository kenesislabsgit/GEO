/**
 * Theme bootstrap shared by the blocking layout script and the client
 * provider. Keep the localStorage key as "theme" so existing visitors
 * keep the preference next-themes already stored.
 */
export const THEME_STORAGE_KEY = "theme";

export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_MEDIA_QUERY = "(prefers-color-scheme: dark)";

/**
 * Runs before paint so the first frame already has .dark / .light on
 * <html>. A raw string, not a serialized function, so minifiers cannot
 * inject `__name`.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var root=document.documentElement;var stored=localStorage.getItem("${THEME_STORAGE_KEY}");var system=window.matchMedia("${THEME_MEDIA_QUERY}").matches?"dark":"light";var resolved=stored==="light"||stored==="dark"?stored:system;root.classList.remove("light","dark");root.classList.add(resolved);root.style.colorScheme=resolved;}catch(e){}})();`;
