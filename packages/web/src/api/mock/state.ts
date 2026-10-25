import type {
  AnswerInput,
  AnswerResult,
  AttemptResult,
  ChatMessage,
  ExtensionSeed,
  LearnerQuestion,
  OutlineResult,
  Settings,
} from "@selfschool/shared";
import { BANK, EXAM_POOL_IDS, INITIAL_COMPLETED, OPEN_MAX, QUIZ_QUESTION_IDS, TS, lessonRef, type KeyedQuestion } from "./fixtures";

const DAY = 86_400_000;
const minutesAgo = (m: number) => Date.now() - m * 60_000;

export interface AnswerRec {
  input: AnswerInput;
  /** Open answers: epoch ms when the (simulated) runner finishes grading; Infinity = never. */
  gradeAt?: number;
  jobId?: string;
}

export interface AttemptRec {
  id: string;
  kind: "quiz" | "exam";
  targetId: string;
  title: string;
  number: number;
  startedAt: number;
  finishedAt: number | null;
  questionIds: string[];
  answers: Record<string, AnswerRec>;
  /** false for exams: nothing is revealed until the result. */
  reveal: boolean;
}

export interface ChatRec {
  msg: ChatMessage;
  /** Assistant placeholder resolves at this time (if the runner is "available"). */
  readyAt?: number;
  question?: string;
}

export interface MockDb {
  completed: Set<string>;
  attempts: Map<string, AttemptRec>;
  instances: Map<string, { id: string; examId: string; attemptId: string; startedAt: number; questionIds: string[] }>;
  chat: ChatRec[];
  jobs: Map<string, number>;
  /** Extension proposals: drafted (ready) at `readyAt`, then approved or rejected by the learner. */
  extensions: Map<string, { id: string; seed: ExtensionSeed; budgetMinutes: number; jobId: string; createdAt: number; readyAt: number; decision: "approved" | "rejected" | null; outline: OutlineResult | null; decidedAt: number | null; generation?: { startedAt: number; total: number } }>;
  reported: Set<string>;
  models: Settings["models"];
  packages: { id: string; course: typeof TS; url: string; path: string; ref: string; sha: string; status: "up_to_date" | "update_available"; latestSha: string | null }[];
  seq: number;
  /** `?ai=paused` in the URL simulates a stopped runner. */
  aiAvailable: () => boolean;
}

function seedAttempt(id: string, number: number, daysAgo: number, answer: (qid: string, i: number) => AnswerRec | null): AttemptRec {
  const answers: Record<string, AnswerRec> = {};
  EXAM_POOL_IDS.forEach((qid, i) => {
    const a = answer(qid, i + 1);
    if (a) answers[qid] = a;
  });
  const t = Date.now() - daysAgo * DAY;
  return { id, kind: "exam", targetId: "mid", title: "Mid-course exam", number, startedAt: t - 40 * 60_000, finishedAt: t, questionIds: EXAM_POOL_IDS, answers, reveal: false };
}

function pick(qid: string, wantCorrect: boolean): AnswerInput {
  const q = BANK[qid]!;
  const idx = q.options!.findIndex((o) => o.correct === wantCorrect);
  return { type: "mcq", selected: [idx] };
}

export function createDb(): MockDb {
  const paused = typeof location !== "undefined" && new URLSearchParams(location.search).get("ai") === "paused";
  const attempt1 = seedAttempt("att-mid-1", 1, 6, (qid, i) => {
    const q = BANK[qid]!;
    if (q.type === "mcq") return { input: pick(qid, i % 3 !== 0) };
    if (q.type === "short") return { input: { type: "short", text: "on" } };
    return { input: { type: "open", text: "I think narrowing is when types get smaller." }, gradeAt: 0 };
  });
  const attempt2 = seedAttempt("att-mid-2", 2, 0, (qid, i) => {
    const q = BANK[qid]!;
    if (q.type === "mcq") return { input: pick(qid, i % 7 !== 0) };
    if (q.type === "short") return { input: { type: "short", text: "in" } };
    return { input: { type: "open", text: "typeof narrows primitives; for objects you need a guard or the in operator, and it fails on aliased conditions." }, gradeAt: Infinity, jobId: `job-${qid}` };
  });
  attempt2.finishedAt = minutesAgo(30);

  return {
    completed: new Set(INITIAL_COMPLETED),
    attempts: new Map([attempt1, attempt2].map((a) => [a.id, a])),
    instances: new Map(),
    chat: [
      { msg: { id: 1, role: "user", content: "Why can't typeof tell two object types apart?", covered: null, citations: [], status: "done", jobId: null, createdAt: minutesAgo(90) } },
      {
        msg: {
          id: 2, role: "assistant", covered: true, status: "done", jobId: null, createdAt: minutesAgo(89),
          content: "At runtime `typeof` only reports `\"object\"` for every non-null object, so it cannot separate `Fish` from `Bird`. For that you write a user-defined guard with a `p is Fish` return type, or use the `in` operator when the property names differ.",
          citations: [
            { kind: "lesson", ref: "user-defined-guards", label: "User-defined guards" },
            { kind: "source", ref: "3", label: "[3] Handbook: Narrowing" },
          ],
        },
      },
      { msg: { id: 3, role: "user", content: "How do decorators work?", covered: null, citations: [], status: "done", jobId: null, createdAt: minutesAgo(60) } },
      {
        msg: {
          id: 4, role: "assistant", covered: false, status: "done", jobId: null, createdAt: minutesAgo(59), citations: [],
          content: "Not covered in this course. The lessons and sources here don't discuss decorators.",
        },
      },
    ],
    jobs: new Map(),
    extensions: new Map(),
    reported: new Set(),
    models: { grade: "haiku", chat: "haiku", generate: "sonnet", verify: "sonnet" },
    packages: [
      { id: "pkg-ts", course: TS, url: "github.com/example/selfschool-courses", path: "typescript-fundamentals", ref: "main", sha: "a3f9c21", status: "up_to_date", latestSha: null },
    ],
    seq: 100,
    aiAvailable: () => !paused,
  };
}

