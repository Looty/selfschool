import type { Models } from "@selfschool/shared";
import { currentTheme, isThemeId, setTheme, type ThemeId } from "../../theme";

/**
 * Client-side preferences. Storage keys:
 *  - `selfschool-theme`        a ThemeId (src/theme.ts): the applied theme, read by index.html before first paint and by the top-bar toggle
 *  - `selfschool-theme-choice` a ThemeId or "system": what the user picked here ("system" = light or dark by the device)
 *  - `selfschool-reading-font` "serif" | "sans": lesson prose font; also mirrored to <html data-reading-font>
 *  - `selfschool-content-width` "narrow" | "medium" | "wide": how wide the lesson and course pages are; mirrored to
 *    <html data-content-width>, which index.css turns into the --content-scale factor
 */
export type ThemeChoice = ThemeId | "system";
export type ResolvedTheme = ThemeId;
export type ReadingFont = "serif" | "sans";

export type ContentWidth = "narrow" | "medium" | "wide";

export const THEME_CHOICE_KEY = "selfschool-theme-choice";
export const FONT_KEY = "selfschool-reading-font";
export const WIDTH_KEY = "selfschool-content-width";
export const TEXT_SIZE_KEY = "selfschool-text-size";

/** Lesson text size in px. The default is also the minimum: the text can be made bigger, never smaller. */
export const TEXT_SIZE_DEFAULT = 17;
export const TEXT_SIZE_MAX = 28;

export const WIDTH_OPTIONS = [
  { value: "narrow", label: "Narrow" },
  { value: "medium", label: "Medium" },
  { value: "wide", label: "Wide" },
] as const satisfies ReadonlyArray<{ value: ContentWidth; label: string }>;

export const FONT_OPTIONS = [
  { value: "serif", label: "Serif" },
  { value: "sans", label: "Sans" },
] as const satisfies ReadonlyArray<{ value: ReadingFont; label: string }>;

export const FONT_STACK: Record<ReadingFont, string> = {
  serif: '"IBM Plex Serif", Georgia, serif',
  sans: '"IBM Plex Sans", system-ui, sans-serif',
};

/** The theme a choice applies: "system" picks the default light or dark by the device. */
export const resolveTheme = (choice: ThemeChoice, systemDark: boolean): ResolvedTheme => (choice === "system" ? (systemDark ? "dark" : "light") : choice);

const isChoice = (v: unknown): v is ThemeChoice => v === "system" || isThemeId(v);
export const isFont = (v: unknown): v is ReadingFont => v === "serif" || v === "sans";

/**
 * Initial theme choice. The stored choice wins unless it disagrees with the theme actually applied
 * (the top-bar toggle only writes the resolved theme, so the applied one is then the user's latest pick).
 */
export function initialThemeChoice(stored: string | null, applied: ResolvedTheme, systemDark: boolean): ThemeChoice {
  if (isChoice(stored) && resolveTheme(stored, systemDark) === applied) return stored;
  return applied;
}

export const initialFont = (stored: string | null): ReadingFont => (isFont(stored) ? stored : "serif");

export const isWidth = (v: unknown): v is ContentWidth => v === "narrow" || v === "medium" || v === "wide";
export const initialWidth = (stored: string | null): ContentWidth => (isWidth(stored) ? stored : "medium");

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage blocked: the preference still applies for this session */
  }
}

export const systemPrefersDark = () => (typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)").matches : false);

export function loadThemeChoice(): ThemeChoice {
  return initialThemeChoice(read(THEME_CHOICE_KEY), currentTheme(), systemPrefersDark());
}

export function applyThemeChoice(choice: ThemeChoice): ResolvedTheme {
  const theme = resolveTheme(choice, systemPrefersDark());
  setTheme(theme);
  write(THEME_CHOICE_KEY, choice);
  return theme;
}

export const loadReadingFont = (): ReadingFont => initialFont(read(FONT_KEY));

export function applyReadingFont(font: ReadingFont) {
  document.documentElement.dataset.readingFont = font;
  write(FONT_KEY, font);
}

export const loadContentWidth = (): ContentWidth => initialWidth(read(WIDTH_KEY));

/** Sets the width for this page load without writing storage (used at startup). */
export function restoreContentWidth() {
  document.documentElement.dataset.contentWidth = loadContentWidth();
}

/** Keeps other open tabs in step when the width or text size is changed in one of them (the page that changes it updates itself). */
export function syncPrefsAcrossTabs() {
  window.addEventListener("storage", (e) => {
    if (e.key === WIDTH_KEY || e.key === null) restoreContentWidth();
    if (e.key === TEXT_SIZE_KEY || e.key === null) restoreTextSize();
  });
}

export const clampTextSize = (n: number): number => (Number.isFinite(n) ? Math.min(TEXT_SIZE_MAX, Math.max(TEXT_SIZE_DEFAULT, Math.round(n))) : TEXT_SIZE_DEFAULT);
export const initialTextSize = (stored: string | null): number => (stored === null ? TEXT_SIZE_DEFAULT : clampTextSize(Number(stored)));
export const loadTextSize = (): number => initialTextSize(read(TEXT_SIZE_KEY));

function setScale(size: number) {
  document.documentElement.style.setProperty("--prose-scale", String(size / TEXT_SIZE_DEFAULT));
}

/** Applies the stored text size for this page load (used at startup and when another tab changes it). */
export function restoreTextSize() {
  setScale(loadTextSize());
}

export function applyTextSize(size: number): number {
  const s = clampTextSize(size);
  setScale(s);
  write(TEXT_SIZE_KEY, String(s));
  return s;
}

export function applyContentWidth(width: ContentWidth) {
  document.documentElement.dataset.contentWidth = width;
  write(WIDTH_KEY, width);
}

// ---------- model selects ----------

/** One select drives two model slots (chat + grade, generate + verify). */
export type ModelPair = readonly [keyof Models, keyof Models];
export const CHAT_GRADE: ModelPair = ["chat", "grade"];
export const GENERATE_VERIFY: ModelPair = ["generate", "verify"];

export function pairState(models: Models, pair: ModelPair): { value: string; mixed: boolean } {
  const [a, b] = pair;
  return { value: models[a], mixed: models[a] !== models[b] };
}

export const pairPatch = (pair: ModelPair, value: string): Partial<Models> => ({ [pair[0]]: value, [pair[1]]: value });

/** Allowed names, plus the current one if the server's list does not include it. */
export function modelChoices(allowed: readonly string[] | undefined, current: string): string[] {
  const list = [...(allowed ?? [])];
  return list.includes(current) ? list : [current, ...list];
}

// ---------- add package form ----------

export interface PackageForm {
  url: string;
  path: string;
  ref: string;
}

export function validatePackageForm(f: PackageForm): string | null {
  const url = f.url.trim();
  if (!url) return "Enter the repository URL.";
  if (/\s/.test(url)) return "The URL cannot contain spaces.";
  return null;
}

export const packageBody = (f: PackageForm) => ({ url: f.url.trim(), path: f.path.trim(), ref: f.ref.trim() || "main" });

export const shortSha = (sha: string) => sha.slice(0, 7);

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}
