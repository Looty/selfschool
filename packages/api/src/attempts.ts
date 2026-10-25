import { and, asc, eq, inArray } from "drizzle-orm";
import { regionAt, traceMatches } from "@selfschool/shared";
import type {
  AnswerInput,
  AnswerResult,
  AttemptResult,
  ExamBlueprint,
  LearnerQuestion,
  LessonRef,
  Question,
} from "@selfschool/shared";
import { questionKey, type LoadedCourse } from "./catalog.js";
import { completeLesson } from "./courses.js";
import { getCourse, type Ctx } from "./ctx.js";
import { attemptAnswers, attempts, examInstances, jobs, questions, xpEvents } from "./db/schema.js";
import { enqueueJob } from "./jobs.js";
import { HttpError, newId, sha256, shortAnswerMatches } from "./util.js";

/** A question as frozen into an attempt: payload copy including the answer key. */
export interface SnapQ {
  id: string;
  domain: string | null;
  chapter: string | null;
  lessonId: string | null;
  q: Question;
}

export function learnerQuestion(s: SnapQ): LearnerQuestion {
  const base = { id: s.id, text: s.q.text, ...(s.q.code ? { code: s.q.code } : {}) };
  if (s.q.type === "mcq") {
    const multiple = s.q.options.filter((o) => o.correct).length > 1;
    return { ...base, type: "mcq", options: s.q.options.map((o) => ({ text: o.text })), ...(multiple ? { multiple } : {}) };
  }
  // Authored order tends to list answers in order; a stable shuffle per question hides that.
  const shuffled = <T extends { text: string }>(list: T[]) =>
    list
      .map((x, id) => ({ id, text: x.text, key: sha256(`${s.id}:${id}`) }))
      .sort((a, b) => (a.key < b.key ? -1 : 1))
      .map(({ id, text }) => ({ id, text }));
  if (s.q.type === "fill") return { ...base, type: "fill", template: s.q.template, chips: shuffled(s.q.chips) };
  if (s.q.type === "sort") return { ...base, type: "sort", buckets: s.q.buckets, items: shuffled(s.q.items) };
  if (s.q.type === "spot") return { ...base, type: "spot", code: s.q.code, ...(s.q.diff ? { diff: true } : {}) };
  if (s.q.type === "match") {
    const left = s.q.pairs.map((p, id) => ({ id, text: p.left }));
    // ids 0..n-1 are the partners of the left items; distractors continue after them
    const right = shuffled([...s.q.pairs.map((p) => ({ text: p.right })), ...s.q.distractors.map((text) => ({ text }))]);
    return { ...base, type: "match", left, right };
  }
  if (s.q.type === "trace") {
    const steps = s.q.steps.map((st) => ({ label: st.label, given: Object.fromEntries(st.given.map((v) => [v, firstOf(st.values[v]!)])) }));
    return { ...base, type: "trace", code: s.q.code, variables: s.q.variables, steps };
  }
  if (s.q.type === "hotspot") {
    return { ...base, type: "hotspot", image: s.q.image, alt: s.q.alt, picks: s.q.regions.filter((r) => r.correct).length };
  }
  return { ...base, type: s.q.type };
}

const firstOf = (v: string | string[]): string => (Array.isArray(v) ? v[0]! : v);

/** Chip index that belongs in each slot, slot 1 first. */
const fillKey = (q: Extract<Question, { type: "fill" }>): number[] =>
  q.chips.flatMap((c, i) => (c.slot ? [[c.slot, i] as const] : [])).sort((a, b) => a[0] - b[0]).map(([, i]) => i);

export function snapFromRow(r: typeof questions.$inferSelect): SnapQ {
  return { id: r.id, domain: r.domain, chapter: r.chapter, lessonId: r.lessonId, q: r.payload as Question };
}

type AnswerRow = typeof attemptAnswers.$inferSelect & { jobStatus: string | null };

export interface AttemptData {
  row: typeof attempts.$inferSelect;
  course: LoadedCourse;
  kind: "quiz" | "exam";
  title: string;
  passing: number;
  showAnswers: boolean;
  questions: SnapQ[];
  answers: Map<string, AnswerRow>;
  blueprint: ExamBlueprint | null;
  lessonId: string | null;
}

