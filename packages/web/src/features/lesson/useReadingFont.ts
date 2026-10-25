import { useEffect, useState } from "react";

export type ReadingFont = "serif" | "sans";
/** Written by Settings > Reading font (localStorage, like the theme). */
export const READING_FONT_KEY = "selfschool-reading-font";

function read(): ReadingFont {
  try {
    return localStorage.getItem(READING_FONT_KEY) === "sans" ? "sans" : "serif";
  } catch {
    return "serif"; // storage blocked
  }
}

/** CSS font-family for lesson prose; follows the stored preference, also across tabs. */
export function useReadingFont(): { font: ReadingFont; family: string } {
  const [font, setFont] = useState<ReadingFont>(read);
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === READING_FONT_KEY) setFont(read());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  return { font, family: font === "sans" ? "var(--font-sans)" : "var(--font-serif)" };
}
