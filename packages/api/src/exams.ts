import { and, desc, eq } from "drizzle-orm";
import type { ExamInfo, ExamInstance, ExamRow, Question } from "@selfschool/shared";
import {
  createAttempt,
  learnerQuestion,
  listAttempts,
  snapFromRow,
  summarize,
  type SnapQ,
} from "./attempts.js";
import type { LoadedCourse, LoadedExam } from "./catalog.js";
import { getCourse, questionHash, type Ctx } from "./ctx.js";
import { attempts, examInstances, jobs, questions } from "./db/schema.js";
import { enqueueJob, ResultRejected } from "./jobs.js";
import { HttpError, newId, shuffled } from "./util.js";

type QRow = typeof questions.$inferSelect;

export function findExam(course: LoadedCourse, examId: string): LoadedExam {
  const e = course.exams.find((x) => x.id === examId);
  if (!e) throw new HttpError(404, "exam not found");
  return e;
}

export function examRow(ctx: Ctx, course: LoadedCourse, exam: LoadedExam): ExamRow {
  const atts = listAttempts(ctx, course.id, "exam", exam.id);
  const sums = atts.map(summarize);
  const last = sums.at(-1);
  return {
    id: exam.id,
    title: exam.blueprint.title,
    questionCount: exam.blueprint.limit_questions,
    durationMinutes: exam.blueprint.duration_minutes,
    passingPercentage: exam.blueprint.passing_percentage,
    maxAttempts: exam.blueprint.max_attempts,
    attemptCount: atts.length,
    pendingCount: sums.reduce((n, s) => n + s.pendingCount, 0),
    status: !last ? "not_started" : last.status === "in_progress" ? "in_progress" : last.status,
  };
}

export function examInfo(ctx: Ctx, courseId: string, examId: string): ExamInfo {
  const course = getCourse(ctx, courseId);
  const exam = findExam(course, examId);
  const atts = listAttempts(ctx, course.id, "exam", exam.id);
  return {
    course: course.ref,
    exam: examRow(ctx, course, exam),
    domains: exam.blueprint.domains.map((d) => ({ id: d.id, title: d.title, weight: d.weight })),
    attempts: atts.map((a) => {
      const s = summarize(a);
      return { id: a.row.id, number: a.row.number, date: a.row.finishedAt ?? a.row.startedAt, percent: s.percent, status: s.status };
    }),
    latestAttemptId: atts.at(-1)?.row.id ?? null,
  };
}

// ---------- drawing ----------

/** Which blueprint domain a bank question belongs to, if any. */
function domainOf(exam: LoadedExam, r: QRow): string | null {
  const domains = exam.blueprint.domains;
  if (r.domain && domains.some((d) => d.id === r.domain)) return r.domain;
  if (r.chapter) {
    const d = domains.find((x) => x.chapters.includes(r.chapter!));
    if (d) return d.id;
  }
  const d = domains.find((x) => x.concepts.some((c) => r.concepts.includes(c)));
  return d?.id ?? null;
}

/** Largest-remainder split of `total` across domains by weight. */
export function allocate(exam: LoadedExam, total: number): Map<string, number> {
  const domains = exam.blueprint.domains;
  const sum = domains.reduce((n, d) => n + d.weight, 0);
  const raw = domains.map((d) => ({ id: d.id, exact: (total * d.weight) / sum }));
  const out = new Map(raw.map((r) => [r.id, Math.floor(r.exact)]));
  let left = total - [...out.values()].reduce((a, b) => a + b, 0);
  for (const r of [...raw].sort((a, b) => b.exact - Math.floor(b.exact) - (a.exact - Math.floor(a.exact)))) {
    if (left-- <= 0) break;
    out.set(r.id, out.get(r.id)! + 1);
  }
  return out;
}

function seenQuestionIds(ctx: Ctx, course: LoadedCourse, examId: string): Set<string> {
  const seen = new Set<string>();
  const rows = ctx.db
    .select({ questions: examInstances.questions })
    .from(examInstances)
    .where(and(eq(examInstances.packageId, course.id), eq(examInstances.examId, examId)))
    .all();
  for (const r of rows) for (const s of r.questions as SnapQ[]) seen.add(s.id);
  return seen;
}