export function loadAttempt(ctx: Ctx, attemptId: string): AttemptData {
  const { db } = ctx;
  const row = db.select().from(attempts).where(eq(attempts.id, attemptId)).get();
  if (!row) throw new HttpError(404, "attempt not found");
  const course = getCourse(ctx, row.packageId);

  let title: string;
  let passing: number;
  let showAnswers = true;
  let qs: SnapQ[];
  let blueprint: ExamBlueprint | null = null;
  let lessonId: string | null = null;
  if (row.kind === "quiz") {
    const lq = course.quizzes.get(row.targetId);
    if (!lq) throw new HttpError(404, "quiz no longer exists");
    title = lq.quiz.title;
    passing = lq.quiz.passing_percentage;
    showAnswers = lq.quiz.show_answers;
    lessonId = lq.lessonId;
    qs = lq.quiz.questions.map((q) => ({ id: questionKey(course.id, q.id), domain: null, chapter: lq.chapterDir, lessonId: lq.lessonId, q }));
  } else {
    const exam = course.exams.find((e) => e.id === row.targetId);
    const inst = row.examInstanceId ? db.select().from(examInstances).where(eq(examInstances.id, row.examInstanceId)).get() : undefined;
    if (!exam || !inst) throw new HttpError(404, "exam no longer exists");
    title = exam.blueprint.title;
    passing = exam.blueprint.passing_percentage;
    blueprint = exam.blueprint;
    qs = inst.questions as SnapQ[];
  }

  const answers = new Map<string, AnswerRow>();
  for (const a of db.select().from(attemptAnswers).where(eq(attemptAnswers.attemptId, attemptId)).all()) {
    const job = a.jobId ? db.select({ status: jobs.status }).from(jobs).where(eq(jobs.id, a.jobId)).get() : undefined;
    answers.set(a.questionId, { ...a, jobStatus: job?.status ?? null });
  }
  return { row, course, kind: row.kind, title, passing, showAnswers, questions: qs, answers, blueprint, lessonId };
}

/** Whether answer keys / correctness may be shown for this attempt right now. */
export const isRevealed = (a: AttemptData) => (a.kind === "quiz" && a.showAnswers) || a.row.finishedAt !== null;

const round1 = (n: number) => Math.round(n * 10) / 10;

export interface Summary {
  percent: number | null;
  got: number;
  max: number;
  scoredCount: number;
  totalCount: number;
  pendingCount: number;
  maxSwingPoints: number;
  provisional: boolean;
  passed: boolean | null;
  status: "in_progress" | "provisional" | "passed" | "failed";
}

export function summarize(a: AttemptData): Summary {
  const finished = a.row.finishedAt !== null;
  let got = 0;
  let scored = 0;
  let pending = 0;
  for (const s of a.questions) {
    const ans = a.answers.get(s.id);
    if (!ans) {
      if (finished) scored++;
    } else if (ans.marks === null) pending++;
    else {
      scored++;
      got += ans.marks;
    }
  }
  const percent = scored > 0 ? round1((got / scored) * 100) : null;
  let swing = 0;
  if (pending > 0) {
    const total = scored + pending;
    const cur = percent ?? 0;
    swing = round1(Math.max(Math.abs(((got + pending) / total) * 100 - cur), Math.abs((got / total) * 100 - cur)));
  }
  const provisional = pending > 0;
  const passed = finished && !provisional ? (percent ?? 0) >= a.passing : null;
  return {
    percent, got, max: scored, scoredCount: scored, totalCount: a.questions.length, pendingCount: pending, maxSwingPoints: swing,
    provisional, passed,
    status: !finished ? "in_progress" : provisional ? "provisional" : passed ? "passed" : "failed",
  };
}

function parsePoints(feedback: string | null) {
  if (!feedback) return [];
  try {
    return JSON.parse(feedback) as { ok: boolean; text: string }[];
  } catch {
    return [];
  }
}

