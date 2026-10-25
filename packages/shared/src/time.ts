/**
 * How long a course takes, from its content. Constants are deliberately plain so the numbers can be
 * explained to a learner: 200 words a minute for prose, 6 seconds a line for code, 15 seconds per image,
 * and a fixed allowance per question (a written answer takes longest).
 */
export const READING_WPM = 200;
export const CODE_SECONDS_PER_LINE = 6;
export const IMAGE_SECONDS = 15;
export const QUESTION_MINUTES = { mcq: 0.75, short: 1, open: 4, fill: 1.5, sort: 1.5, spot: 1, hotspot: 1, match: 1.5, trace: 2.5 } as const;

/** Depth choices for an extension, in learner minutes (lessons plus their quizzes). */
export const DEPTH_OPTIONS = [
  { minutes: 15, label: "15 min" },
  { minutes: 60, label: "1 hour" },
  { minutes: 240, label: "4 hours" },
  { minutes: 720, label: "12 hours" },
] as const;
export const DEFAULT_DEPTH_MINUTES = 60;

/** Planning size of one lesson with its quiz, used to turn a budget into a lesson count and back before anything is written. */
export const PLANNED_LESSON_MINUTES = 12;
export const plannedMinutes = (lessonCount: number) => lessonCount * PLANNED_LESSON_MINUTES;

/** Reading minutes for one lesson body (markdown, frontmatter already removed). At least 1. */
export function lessonMinutes(body: string): number {
  let codeLines = 0;
  const prose = body
    .replace(/```[^\n]*\n([\s\S]*?)```/g, (_, code: string) => {
      codeLines += code.split("\n").filter((l) => l.trim() !== "").length;
      return " ";
    })
    .replace(/^:::.*$/gm, " ") // directive fences (:::low-confidence, :::key-takeaways, :::)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // images are timed separately
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // link text counts, the URL does not
    .replace(/[#>*_`|-]+/g, " ");
  const images = (body.match(/!\[[^\]]*\]\([^)]*\)/g) ?? []).length;
  const words = prose.split(/\s+/).filter(Boolean).length;
  const minutes = words / READING_WPM + (codeLines * CODE_SECONDS_PER_LINE + images * IMAGE_SECONDS) / 60;
  return Math.max(1, Math.ceil(minutes));
}

/** Minutes to answer a quiz once, rounded up. */
export function quizMinutes(questions: readonly { type: keyof typeof QUESTION_MINUTES }[]): number {
  return Math.ceil(questions.reduce((n, q) => n + QUESTION_MINUTES[q.type], 0));
}

/** "45 min", "2 h", "2 h 15 min"; rounds to 5 minutes above an hour so the estimate doesn't look exact. */
export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const r = Math.round(m / 5) * 5;
  const h = Math.floor(r / 60);
  const rest = r % 60;
  return rest === 0 ? `${h} h` : `${h} h ${rest} min`;
}