// ---------- answer + attempt views ----------

export function learnerQuestion(q: KeyedQuestion): LearnerQuestion {
  const base = { id: q.id, text: q.text, ...(q.code ? { code: q.code } : {}) };
  if (q.type === "mcq") return { ...base, type: "mcq", options: q.options!.map((o) => ({ text: o.text })) };
  if (q.type === "fill") {
    // shown out of authored order so the answer key is not the display order
    const chips = q.chips!.map((c, id) => ({ id, text: c.text })).sort((a, b) => ((a.id * 3) % 5) - ((b.id * 3) % 5));
    return { ...base, type: "fill", template: q.template!, chips };
  }
  return { ...base, type: q.type };
}

const norm = (s: string) => s.trim().toLowerCase().replace(/^["']|["']$/g, "");

export function answerView(db: MockDb, att: AttemptRec, qid: string): AnswerResult | null {
  const rec = att.answers[qid];
  const q = BANK[qid]!;
  if (!rec) return null;
  const base = { questionId: qid, type: q.type, jobId: rec.jobId ?? null, feedback: null } as const;

  if (q.type === "mcq" && rec.input.type === "mcq") {
    const sel = new Set(rec.input.selected);
    const correct = q.options!.every((o, i) => o.correct === sel.has(i));
    const marks = { got: correct ? 1 : 0, max: 1 };
    if (!att.reveal) return { ...base, state: "recorded", correct: null, marks: null };
    return {
      ...base, state: "scored", correct, marks,
      options: q.options!.map((o, i) => ({ ...o, selected: sel.has(i) })),
    };
  }
  if (q.type === "short" && rec.input.type === "short") {
    const correct = q.accepted!.some((a) => norm(a) === norm((rec.input as { text: string }).text));
    if (!att.reveal) return { ...base, state: "recorded", correct: null, marks: null };
    return { ...base, state: "scored", correct, marks: { got: correct ? 1 : 0, max: 1 }, accepted: q.accepted };
  }
  if (q.type === "fill" && rec.input.type === "fill") {
    const chips = q.chips!;
    const key = chips.flatMap((c, i) => (c.slot ? [[c.slot, i] as const] : [])).sort((a, b) => a[0] - b[0]).map(([, i]) => i);
    const placed = rec.input.slots;
    const right = key.filter((c, i) => placed[i] === c).length;
    if (!att.reveal) return { ...base, state: "recorded", correct: null, marks: null };
    return {
      ...base, state: "scored", correct: right === key.length, marks: { got: right / key.length, max: 1 },
      slots: key.map((c, i) => ({
        placed: chips[placed[i]!]!.text,
        correct: placed[i] === c,
        answer: chips[c]!.text,
        explanation: chips[c]!.explanation,
        ...(placed[i] === c ? {} : { placedExplanation: chips[placed[i]!]!.explanation }),
      })),
    };
  }
  if (q.type === "open" && rec.input.type === "open") {
    const text = rec.input.text;
    const done = (rec.gradeAt ?? 0) <= Date.now() && (rec.gradeAt === 0 || db.aiAvailable());
    if (!done) return { ...base, state: "grading", correct: null, marks: null, answerText: text };
    const got: number = text.length > 100 ? 2 : 1;
    return {
      ...base, state: "graded", correct: got === OPEN_MAX, marks: { got, max: OPEN_MAX }, answerText: text,
      feedback: {
        marks: { got, max: OPEN_MAX },
        points: [
          { ok: true, text: "Identifies the core idea and ties it to how the compiler narrows inside a branch." },
          { ok: got >= 2, text: got >= 2 ? "Mentions where the technique stops working." : "Does not say when the technique fails; add a concrete counterexample.", lesson: lessonRef("l06") },
        ],
      },
    };
  }
  return null;
}

const PASSING = 70;

function computeScore(db: MockDb, att: AttemptRec) {
  const views = att.questionIds.map((qid) => ({ qid, v: answerView(db, att, qid) }));
  let got = 0, max = 0, scored = 0, pending = 0, pendingMax = 0;
  const domain: Record<string, { got: number; max: number }> = {};
  const finished = att.finishedAt !== null;

  for (const { qid, v } of views) {
    const q = BANK[qid]!;
    const qMax = q.type === "open" ? OPEN_MAX : 1;
    const d = (domain[q.domainId] ??= { got: 0, max: 0 });
    if (v?.state === "grading") { pending++; pendingMax += qMax; continue; }
    if (v?.marks) { got += v.marks.got; max += v.marks.max; d.got += v.marks.got; d.max += v.marks.max; scored++; }
    else if (finished) { max += qMax; d.max += qMax; scored++; } // unanswered counts as zero once finished
  }
  const percent = max > 0 ? Math.round((got / max) * 100) : null;
  return { views, got, max, scored, pending, pendingMax, domain, finished, percent, provisional: pending > 0 };
}

export function statusOf(db: MockDb, a: AttemptRec): "in_progress" | "provisional" | "passed" | "failed" {
  if (a.finishedAt === null) return "in_progress";
  const s = computeScore(db, a);
  if (s.provisional) return "provisional";
  return (s.percent ?? 0) >= PASSING ? "passed" : "failed";
}

export function attemptView(db: MockDb, att: AttemptRec): AttemptResult {
  const { views, got, max, scored, pending, pendingMax, domain, finished, percent, provisional } = computeScore(db, att);
  const total = max + pendingMax;
  const passing = PASSING;
  const siblings = [...db.attempts.values()].filter((a) => a.targetId === att.targetId && a.kind === att.kind).sort((a, b) => a.number - b.number);

  return {
    id: att.id,
    kind: att.kind,
    course: TS,
    targetId: att.targetId,
    title: att.title,
    number: att.number,
    startedAt: att.startedAt,
    finishedAt: att.finishedAt,
    passingPercentage: passing,
    score: {
      percent, got, max, scoredCount: scored, totalCount: att.questionIds.length, pendingCount: pending,
      maxSwingPoints: total > 0 ? Math.round((pendingMax / total) * 100) : 0,
    },
    provisional,
    passed: finished && !provisional && percent !== null ? percent >= passing : null,
    byDomain: Object.entries(domain)
      .filter(([, d]) => d.max > 0)
      .map(([id, d]) => ({ id, title: id === "basics" ? "Types you actually use" : "Narrowing and unions", percent: Math.round((d.got / d.max) * 100) })),
    answers: views.flatMap(({ v }) => (v ? [v] : [])),
    missed: views.flatMap(({ qid, v }, i) => {
      const q = BANK[qid]!;
      const isPending = v?.state === "grading";
      const wrong = v?.correct === false || (finished && !v);
      if (!isPending && !wrong) return [];
      return [{ questionId: qid, number: i + 1, text: q.text, domainTitle: q.domainId === "basics" ? "Types you actually use" : "Narrowing and unions", lesson: q.lesson, pending: isPending }];
    }),
    history: siblings.map((a) => ({
      id: a.id, number: a.number, date: a.finishedAt ?? a.startedAt,
      percent: computeScore(db, a).percent,
      status: statusOf(db, a),
    })),
    ai: { available: db.aiAvailable() },
  };
}

export function newQuizAttempt(db: MockDb, title: string, targetId: string): AttemptRec {
  const number = [...db.attempts.values()].filter((a) => a.kind === "quiz" && a.targetId === targetId).length + 1;
  const att: AttemptRec = { id: `att-${++db.seq}`, kind: "quiz", targetId, title, number, startedAt: Date.now(), finishedAt: null, questionIds: QUIZ_QUESTION_IDS, answers: {}, reveal: true };
  db.attempts.set(att.id, att);
  return att;
}

export function pendingGradingCount(db: MockDb): number {
  return [...db.attempts.values()].reduce((n, a) => n + computeScore(db, a).pending, 0);
}