export function answerView(a: AttemptData, snap: SnapQ, ans: AnswerRow | undefined): AnswerResult | null {
  if (!ans) return null;
  const revealed = isRevealed(a);
  const q = snap.q;
  const failed = ans.grader === "ai" && ans.jobStatus === "failed" && ans.marks === null;
  const input = ans.answer as AnswerInput;
  const base = { questionId: snap.id, type: q.type, jobId: ans.jobId };
  if (!revealed) {
    return { ...base, state: failed ? "failed" : "recorded", correct: null, marks: null, feedback: null };
  }
  const marks = ans.marks === null ? null : { got: ans.marks, max: 1 };
  if (q.type === "mcq" && input.type === "mcq") {
    return {
      ...base, state: "scored", correct: ans.correct, marks, feedback: null,
      options: q.options.map((o, i) => ({ text: o.text, correct: o.correct, selected: input.selected.includes(i), explanation: o.explanation })),
    };
  }
  if (q.type === "short") {
    return { ...base, state: "scored", correct: ans.correct, marks, feedback: null, accepted: q.answers };
  }
  if (q.type === "fill" && input.type === "fill") {
    const slots = fillKey(q).map((right, i) => {
      const placed = q.chips[input.slots[i]!]!;
      return {
        placed: placed.text,
        correct: input.slots[i] === right,
        answer: q.chips[right]!.text,
        explanation: q.chips[right]!.explanation,
        ...(input.slots[i] === right ? {} : { placedExplanation: placed.explanation }),
      };
    });
    return { ...base, state: "scored", correct: ans.correct, marks, feedback: null, slots };
  }
  if (q.type === "sort" && input.type === "sort") {
    const sorted = q.items.map((it, id) => ({
      id,
      text: it.text,
      placed: q.buckets[input.buckets[id]!]!,
      correct: q.buckets[input.buckets[id]!] === it.bucket,
      answer: it.bucket,
      explanation: it.explanation,
    }));
    return { ...base, state: "scored", correct: ans.correct, marks, feedback: null, sorted };
  }
  if (q.type === "spot" && input.type === "spot") {
    return { ...base, state: "scored", correct: ans.correct, marks, feedback: null, spot: { picked: input.lines, correct: q.correct, explanation: q.explanation } };
  }
  if (q.type === "match" && input.type === "match") {
    const rights = [...q.pairs.map((p) => p.right), ...q.distractors];
    const matches = q.pairs.map((p, id) => ({
      id,
      left: p.left,
      placed: rights[input.pairs[id]!] ?? null,
      correct: input.pairs[id] === id,
      answer: p.right,
      explanation: p.explanation,
    }));
    return { ...base, state: "scored", correct: ans.correct, marks, feedback: null, matches };
  }
  if (q.type === "trace" && input.type === "trace") {
    const steps = q.steps.map((st, r) => ({
      label: st.label,
      cells: q.variables.map((v, c) => {
        const given = st.given.includes(v);
        const want = st.values[v]!;
        const typed = given ? firstOf(want) : (input.cells[r]?.[c] ?? "");
        return { given, placed: typed, correct: given || traceMatches(typed, want), answer: firstOf(want) };
      }),
    }));
    return { ...base, state: "scored", correct: ans.correct, marks, feedback: null, trace: { variables: q.variables, steps, explanation: q.explanation } };
  }
  if (q.type === "hotspot" && input.type === "hotspot") {
    const points = input.points.map((p) => {
      const r = regionAt(q.regions, p);
      return { x: p.x, y: p.y, ok: !!r?.correct, region: r?.name ?? null };
    });
    const regions = q.regions.map((r) => ({ ...r, hit: points.some((p) => p.region === r.name) }));
    return { ...base, state: "scored", correct: ans.correct, marks, feedback: null, hotspot: { regions, points } };
  }
  const answerText = input.type === "open" ? input.text : "";
  if (ans.marks !== null) {
    return { ...base, state: "graded", correct: ans.correct, marks, answerText, feedback: { marks: { got: ans.marks, max: 1 }, points: parsePoints(ans.feedback) } };
  }
  return { ...base, state: failed ? "failed" : "grading", correct: null, marks: null, answerText, feedback: null };
}

