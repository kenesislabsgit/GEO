import { describe, expect, it } from "vitest";
import { THEME_INIT_SCRIPT, THEME_STORAGE_KEY } from "@/lib/theme";

describe("theme init script", () => {
  it("reads the same storage key the provider writes", () => {
    expect(THEME_INIT_SCRIPT).toContain(THEME_STORAGE_KEY);
  });

  it("sets .dark or .light on the document root", () => {
    expect(THEME_INIT_SCRIPT).toContain('classList.add(resolved)');
    expect(THEME_INIT_SCRIPT).toContain("colorScheme=resolved");
  });
});
