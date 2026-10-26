import { z } from "zod";
import type { Quiz } from "./course.js";

/**
 * Translations of a course live inside its package under `i18n/<language>/`, mirroring the chapter folders:
 *
 *   i18n/he/course.yaml                  titles (this file)
 *   i18n/he/01-basics/lesson-01.md       the lesson, same frontmatter `id`
 *   i18n/he/01-basics/quiz-01.yaml       the quiz, same ids and structure
 *
 * Ids, option order, correct flags and every number stay identical to the source course, so progress, attempts and
 * grading work in either language. A file that is not translated falls back to the source language.
 */
export const LANGUAGE_CODE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

/** `i18n/<lang>/course.yaml`: the titles shown in lists and outlines, so those never need to open a lesson file. */
export const translationManifestSchema = z.object({
  title: z.string().min(1).optional(),
  short_intro: z.string().min(1).optional(),
  description: z.string().optional(),
  /** Chapter title by chapter folder name. */
  chapters: z.record(z.string(), z.string().min(1)).default({}),
  /** Lesson title by lesson id; must equal the `title` in that lesson's translated frontmatter. */
  lessons: z.record(z.string(), z.string().min(1)).default({}),
});
export type TranslationManifest = z.infer<typeof translationManifestSchema>;

/** Right-to-left languages: the reader sets `dir="rtl"` on lesson and quiz text (code stays left-to-right). */
export const RTL_LANGUAGES = new Set(["he", "ar", "fa", "ur", "yi"]);
export const isRtl = (lang: string): boolean => RTL_LANGUAGES.has(lang.split("-")[0]!.toLowerCase());

/** Strings that are not display text: identifiers and file names must be identical in a translation. */
const KEEP = new Set(["id", "type", "image", "shape"]);
/** Lists whose length may differ (a translator may add or drop accepted spellings). */
const LOOSE = new Set(["answers"]);

function shapeOf(value: unknown, key?: string): unknown {
  if (typeof value === "string") return key && KEEP.has(key) ? value : "s";
  if (Array.isArray(value)) return key && LOOSE.has(key) ? "list" : value.map((v) => shapeOf(v));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([k, v]) => [k, shapeOf(v, k)]),
    );
  }
  return value; // numbers, booleans, null: correct flags, slots, line numbers, passing percentage
}

/**
 * What must not differ between a quiz and its translation: the structure, every number and flag, and the ids.
 * Multiple-choice answers are graded by option position, so a reordered translation would mark right answers wrong.
 * Returns one message per differing question (or for the quiz as a whole); empty when the translation is safe.
 */
export function quizParityIssues(source: Quiz, translated: Quiz): string[] {
  const issues: string[] = [];
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  if (source.id !== translated.id) issues.push(`quiz id is "${translated.id}", the source has "${source.id}"`);
  const { questions: sq, ...sRest } = source;
  const { questions: tq, ...tRest } = translated;
  if (!same(shapeOf(sRest), shapeOf(tRest))) issues.push("quiz settings (passing percentage, attempts, show_answers) differ from the source");
  if (sq.length !== tq.length) issues.push(`has ${tq.length} questions, the source has ${sq.length}`);
  sq.forEach((q, i) => {
    const t = tq[i];
    if (!t) return;
    if (q.id !== t.id) issues.push(`question ${i + 1} has id "${t.id}", the source has "${q.id}": keep the order and ids`);
    else if (!same(shapeOf(q), shapeOf(t))) issues.push(`question "${q.id}" differs in structure from the source (option order, correct flags, counts or numbers)`);
  });
  return issues;
}
