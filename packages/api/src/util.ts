import { createHash, randomUUID } from "node:crypto";
import type { Hue } from "@selfschool/shared";

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const newId = () => randomUUID();

export class HttpError extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 413 | 422 | 501,
    message: string,
  ) {
    super(message);
  }
}

const HUES: Hue[] = ["blue", "orange", "teal", "pink"];

/** Stable hue for a course that does not set one. */
export function hueFor(id: string): Hue {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return HUES[h % HUES.length]!;
}

/** 2-4 letter monogram: initials of the first words of the title ("TypeScript Fundamentals" -> "TF"). */
export function monogramFor(title: string): string {
  const words = title.split(/[^A-Za-z0-9]+/).filter(Boolean);
  let letters: string;
  if (words.length >= 2) letters = words.slice(0, 2).map((w) => w[0]!).join("");
  else {
    const parts = (words[0] ?? "?").split(/(?=[A-Z])/).filter(Boolean);
    letters = parts.length >= 2 ? parts.slice(0, 2).map((w) => w[0]!).join("") : (words[0] ?? "?").slice(0, 2);
  }
  return letters.toUpperCase().slice(0, 4) || "?";
}

// ---------- short-answer fuzzy matching ----------

export function normalizeAnswer(s: string): string {
  return s
    .toLowerCase()
    .replace(/[`"'“”‘’.,;:!?()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length]!;
}

const tokenSort = (s: string) => s.split(" ").sort().join(" ");

/** Token-sort similarity 0..100 (order-insensitive edit-distance ratio). */
export function similarity(a: string, b: string): number {
  const x = tokenSort(normalizeAnswer(a));
  const y = tokenSort(normalizeAnswer(b));
  const len = Math.max(x.length, y.length);
  if (len === 0) return 100;
  return (1 - levenshtein(x, y) / len) * 100;
}

export const FUZZY_THRESHOLD = 85;

/** Exact (normalized) match, or fuzzy match for answers of 4+ characters. */
export function shortAnswerMatches(given: string, accepted: string[]): boolean {
  const g = normalizeAnswer(given);
  if (!g) return false;
  return accepted.some((a) => {
    const n = normalizeAnswer(a);
    if (n === g) return true;
    return n.length >= 4 && similarity(g, n) >= FUZZY_THRESHOLD;
  });
}

export function shuffled<T>(items: T[], rnd: () => number = Math.random): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** yyyy-mm-dd in the server's local time zone. */
export function localDate(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