interface Draw {
  picked: SnapQ[];
  fromBank: number;
  shortfall: number;
}

function draw(ctx: Ctx, course: LoadedCourse, exam: LoadedExam): Draw {
  const limit = exam.blueprint.limit_questions;
  const pool = ctx.db
    .select()
    .from(questions)
    .where(and(eq(questions.packageId, course.id), eq(questions.status, "active")))
    .all()
    .flatMap((r) => {
      const domain = domainOf(exam, r);
      return domain ? [{ ...snapFromRow(r), domain }] : [];
    });
  const seen = seenQuestionIds(ctx, course, exam.id);
  const unseen = shuffled(pool.filter((s) => !seen.has(s.id)));
  const targets = allocate(exam, limit);

  const picked: SnapQ[] = [];
  const taken = new Set<string>();
  const take = (s: SnapQ) => {
    picked.push(s);
    taken.add(s.id);
  };
  for (const [domain, n] of targets) {
    unseen.filter((s) => s.domain === domain).slice(0, n).forEach(take);
  }
  for (const s of unseen) if (picked.length < limit && !taken.has(s.id)) take(s);
  const fromBank = picked.length;
  // Top up with already-seen questions so the instance is takeable now.
  for (const s of shuffled(pool.filter((x) => !taken.has(x.id)))) if (picked.length < limit) take(s);
  return { picked: exam.blueprint.shuffle ? shuffled(picked) : picked, fromBank, shortfall: limit - fromBank };
}

function createInstance(ctx: Ctx, course: LoadedCourse, exam: LoadedExam, snaps: SnapQ[]): string {
  const id = newId();
  ctx.db.insert(examInstances).values({ id, packageId: course.id, examId: exam.id, createdAt: ctx.now(), questions: snaps }).run();
  return id;
}

function checkAttemptsLeft(ctx: Ctx, course: LoadedCourse, exam: LoadedExam): void {
  const max = exam.blueprint.max_attempts;
  if (max > 0 && listAttempts(ctx, course.id, "exam", exam.id).length >= max) {
    throw new HttpError(409, "no attempts left for this exam");
  }
}

export function instanceView(ctx: Ctx, instanceId: string): ExamInstance {
  const inst = ctx.db.select().from(examInstances).where(eq(examInstances.id, instanceId)).get();
  if (!inst) throw new HttpError(404, "exam instance not found");
  const course = getCourse(ctx, inst.packageId);
  const exam = findExam(course, inst.examId);
  const att = ctx.db.select().from(attempts).where(eq(attempts.examInstanceId, instanceId)).orderBy(desc(attempts.number)).limit(1).get();
  if (!att) throw new HttpError(404, "exam instance has no attempt");
  return {
    id: inst.id,
    examId: exam.id,
    course: course.ref,
    title: exam.blueprint.title,
    attemptId: att.id,
    durationMinutes: exam.blueprint.duration_minutes,
    startedAt: att.startedAt,
    questions: (inst.questions as SnapQ[]).map(learnerQuestion),
  };
}

/** Resumes an unfinished attempt, otherwise retakes the latest frozen instance (or draws the first one). */
export function startExam(ctx: Ctx, courseId: string, examId: string): ExamInstance {
  const course = getCourse(ctx, courseId);
  const exam = findExam(course, examId);
  const atts = listAttempts(ctx, course.id, "exam", exam.id);
  const open = atts.find((a) => a.row.finishedAt === null);
  if (open?.row.examInstanceId) return instanceView(ctx, open.row.examInstanceId);
  checkAttemptsLeft(ctx, course, exam);

  const latest = atts.at(-1)?.row.examInstanceId;
  const instanceId = latest ?? (() => {
    const { picked } = draw(ctx, course, exam);
    if (picked.length === 0) throw new HttpError(422, "no questions available for this exam yet");
    return createInstance(ctx, course, exam, picked);
  })();
  createAttempt(ctx, { packageId: course.id, kind: "exam", targetId: exam.id, examInstanceId: instanceId });
  return instanceView(ctx, instanceId);
}