function domainLesson(a: AttemptData, s: SnapQ): LessonRef | null {
  let id = s.lessonId;
  if (!id && s.chapter) id = a.course.lessons.find((l) => l.chapterDir === s.chapter)?.id ?? null;
  if (!id && s.domain && a.blueprint) {
    const ch = a.blueprint.domains.find((d) => d.id === s.domain)?.chapters[0];
    if (ch) id = a.course.lessons.find((l) => l.chapterDir === ch)?.id ?? null;
  }
  const l = id ? a.course.lessonById.get(id) : undefined;
  return l ? { id: l.id, title: l.title } : null;
}

export function buildAttemptResult(ctx: Ctx, attemptId: string): AttemptResult {
  const a = loadAttempt(ctx, attemptId);
  const sum = summarize(a);
  const revealed = isRevealed(a);
  const answers: AnswerResult[] = [];
  const missed: AttemptResult["missed"] = [];
  a.questions.forEach((s, i) => {
    const ans = a.answers.get(s.id);
    const view = answerView(a, s, ans);
    if (view) answers.push(view);
    const pending = !!ans && ans.marks === null;
    const wrong = revealed && ((ans && ans.marks !== null && ans.marks < 1) || (!ans && a.row.finishedAt !== null));
    if (pending || wrong) {
      const dom = a.blueprint?.domains.find((d) => d.id === s.domain);
      missed.push({ questionId: s.id, number: i + 1, text: s.q.text, domainTitle: dom?.title ?? null, lesson: domainLesson(a, s), pending });
    }
  });

  const byDomain: AttemptResult["byDomain"] = [];
  if (a.blueprint && a.row.finishedAt !== null) {
    for (const d of a.blueprint.domains) {
      const qs = a.questions.filter((s) => s.domain === d.id);
      if (qs.length === 0) continue;
      const got = qs.reduce((n, s) => n + (a.answers.get(s.id)?.marks ?? 0), 0);
      byDomain.push({ id: d.id, title: d.title, percent: round1((got / qs.length) * 100) });
    }
  }

  return {
    id: a.row.id,
    kind: a.kind,
    course: a.course.ref,
    targetId: a.row.targetId,
    title: a.title,
    number: a.row.number,
    startedAt: a.row.startedAt,
    finishedAt: a.row.finishedAt,
    passingPercentage: a.passing,
    score: {
      percent: sum.percent, got: sum.got, max: sum.max, scoredCount: sum.scoredCount, totalCount: sum.totalCount,
      pendingCount: sum.pendingCount, maxSwingPoints: sum.maxSwingPoints,
    },
    provisional: sum.provisional,
    passed: sum.passed,
    byDomain,
    answers,
    missed,
    history: attemptHistory(ctx, a.row.packageId, a.kind, a.row.targetId),
    ai: { available: ctx.aiAvailable() },
  };
}

/** Attempts at one target, oldest first. */
export function listAttempts(ctx: Ctx, packageId: string, kind: "quiz" | "exam", targetId: string): AttemptData[] {
  return ctx.db
    .select({ id: attempts.id })
    .from(attempts)
    .where(and(eq(attempts.packageId, packageId), eq(attempts.kind, kind), eq(attempts.targetId, targetId)))
    .orderBy(asc(attempts.number))
    .all()
    .map(({ id }) => loadAttempt(ctx, id));
}

/**
 * A finished quiz attempt clears the lesson gate when the answers scored so far meet the pass mark, even
 * while AI-graded answers are still pending, so an offline runner never traps the learner on a lesson.
 */
export function quizGateCleared(ctx: Ctx, packageId: string, quizId: string): boolean {
  return listAttempts(ctx, packageId, "quiz", quizId).some((a) => {
    const s = summarize(a);
    return a.row.finishedAt !== null && s.percent !== null && s.percent >= a.passing;
  });
}

