// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { THEMES, currentTheme, isThemeId, modeOf, setTheme, toggleTarget } from "./theme";
import { initialThemeChoice, resolveTheme } from "./features/settings/prefs";

// vitest runs from packages/web, and import.meta.url is not a file URL under jsdom
const css = readFileSync(join(process.cwd(), "src", "index.css"), "utf8");

describe("themes", () => {
  it("has five themes, each with a mode and a description", () => {
    expect(THEMES.map((t) => t.id)).toEqual(["light", "light-colorblind", "dark", "dark-colorblind", "soft-dark"]);
    expect(THEMES.map((t) => t.mode)).toEqual(["light", "light", "dark", "dark", "dark"]);
    for (const t of THEMES) expect(t.description.length).toBeGreaterThan(20);
  });

  it("defines every theme's tokens in index.css", () => {
    for (const t of THEMES) expect(css).toContain(`[data-theme="${t.id}"]`);
    const block = (id: string, from = css.indexOf(`[data-theme="${id}"]`)) => css.slice(from).split("}")[0]!;
    // a colourblind theme shares its light or dark neutrals (so a scoped preview does not inherit the page's)
    // and then overrides only the right, wrong and warning colours in its own block
    for (const [id, base] of [["light-colorblind", "light"], ["dark-colorblind", "dark"]] as const) {
      const selector = css.slice(0, css.indexOf("{", css.indexOf(`[data-theme="${base}"]`)));
      expect(selector).toContain(`[data-theme="${id}"]`);
      const own = block(id, css.lastIndexOf(`[data-theme="${id}"]`));
      for (const token of ["--ok:", "--ok-bg:", "--bad:", "--bad-bg:", "--warn:"]) expect(own).toContain(token);
      expect(own).not.toContain("--canvas:");
    }
    for (const token of ["--canvas", "--bg", "--text", "--text3", "--accent", "--ok", "--bad", "--hue-blue", "color-scheme: dark"]) expect(block("soft-dark")).toContain(token);
  });

  it("makes right and wrong differ in hue-family for the colourblind themes (blue against orange)", () => {
    const pick = (id: string, token: string) => new RegExp(`${token}:\\s*(#[0-9a-f]{6})`, "i").exec(css.slice(css.lastIndexOf(`[data-theme="${id}"]`)))![1]!;
    const hue = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
      const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
      if (d === 0) return 0;
      const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      return Math.round(((h * 60) + 360) % 360);
    };
    for (const id of ["light-colorblind", "dark-colorblind"]) {
      expect(hue(pick(id, "--ok"))).toBeGreaterThan(190); // blue
      expect(hue(pick(id, "--ok"))).toBeLessThan(250);
      expect(hue(pick(id, "--bad"))).toBeGreaterThan(15); // orange
      expect(hue(pick(id, "--bad"))).toBeLessThan(40);
    }
  });

  it("recognises ids and their mode", () => {
    expect(isThemeId("soft-dark")).toBe(true);
    expect(isThemeId("sepia")).toBe(false);
    expect(modeOf("dark-colorblind")).toBe("dark");
    expect(modeOf("light-colorblind")).toBe("light");
  });

  it("applies a theme and its mode to <html>", () => {
    setTheme("soft-dark");
    expect(document.documentElement.dataset.theme).toBe("soft-dark");
    expect(document.documentElement.dataset.mode).toBe("dark");
    expect(currentTheme()).toBe("soft-dark");
    setTheme("light-colorblind");
    expect(document.documentElement.dataset.mode).toBe("light");
  });
});

describe("top-bar toggle", () => {
  it("flips to the twin, keeping a colourblind choice", () => {
    expect(toggleTarget("light", null)).toBe("dark");
    expect(toggleTarget("dark", null)).toBe("light");
    expect(toggleTarget("light-colorblind", null)).toBe("dark-colorblind");
    expect(toggleTarget("dark-colorblind", null)).toBe("light-colorblind");
  });
  it("returns to where you came from when that was the other mode (soft dark has no light twin)", () => {
    expect(toggleTarget("soft-dark", null)).toBe("light");
    expect(toggleTarget("light", "soft-dark")).toBe("soft-dark");
    expect(toggleTarget("light", "light-colorblind")).toBe("dark"); // same mode: ignore
    expect(toggleTarget("dark", "bogus")).toBe("light");
  });
});

describe("theme choice", () => {
  it("resolves a specific theme to itself and system to the default light or dark", () => {
    expect(resolveTheme("soft-dark", false)).toBe("soft-dark");
    expect(resolveTheme("dark-colorblind", false)).toBe("dark-colorblind");
    expect(resolveTheme("system", true)).toBe("dark");
  });
  it("keeps a stored new theme that matches what is applied, else follows the applied one", () => {
    expect(initialThemeChoice("soft-dark", "soft-dark", false)).toBe("soft-dark");
    expect(initialThemeChoice("soft-dark", "light", false)).toBe("light");
    expect(initialThemeChoice("system", "soft-dark", true)).toBe("soft-dark");
  });
});
