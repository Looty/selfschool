import { useCallback, useSyncExternalStore } from "react";

export type ThemeId = "light" | "light-colorblind" | "dark" | "dark-colorblind" | "soft-dark";
export type ThemeMode = "light" | "dark";

export interface ThemeInfo {
  id: ThemeId;
  label: string;
  description: string;
  mode: ThemeMode;
}

/** The themes, in the order Settings shows them. The token values live in index.css under the same ids. */
export const THEMES: readonly ThemeInfo[] = [
  { id: "light", label: "Light default", mode: "light", description: "The standard light theme with full contrast and brightness." },
  { id: "light-colorblind", label: "Light colorblind", mode: "light", description: "For people who may find it difficult to tell reds and greens apart. Right and wrong use blue and orange." },
  { id: "dark", label: "Dark default", mode: "dark", description: "The standard dark theme with full contrast on a dark background." },
  { id: "dark-colorblind", label: "Dark colorblind", mode: "dark", description: "For people who may find it difficult to tell reds and greens apart, with a dark background." },
  { id: "soft-dark", label: "Soft dark", mode: "dark", description: "A dark theme with reduced contrast for comfortable viewing in low light." },
];

/** What the top-bar button flips to, keeping the colourblind choice. Soft dark has no light twin, so it returns to light. */
const TWIN: Record<ThemeId, ThemeId> = {
  light: "dark",
  dark: "light",
  "light-colorblind": "dark-colorblind",
  "dark-colorblind": "light-colorblind",
  "soft-dark": "light",
};

/** `selfschool-theme` holds the applied theme (read by index.html before first paint); `selfschool-theme-prev` the one before a toggle. */
export const THEME_KEY = "selfschool-theme";
const PREV_KEY = "selfschool-theme-prev";

export const isThemeId = (v: unknown): v is ThemeId => THEMES.some((t) => t.id === v);
export const modeOf = (id: ThemeId): ThemeMode => THEMES.find((t) => t.id === id)!.mode;

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
    /* storage blocked: the theme still applies for this session */
  }
}

/** The theme on <html> right now (index.html resolved the stored or system preference before first paint). */
export const currentTheme = (): ThemeId => {
  const t = document.documentElement.dataset.theme;
  return isThemeId(t) ? t : "light";
};

/** Applies a theme: the id for the tokens, the mode for rules that only care about light versus dark. */
export function setTheme(id: ThemeId): void {
  const el = document.documentElement;
  el.dataset.theme = id;
  el.dataset.mode = modeOf(id);
  write(THEME_KEY, id);
}

/** The theme the top-bar button switches to: back to where you came from if that was the other mode, else the twin. */
export function toggleTarget(current: ThemeId, prev: string | null): ThemeId {
  return isThemeId(prev) && modeOf(prev) !== modeOf(current) ? prev : TWIN[current];
}

function subscribe(onChange: () => void) {
  const obs = new MutationObserver(onChange);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => obs.disconnect();
}

/** The applied theme, kept in step with changes made anywhere (Settings, the top-bar button), and a toggle for the button. */
export function useTheme(): [ThemeId, () => void] {
  const theme = useSyncExternalStore(subscribe, currentTheme, () => "light" as ThemeId);
  const toggle = useCallback(() => {
    const now = currentTheme();
    const target = toggleTarget(now, read(PREV_KEY));
    write(PREV_KEY, now);
    setTheme(target);
  }, []);
  return [theme, toggle];
}