export function attemptHistory(ctx: Ctx, packageId: string, kind: "quiz" | "exam", targetId: string) {
  return listAttempts(ctx, packageId, kind, targetId).map((a) => {
    const s = summarize(a);
    return { id: a.row.id, number: a.row.number, date: a.row.finishedAt ?? a.row.startedAt, percent: s.percent, status: s.status };
  });
}

/** Every attempt across courses, newest first. Attempts whose quiz/exam left the package are skipped. */
export function listAllAttempts(ctx: Ctx) {
  const rows = ctx.db.select({ id: attempts.id }).from(attempts).all();
  const items = rows.flatMap(({ id }) => {
    try {
      const a = loadAttempt(ctx, id);
      const s = summarize(a);
      return [
        {
          id: a.row.id,
          kind: a.kind,
          course: getCourse(ctx, a.row.packageId).ref,
          targetId: a.row.targetId,
          title: a.title,
          number: a.row.number,
          date: a.row.finishedAt ?? a.row.startedAt,
          percent: s.percent,
          status: s.status,
          pendingCount: s.pendingCount,
        },
      ];
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) return [];
      throw e;
    }
  });
  return { attempts: items.sort((x, y) => y.date - x.date) };
}

/** Deletes an attempt and its answers; its queued AI grading jobs are failed so the runner skips them. */
export function deleteAttempt(ctx: Ctx, attemptId: string) {
  const row = ctx.db.select().from(attempts).where(eq(attempts.id, attemptId)).get();
  if (!row) throw new HttpError(404, "attempt not found");
  ctx.db.transaction((tx) => {
    const answers = tx.select().from(attemptAnswers).where(eq(attemptAnswers.attemptId, attemptId)).all();
    for (const a of answers) {
      if (a.jobId) {
        tx.update(jobs).set({ status: "failed", error: "attempt deleted", updatedAt: ctx.now() })
          .where(and(eq(jobs.id, a.jobId), inArray(jobs.status, ["pending", "running"]))).run();
      }
    }
    tx.delete(attemptAnswers).where(eq(attemptAnswers.attemptId, attemptId)).run();
    tx.delete(attempts).where(eq(attempts.id, attemptId)).run();
  });
  return { deleted: true as const };
}

export function awardXp(ctx: Ctx, amount: number, reason: string, ref: string) {
  ctx.db.insert(xpEvents).values({ at: ctx.now(), amount, reason, ref }).onConflictDoNothing().run();
}

export function createAttempt(
  ctx: Ctx,
  v: { packageId: string; kind: "quiz" | "exam"; targetId: string; examInstanceId?: string },
): string {
  const { db } = ctx;
  // Highest existing number, not the count: deleted attempts leave gaps and numbers must stay unique.
  const n = Math.max(
    0,
    ...db
      .select({ number: attempts.number })
      .from(attempts)
      .where(and(eq(attempts.packageId, v.packageId), eq(attempts.kind, v.kind), eq(attempts.targetId, v.targetId)))
      .all()
      .map((r) => r.number),
  );
  const id = newId();
  db.insert(attempts)
    .values({
      id, packageId: v.packageId, kind: v.kind, targetId: v.targetId, number: n + 1, startedAt: ctx.now(),
      quizId: v.kind === "quiz" ? v.targetId : null, examInstanceId: v.examInstanceId ?? null,
    })
    .run();
  return id;
}

export function startQuizAttempt(ctx: Ctx, courseId: string, quizId: string): string {
  const course = getCourse(ctx, courseId);
  const lq = course.quizzes.get(quizId);
  if (!lq) throw new HttpError(404, "quiz not found");
  const used = attemptHistory(ctx, course.id, "quiz", quizId).length;
  if (lq.quiz.max_attempts > 0 && used >= lq.quiz.max_attempts) throw new HttpError(409, "no attempts left for this quiz");
  return createAttempt(ctx, { packageId: course.id, kind: "quiz", targetId: quizId });
}

