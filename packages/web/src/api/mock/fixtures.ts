import type { CourseRef, LessonRef } from "@selfschool/shared";
// Real sample lesson, so the reader is built against genuine directives (`:::low-confidence` etc.).
import l06Raw from "../../../../../examples/sample-courses/typescript-fundamentals/02-narrowing/lesson-03.md?raw";

export const TS: CourseRef = { id: "typescript-fundamentals", title: "TypeScript Fundamentals", monogram: "TS", hue: "blue" };

export const OTHER_COURSES = [
  { course: { id: "aws-saa", title: "AWS Solutions Architect Associate", monogram: "AWS", hue: "orange" }, lessonCount: 36, examCount: 2, percent: 18, started: true, updated: true },
  { course: { id: "postgres-internals", title: "Postgres Internals", monogram: "PG", hue: "teal" }, lessonCount: 20, examCount: 1, percent: 0, started: false, updated: false },
  { course: { id: "rust-ownership", title: "Rust Ownership", monogram: "RS", hue: "pink" }, lessonCount: 14, examCount: 1, percent: 71, started: true, updated: false },
] as const satisfies readonly { course: CourseRef; lessonCount: number; examCount: number; percent: number; started: boolean; updated: boolean }[];

export const TS_DESCRIPTION =
  "A compact course for developers who already write JavaScript. You learn how the compiler infers types, how narrowing turns a union into a precise type inside each branch, and how generics keep code reusable without losing type information.";

export const CHAPTERS = [
  { dir: "01-basics", title: "Types you actually use", lessons: ["l01", "l02", "l03"] },
  { dir: "02-narrowing", title: "Narrowing and unions", lessons: ["l04", "l05", "l06", "l07"] },
  { dir: "03-generics", title: "Generics", lessons: ["l08", "l09", "l10", "l11", "l12"] },
] as const;

export const LESSONS: Record<string, { title: string; minutes: number; revision: number }> = {
  l01: { title: "Primitives and inference", minutes: 8, revision: 1 },
  l02: { title: "Arrays and objects", minutes: 9, revision: 2 },
  l03: { title: "Functions", minutes: 10, revision: 1 },
  l04: { title: "Narrowing with typeof", minutes: 11, revision: 1 },
  l05: { title: "Unions and discriminants", minutes: 12, revision: 1 },
  l06: { title: "Type guards", minutes: 12, revision: 1 },
  l07: { title: "Exhaustiveness checks", minutes: 9, revision: 1 },
  l08: { title: "Generic functions", minutes: 10, revision: 1 },
  l09: { title: "Constraints", minutes: 12, revision: 1 },
  l10: { title: "Generic types", minutes: 11, revision: 1 },
  l11: { title: "keyof and indexed access", minutes: 10, revision: 1 },
  l12: { title: "Utility types", minutes: 13, revision: 1 },
};
export const LESSON_ORDER: string[] = CHAPTERS.flatMap((c) => [...c.lessons]);
export const lessonRef = (id: string): LessonRef => ({ id, title: LESSONS[id]!.title });
export const INITIAL_COMPLETED = ["l01", "l02", "l03", "l04", "l05"];

export const SOURCES = [
  { n: 3, title: "TypeScript Handbook: Narrowing", url: "https://www.typescriptlang.org/docs/handbook/2/narrowing.html", note: "typeof, instanceof, in, type predicates" },
  { n: 7, title: "TypeScript Handbook: More on Functions", url: "https://www.typescriptlang.org/docs/handbook/2/functions.html" },
  { n: 8, title: "TypeScript Handbook: Type Compatibility", url: "https://www.typescriptlang.org/docs/handbook/type-compatibility.html" },
];

// ---------- lesson bodies ----------

function splitLesson(raw: string): { standfirst: string; markdown: string } {
  const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").trim();
  const [first = "", ...rest] = body.split(/\r?\n\r?\n/);
  return { standfirst: first, markdown: rest.join("\n\n") };
}

export function lessonBody(id: string): { standfirst: string; markdown: string } {
  if (id === "l06") return splitLesson(l06Raw);
  const title = LESSONS[id]!.title;
  return {
    standfirst: `${title}: a short, practical walk-through of the idea and when you reach for it. [3]`,
    markdown: `## ${title}\n\nPlaceholder body for the mock layer. Real lessons come from the course package.\n\n\`\`\`ts\nconst example: string = "${id}";\n\`\`\`\n\n:::key-takeaways\n- Mock lesson content only.\n:::`,
  };
}

// ---------- question bank (answer keys live only in the mock; the real api never sends them) ----------

