import { isRtl } from "@selfschool/shared";

/** The language the reader wants course text in (a language code); empty = each course's own. Sent with every request. */
export const CONTENT_LANGUAGE_KEY = "selfschool-content-language";

export function loadContentLanguage(): string {
  try {
    return localStorage.getItem(CONTENT_LANGUAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveContentLanguage(code: string): void {
  try {
    if (code) localStorage.setItem(CONTENT_LANGUAGE_KEY, code);
    else localStorage.removeItem(CONTENT_LANGUAGE_KEY);
  } catch {
    /* storage blocked: the choice lasts until the page is reloaded only if kept elsewhere, otherwise it is not saved */
  }
}

/** The language a course is shown in: the reader's choice when the course has it, else its own. */
export function readingLanguage(course: { language: string; translations: string[] }): string {
  const want = loadContentLanguage();
  return want && (want === course.language || course.translations.includes(want)) ? want : course.language;
}

/** A language's name in itself ("עברית"), so a reader can find theirs without knowing the English name. */
export function languageName(code: string): string {
  try {
    const name = new Intl.DisplayNames([code], { type: "language" }).of(code);
    return name ? name.charAt(0).toLocaleUpperCase(code) + name.slice(1) : code;
  } catch {
    return code;
  }
}

/** Text direction for text in `language`; undefined leaves the page's own direction alone. */
export const textDirection = (language: string | undefined): "rtl" | "ltr" | undefined => (language ? (isRtl(language) ? "rtl" : "ltr") : undefined);

/** Languages offered in Settings: the ones people most often ask for. Any code a course ships is also accepted by the api. */
export const COMMON_LANGUAGES = ["en", "he", "ar", "es", "fr", "de", "pt", "ru", "it", "zh", "ja", "hi"] as const;