function gradeContext(a: AttemptData, s: SnapQ): string {
  const parts: string[] = [];
  const lesson = s.lessonId ? a.course.lessonById.get(s.lessonId) : undefined;
  if (lesson) parts.push(`# Lesson: ${lesson.title}\n\n${lesson.body}`);
  const nums = new Set([...s.q.sources, ...(lesson?.sourceNumbers ?? [])]);
  const srcs = a.course.sources.filter((x) => nums.has(x.n));
  if (srcs.length) parts.push("# Sources\n" + srcs.map((x) => `[${x.n}] ${x.title}${x.note ? ` - ${x.note}` : ""}`).join("\n"));
  return parts.join("\n\n").slice(0, 30_000);
}

export function submitAnswer(ctx: Ctx, attemptId: string, questionId: string, input: AnswerInput): AnswerResult {
  const { db } = ctx;
  const a = loadAttempt(ctx, attemptId);
  if (a.row.finishedAt !== null) throw new HttpError(409, "attempt already finished");
  const snap = a.questions.find((s) => s.id === questionId);
  if (!snap) throw new HttpError(404, "question is not part of this attempt");
  const q = snap.q;
  if (input.type !== q.type) throw new HttpError(400, `expected a ${q.type} answer`);
  const existing = a.answers.get(questionId);
  const retry = !!existing && existing.grader === "ai" && existing.marks === null && existing.jobStatus === "failed";
  if (existing && !retry) throw new HttpError(409, "question already answered");

  const values: typeof attemptAnswers.$inferInsert = {
    attemptId, questionId, answer: input, grader: "local", answeredAt: ctx.now(), correct: null, marks: null,
  };
  if (q.type === "mcq" && input.type === "mcq") {
    const sel = new Set(input.selected);
    if (sel.size !== input.selected.length || input.selected.some((i) => i >= q.options.length)) {
      throw new HttpError(400, "invalid option selection");
    }
    const correct = q.options.every((o, i) => o.correct === sel.has(i));
    values.correct = correct;
    values.marks = correct ? 1 : 0;
  } else if (q.type === "short" && input.type === "short") {
    const correct = shortAnswerMatches(input.text, q.answers);
    values.correct = correct;
    values.marks = correct ? 1 : 0;
  } else if (q.type === "fill" && input.type === "fill") {
    const key = fillKey(q);
    if (input.slots.length !== key.length || new Set(input.slots).size !== key.length || input.slots.some((c) => c >= q.chips.length)) {
      throw new HttpError(400, "invalid slot placement");
    }
    const right = key.filter((c, i) => input.slots[i] === c).length;
    values.correct = right === key.length;
    values.marks = right / key.length;
  } else if (q.type === "sort" && input.type === "sort") {
    if (input.buckets.length !== q.items.length || input.buckets.some((b) => b >= q.buckets.length)) throw new HttpError(400, "invalid bucket placement");
    const right = q.items.filter((it, i) => q.buckets[input.buckets[i]!] === it.bucket).length;
    values.correct = right === q.items.length;
    values.marks = right / q.items.length;
  } else if (q.type === "spot" && input.type === "spot") {
    const lineCount = q.code.replace(/\n+$/, "").split("\n").length;
    const picked = new Set(input.lines);
    if (picked.size !== input.lines.length || input.lines.some((n) => n > lineCount)) throw new HttpError(400, "invalid line selection");
    const both = q.correct.filter((n) => picked.has(n)).length;
    const either = new Set([...q.correct, ...input.lines]).size;
    values.correct = both === q.correct.length && picked.size === q.correct.length;
    values.marks = both / either; // right lines over everything picked or needed, so extra picks cost marks
  } else if (q.type === "match" && input.type === "match") {
    const total = q.pairs.length + q.distractors.length;
    if (input.pairs.length !== q.pairs.length || new Set(input.pairs).size !== q.pairs.length || input.pairs.some((r) => r >= total)) {
      throw new HttpError(400, "invalid pairing");
    }
    const right = q.pairs.filter((_, i) => input.pairs[i] === i).length;
    values.correct = right === q.pairs.length;
    values.marks = right / q.pairs.length;
  } else if (q.type === "trace" && input.type === "trace") {
    if (input.cells.length !== q.steps.length || input.cells.some((row) => row.length !== q.variables.length)) throw new HttpError(400, "invalid grid");
    let graded = 0;
    let right = 0;
    q.steps.forEach((st, r) =>
      q.variables.forEach((v, c) => {
        if (st.given.includes(v)) return;
        graded++;
        if (traceMatches(input.cells[r]![c]!, st.values[v]!)) right++;
      }),
    );
    values.correct = right === graded;
    values.marks = right / graded;
  } else if (q.type === "hotspot" && input.type === "hotspot") {
    const wanted = q.regions.filter((r) => r.correct);
    if (input.points.length > wanted.length) throw new HttpError(400, `place at most ${wanted.length} marker${wanted.length === 1 ? "" : "s"}`);
    const hit = new Set(input.points.map((p) => regionAt(q.regions, p)).filter((r) => r?.correct).map((r) => r!.name));
    values.correct = hit.size === wanted.length;
    values.marks = hit.size / wanted.length;
  }

  db.transaction((tx) => {
    if (existing) tx.delete(attemptAnswers).where(eq(attemptAnswers.id, existing.id)).run();
    if (q.type === "open" && input.type === "open") {
      const jobId = enqueueJob(
        tx as unknown as Ctx["db"],
        "grade",
        { question: { id: snap.id, text: q.text, rubric: q.rubric, ...(q.code ? { code: q.code } : {}) }, answer: input.text, context: gradeContext(a, snap) },
        ctx.now(),
        { attemptId, questionId },
      );
      values.grader = "ai";
      values.jobId = jobId;
    }
    tx.insert(attemptAnswers).values(values).run();
  });
  if (values.correct) awardXp(ctx, 2, "answer_correct", `${attemptId}:${questionId}`);

  const fresh = loadAttempt(ctx, attemptId);
  return answerView(fresh, snap, fresh.answers.get(questionId))!;
}