export interface KeyedQuestion {
  id: string;
  type: "mcq" | "short" | "open" | "fill";
  text: string;
  code?: string;
  options?: { text: string; correct: boolean; explanation: string }[];
  template?: string;
  chips?: { text: string; slot?: number; explanation: string }[];
  accepted?: string[];
  domainId: "basics" | "narrowing";
  lesson: LessonRef;
}

export const DOMAINS = [
  { id: "basics", title: "Types you actually use", weight: 30 },
  { id: "narrowing", title: "Narrowing and unions", weight: 70 },
];

const q06: KeyedQuestion[] = [
  {
    id: "q06-1", type: "mcq", text: "Which line is a type error?", code: "const n = 5;\nn = 6;\nconsole.log(n);",
    domainId: "basics", lesson: lessonRef("l01"),
    options: [
      { text: "const n = 5;", correct: false, explanation: "A declaration with an initializer is fine. The error is the later write." },
      { text: "n = 6;", correct: true, explanation: "const bindings cannot be reassigned, so TypeScript reports an error on this line." },
      { text: "console.log(n);", correct: false, explanation: "Reading a const is always allowed." },
      { text: "None of the lines", correct: false, explanation: "The second line fails, so this cannot be right." },
    ],
  },
  { id: "q06-2", type: "short", text: "What string does `typeof null` evaluate to?", accepted: ["object", '"object"', "'object'"], domainId: "narrowing", lesson: lessonRef("l04") },
  { id: "q06-3", type: "open", text: "Explain structural typing in your own words.", domainId: "narrowing", lesson: lessonRef("l05") },
  { id: "q06-4", type: "open", text: "When would you write a user-defined type guard instead of using typeof?", domainId: "narrowing", lesson: lessonRef("l06") },
  {
    id: "q06-5", type: "fill", text: "Complete the function so it returns the first element that passes the test.", domainId: "narrowing", lesson: lessonRef("l06"),
    template: "function find<T>(items: T[], test: (x: T) => boolean) {\n  for (const item of items) {\n    {{1}} {\n      {{2}}\n    }\n  }\n  {{3}}\n}",
    chips: [
      { text: "if (test(item))", slot: 1, explanation: "Runs the test on each item." },
      { text: "return item;", slot: 2, explanation: "Stops at the first item that passes." },
      { text: "return undefined;", slot: 3, explanation: "Reached only when nothing matched." },
      { text: "break;", explanation: "Leaves the loop but returns nothing for a match." },
      { text: "if (item)", explanation: "Checks the item is truthy and ignores the test." },
    ],
  },
];

/** 30-question mid-exam pool: 1-27 mcq, 28 short, 29-30 open. */
const pool: KeyedQuestion[] = Array.from({ length: 30 }, (_, k): KeyedQuestion => {
  const i = k + 1;
  const n = String(i).padStart(2, "0");
  const domainId = i <= 9 ? "basics" : "narrowing";
  const lesson = lessonRef(i <= 9 ? "l0" + (((i - 1) % 3) + 1) : "l0" + (4 + ((i - 1) % 4)));
  if (i >= 29) return { id: `x${n}`, type: "open", text: `Mid-exam open question ${i}: explain a narrowing technique and when it fails.`, domainId, lesson };
  if (i === 28) return { id: `x${n}`, type: "short", text: "Which operator narrows by property name?", accepted: ["in", "the in operator"], domainId, lesson };
  const correct = i % 3;
  return {
    id: `x${n}`, type: "mcq", text: `Mid-exam question ${i}: which statement about narrowing is true?`, domainId, lesson,
    options: [0, 1, 2].map((o) => ({
      text: `Statement ${String.fromCharCode(65 + o)}`,
      correct: o === correct,
      explanation: o === correct ? "This follows from how the compiler tracks types per branch." : "The compiler does not behave like this.",
    })),
  };
});

export const BANK: Record<string, KeyedQuestion> = Object.fromEntries([...q06, ...pool].map((q) => [q.id, q]));
export const QUIZ_QUESTION_IDS = q06.map((q) => q.id);
export const EXAM_POOL_IDS = pool.map((q) => q.id);

export const OPEN_MAX = 3;

export const EXAMS = [
  { id: "mid", title: "Mid-course exam", questionCount: 30, durationMinutes: 45, passingPercentage: 70, maxAttempts: 3, after: "02-narrowing" },
  { id: "final", title: "Final exam", questionCount: 40, durationMinutes: 60, passingPercentage: 70, maxAttempts: 3, after: undefined },
] as const;

export const QUIZ = { id: "q06", title: "Check: type guards", passingPercentage: 70 };