export function regenerateExam(ctx: Ctx, courseId: string, examId: string) {
  const course = getCourse(ctx, courseId);
  const exam = findExam(course, examId);
  if (listAttempts(ctx, course.id, "exam", exam.id).some((a) => a.row.finishedAt === null)) {
    throw new HttpError(409, "finish the exam in progress first");
  }
  checkAttemptsLeft(ctx, course, exam);
  const { picked, fromBank, shortfall } = draw(ctx, course, exam);
  if (picked.length === 0) throw new HttpError(422, "no questions available for this exam yet");

  let jobId: string | null = null;
  if (shortfall > 0) {
    const existing = ctx.db
      .select({ hash: questions.contentHash, concepts: questions.concepts })
      .from(questions)
      .where(eq(questions.packageId, course.id))
      .all()
      .map((r) => ({ hash: r.hash, concepts: r.concepts }));
    for (const [domain, count] of allocate(exam, shortfall)) {
      if (count <= 0) continue;
      const id = enqueueJob(
        ctx.db, "generate",
        { blueprint: exam.blueprint, domain, count, sourcesMd: course.sourcesMd, existing },
        ctx.now(),
        { packageId: course.id, examId: exam.id, domain },
      );
      jobId ??= id;
    }
  }
  const instanceId = createInstance(ctx, course, exam, picked);
  createAttempt(ctx, { packageId: course.id, kind: "exam", targetId: exam.id, examInstanceId: instanceId });
  return { instance: instanceView(ctx, instanceId), drawn: { fromBank, generating: shortfall }, jobId };
}

// ---------- generate / verify results, reporting ----------

export function applyGenerateResult(ctx: Ctx, job: typeof jobs.$inferSelect, result: { questions: Question[] }): void {
  const c = job.ctx as { packageId?: string; domain?: string } | null;
  if (!c?.packageId) return;
  for (const q of result.questions) {
    const hash = questionHash(q);
    const dup = ctx.db.select({ id: questions.id }).from(questions).where(and(eq(questions.packageId, c.packageId), eq(questions.contentHash, hash))).get();
    if (dup) continue;
    const id = `${c.packageId}:gen-${newId().slice(0, 8)}`;
    ctx.db
      .insert(questions)
      .values({
        id, packageId: c.packageId, contentHash: hash, type: q.type, payload: { ...q, id }, concepts: q.concepts, sources: q.sources,
        origin: "generated", status: "unverified", domain: c.domain ?? null,
      })
      .run();
    const course = ctx.catalog.load().courses.find((x) => x.id === c.packageId);
    enqueueJob(ctx.db, "verify", { question: { ...q, id }, sourcesMd: course?.sourcesMd ?? "" }, ctx.now(), { questionId: id });
  }
}

export function applyVerifyResult(ctx: Ctx, job: typeof jobs.$inferSelect, result: { verdict: "ok" | "wrong" | "unclear"; notes: string }): void {
  const qid = (job.ctx as { questionId?: string } | null)?.questionId;
  if (!qid) return;
  if (result.verdict === "ok") {
    ctx.db.update(questions).set({ status: "active" }).where(eq(questions.id, qid)).run();
  } else {
    ctx.db.update(questions).set({ reportReason: `verify ${result.verdict}: ${result.notes}` }).where(eq(questions.id, qid)).run();
  }
}

export function reportQuestion(ctx: Ctx, questionId: string, reason?: string): void {
  const row = ctx.db.select().from(questions).where(eq(questions.id, questionId)).get();
  if (!row) throw new HttpError(404, "question not found");
  ctx.db.update(questions).set({ status: "retired", reportReason: reason ?? "reported" }).where(eq(questions.id, questionId)).run();
}

export { ResultRejected };
