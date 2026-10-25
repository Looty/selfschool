import type { ChapterOutline, ChatCitation } from "@selfschool/shared";
import { slugify, sourceHref } from "./markdown";

export const MIN_QUOTE = 3;
export const MAX_QUOTE = 400;

/**
 * Turns the raw text of a browser selection into the quote sent as `selection`: whitespace is
 * collapsed, very short selections are ignored, long ones are cut at a word boundary.
 */
export function selectionToQuote(raw: string, max = MAX_QUOTE): string | null {
  const text = raw.replace(/\s+/g, " ").trim();
  if (text.length < MIN_QUOTE) return null;
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s.,;:]+$/, "")}…`;
}

/** Label for the quote chip above the ask box, shortened for display only. */
export function quotePreview(quote: string, max = 90): string {
  return quote.length <= max ? quote : `${quote.slice(0, max - 1).trimEnd()}…`;
}

/** Where a tutor citation chip points: a lesson of this course, a Sources entry, or a section here. */
export function citationHref(c: ChatCitation, courseId: string, chapters: ChapterOutline[]): string {
  if (c.kind === "source") {
    const n = Number(c.ref.replace(/\D/g, ""));
    return Number.isFinite(n) && n > 0 ? sourceHref(n) : "#sources";
  }
  const lesson = chapters.flatMap((ch) => ch.lessons).find((l) => l.id === c.ref);
  if (lesson) return `/courses/${courseId}/lessons/${lesson.id}`;
  return `#${slugify(c.ref)}`;
}