/** Stores the final score and awards pass XP once nothing is pending. Idempotent. */
export function settleAttempt(ctx: Ctx, attemptId: string): void {
  const a = loadAttempt(ctx, attemptId);
  if (a.row.finishedAt === null) return;
  const s = summarize(a);
  if (a.kind === "quiz" && s.percent !== null && s.percent >= a.passing) {
    // Clearing a lesson's quiz completes the lesson (also while AI grading is pending); no second click.
    const lesson = getCourse(ctx, a.row.packageId).quizzes.get(a.row.targetId);
    if (lesson) completeLesson(ctx, a.row.packageId, lesson.lessonId);
  }
  if (s.provisional) return;
  ctx.db.update(attempts).set({ score: s.percent }).where(eq(attempts.id, attemptId)).run();
  if (s.passed) awardXp(ctx, a.kind === "exam" ? 100 : 30, `${a.kind}_pass`, `${a.row.packageId}:${a.row.targetId}`);
}

export function finishAttempt(ctx: Ctx, attemptId: string): AttemptResult {
  const row = ctx.db.select().from(attempts).where(eq(attempts.id, attemptId)).get();
  if (!row) throw new HttpError(404, "attempt not found");
  if (row.finishedAt === null) {
    ctx.db.update(attempts).set({ finishedAt: ctx.now() }).where(eq(attempts.id, attemptId)).run();
  }
  settleAttempt(ctx, attemptId);
  return buildAttemptResult(ctx, attemptId);
}

/** Applies a validated grade-job result to the answer row that queued it. */
export function applyGradeResult(ctx: Ctx, jobId: string, result: { score: number; correct: boolean; feedback: string }): void {
  const row = ctx.db.select().from(attemptAnswers).where(eq(attemptAnswers.jobId, jobId)).get();
  if (!row) return;
  const points = JSON.stringify([{ ok: result.correct, text: result.feedback }]);
  ctx.db.update(attemptAnswers).set({ marks: result.score, correct: result.correct, feedback: points }).where(eq(attemptAnswers.id, row.id)).run();
  if (result.correct) awardXp(ctx, 5, "answer_correct", `${row.attemptId}:${row.questionId}`);
  settleAttempt(ctx, row.attemptId);
}
