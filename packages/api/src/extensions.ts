import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { and, desc, eq } from "drizzle-orm";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  DEFAULT_DEPTH_MINUTES,
  EXTENSION_SOURCE_BASE,
  buildBrief,
  lessonFrontmatterSchema,
  outlineResultSchema,
  planChapters,
  quizSchema,
  type BriefInput,
  type ExtensionDecision,
  type ExtensionGeneration,
  type ExtensionSeed,
  type ExtensionView,
  type LessonResult,
  type OutlineResult,
} from "@selfschool/shared";
import type { LoadedCourse } from "./catalog.js";
import { courseOutlineFor } from "./courses.js";
import { weakSpotsOf } from "./dashboard.js";
import { getCourse, type Ctx } from "./ctx.js";
import { extensions, jobs } from "./db/schema.js";
import { enqueueJob, ResultRejected } from "./jobs.js";
import { HttpError, newId } from "./util.js";

type Row = typeof extensions.$inferSelect;

/** The ids and files assigned when "Generate here" starts. Fixed from then on: the loader only lists a chapter once a lesson file exists, so recomputing mid-run would shift ids. */
interface PlanLesson {
  id: string;
  quizId: string;
  file: string;
  quizFile: string;
  title: string;
  objective: string;
  why: string;
  done: boolean;
}
interface Plan {
  level: number;
  chapters: { dir: string; title: string; why: string; lessons: PlanLesson[] }[];
}

const planOf = (r: Row): Plan | null => (r.plan ? (r.plan as Plan) : null);
const flatLessons = (plan: Plan) => plan.chapters.flatMap((c, ci) => c.lessons.map((l, li) => ({ c, l, ci, li })));

function generationOf(ctx: Ctx, r: Row): ExtensionGeneration | null {
  const plan = planOf(r);
  if (!plan) return null;
  const all = flatLessons(plan);
  const next = all.find((x) => !x.l.done);
  if (!next) return { total: all.length, done: all.length, state: "done", current: null, error: null };
  const job = r.generationJobId ? ctx.db.select({ status: jobs.status, error: jobs.error }).from(jobs).where(eq(jobs.id, r.generationJobId)).get() : undefined;
  const failed = !job || job.status === "failed";
  return {
    total: all.length,
    done: all.filter((x) => x.l.done).length,
    state: failed ? "failed" : "running",
    current: next.l.title,
    error: failed ? (job?.error ?? "the lesson job is gone") : null,
  };
}

const MAX_SEED = 4000;
const clip = (s: string | undefined) => (s === undefined ? undefined : s.slice(0, MAX_SEED));

/** A drafting proposal follows its job: a failed job fails the proposal. The outline arrives via `applyOutlineResult`. */
function view(ctx: Ctx, r: Row): ExtensionView {
  let status: ExtensionView["status"] = r.status;
  let error = r.error;
  if (r.status === "drafting" && r.jobId) {
    const job = ctx.db.select({ status: jobs.status, error: jobs.error }).from(jobs).where(eq(jobs.id, r.jobId)).get();
    if (!job || job.status === "failed") {
      status = "failed";
      error = job?.error ?? "the drafting job is gone";
    }
  }
  const outline = outlineResultSchema.nullable().catch(null).parse(r.outline ?? null);
  return {
    id: r.id,
    courseId: r.packageId,
    status,
    seed: r.seed as ExtensionSeed,
    budgetMinutes: r.budgetMinutes,
    jobId: r.jobId,
    error,
    outline,
    generation: generationOf(ctx, r),
    createdAt: r.createdAt,
    decidedAt: r.decidedAt,
  };
}

export function proposeExtension(
  ctx: Ctx,
  courseId: string,
  body: {
    topic?: string | undefined;
    fromLessonId?: string | undefined;
    question?: string | undefined;
    answer?: string | undefined;
    budgetMinutes?: number | undefined;
  },
): { extensionId: string; jobId: string } {
  const course = getCourse(ctx, courseId);
  const from = body.fromLessonId ? course.lessonById.get(body.fromLessonId) : undefined;
  if (body.fromLessonId && !from) throw new HttpError(404, "lesson not found");

  const seed: ExtensionSeed = {
    ...(body.topic?.trim() ? { topic: clip(body.topic.trim())! } : {}),
    ...(body.question?.trim() ? { question: clip(body.question.trim())! } : {}),
    ...(body.answer?.trim() ? { answer: clip(body.answer.trim())! } : {}),
    ...(from ? { fromLesson: { id: from.id, title: from.title } } : {}),
  };

  const id = newId();
  const now = ctx.now();
  const budgetMinutes = body.budgetMinutes ?? DEFAULT_DEPTH_MINUTES;
  const jobId = ctx.db.transaction((tx) => {
    const jobId = enqueueOutline(ctx, tx as unknown as Ctx["db"], course, id, seed, budgetMinutes);
    tx.insert(extensions).values({ id, packageId: course.id, status: "drafting", seed, budgetMinutes, jobId, createdAt: now }).run();
    return jobId;
  });
  return { extensionId: id, jobId };
}

function enqueueOutline(ctx: Ctx, db: Ctx["db"], course: LoadedCourse, extensionId: string, seed: ExtensionSeed, budgetMinutes: number): string {
  const weak = weakSpotsOf(ctx, [course]).slice(0, 8);
  return enqueueJob(
    db,
    "outline",
    {
      course: { title: course.manifest.title, description: course.manifest.description },
      outline: courseOutlineFor(ctx, course),
      weakSpots: weak.map((w) => ({ concept: w.concept, percent: w.percent, lesson: w.lesson.title })),
      seed: { topic: seed.topic, question: seed.question, answer: seed.answer },
      sourcesMd: course.sourcesMd,
      budgetMinutes,
    },
    ctx.now(),
    { extensionId },
  );
}

/** Drafts again at another depth. Only before a decision; the previous outline (and any edits to it) is replaced. */
export function redraftExtension(ctx: Ctx, extensionId: string, budgetMinutes: number): { jobId: string } {
  const row = rowOf(ctx, extensionId);
  const current = view(ctx, row);
  if (current.status !== "ready" && current.status !== "failed") throw new HttpError(409, `extension is ${current.status}, cannot be drafted again`);
  const course = getCourse(ctx, row.packageId);
  return ctx.db.transaction((tx) => {
    const jobId = enqueueOutline(ctx, tx as unknown as Ctx["db"], course, extensionId, row.seed as ExtensionSeed, budgetMinutes);
    tx.update(extensions).set({ status: "drafting", outline: null, error: null, budgetMinutes, jobId }).where(eq(extensions.id, extensionId)).run();
    return { jobId };
  });
}

export function listExtensions(ctx: Ctx, courseId: string): ExtensionView[] {
  getCourse(ctx, courseId);
  return ctx.db.select().from(extensions).where(eq(extensions.packageId, courseId)).orderBy(desc(extensions.createdAt)).all().map((r) => view(ctx, r));
}

export function getExtension(ctx: Ctx, extensionId: string): ExtensionView {
  return view(ctx, rowOf(ctx, extensionId));
}

const rowOf = (ctx: Ctx, extensionId: string): Row => {
  const row = ctx.db.select().from(extensions).where(eq(extensions.id, extensionId)).get();
  if (!row) throw new HttpError(404, "extension not found");
  return row;
};

/** Stores the drafted outline and marks the proposal ready for review. */
export function applyOutlineResult(ctx: Ctx, job: typeof jobs.$inferSelect, result: OutlineResult): void {
  const extensionId = (job.ctx as { extensionId?: string } | null)?.extensionId;
  if (!extensionId) return;
  // only the latest draft counts: a result from a job that was replaced by a re-draft is dropped
  ctx.db.update(extensions).set({ outline: result, status: "ready" }).where(and(eq(extensions.id, extensionId), eq(extensions.jobId, job.id))).run();
}

/** What both writers need to know about the course as it is now, with the approved outline. */
function briefInputOf(ctx: Ctx, ext: ExtensionView): BriefInput {
  const course = getCourse(ctx, ext.courseId);
  return {
    course: { id: course.id, title: course.manifest.title, description: course.manifest.description },
    chapters: course.manifest.chapters.map((c) => ({
      dir: c.dir,
      title: c.title,
      level: c.level,
      lessons: course.lessons.filter((l) => l.chapterDir === c.dir).map((l) => ({ id: l.id, title: l.title })),
    })),
    quizIds: [...course.quizzes.keys()],
    lastSourceNumber: course.sources.reduce((m, s) => Math.max(m, s.n), EXTENSION_SOURCE_BASE - 1),
    weakSpots: weakSpotsOf(ctx, [course]).slice(0, 8).map((w) => ({ concept: w.concept, percent: w.percent, lesson: w.lesson.title })),
    outline: ext.outline!,
    budgetMinutes: ext.budgetMinutes,
    seed: { topic: ext.seed.topic, question: ext.seed.question },
  };
}

const approvedView = (ctx: Ctx, extensionId: string): ExtensionView => {
  const ext = view(ctx, rowOf(ctx, extensionId));
  if (ext.status !== "approved" || !ext.outline) throw new HttpError(409, `extension is ${ext.status}, approve the outline first`);
  return ext;
};

/** The brief for the deep path: the approved outline plus everything an outside LLM needs to write valid files. */
export function extensionBrief(ctx: Ctx, extensionId: string): { markdown: string } {
  const ext = approvedView(ctx, extensionId);
  // once the runner is writing, the same x-ids are taken; a second writer would be skipped as duplicates
  if (ext.generation) throw new HttpError(409, "lessons are already being generated for this proposal");
  return { markdown: buildBrief(briefInputOf(ctx, ext)) };
}

// ---------- quick path: the runner writes one lesson at a time ----------

/** Starts "Generate here": fixes the ids and files, then queues only the first lesson (later ones follow as each result lands). */
export function generateExtension(ctx: Ctx, extensionId: string): { jobId: string } {
  const ext = approvedView(ctx, extensionId);
  if (ext.generation) throw new HttpError(409, "generation has already started for this proposal");
  if (!ctx.catalog.extensionsDir) throw new HttpError(409, "no extensions folder is configured");
  const running = listExtensions(ctx, ext.courseId).find((e) => e.generation?.state === "running");
  if (running) throw new HttpError(409, "another proposal for this course is still generating");

  const planned = planChapters(briefInputOf(ctx, ext));
  const plan: Plan = {
    level: planned.level,
    chapters: planned.chapters.map((c) => ({ dir: c.dir, title: c.title, why: c.why, lessons: c.lessons.map((l) => ({ ...l, done: false })) })),
  };
  return ctx.db.transaction((tx) => {
    const jobId = enqueueLesson(ctx, tx as unknown as Ctx["db"], getCourse(ctx, ext.courseId), extensionId, plan);
    tx.update(extensions).set({ plan, generationJobId: jobId }).where(eq(extensions.id, extensionId)).run();
    return { jobId };
  });
}

/** Continues after a failed lesson. Lessons already written stay; the first one not written is queued again. */
export function resumeExtension(ctx: Ctx, extensionId: string): { jobId: string } {
  const row = rowOf(ctx, extensionId);
  const plan = planOf(row);
  if (!plan || generationOf(ctx, row)?.state !== "failed") throw new HttpError(409, "nothing to resume");
  return ctx.db.transaction((tx) => {
    const jobId = enqueueLesson(ctx, tx as unknown as Ctx["db"], getCourse(ctx, row.packageId), extensionId, plan);
    tx.update(extensions).set({ generationJobId: jobId }).where(eq(extensions.id, extensionId)).run();
    return { jobId };
  });
}

/** Queues the first lesson not yet written. Only ever one lesson job exists per proposal, so chat and grading are never stuck behind a long queue. */
function enqueueLesson(ctx: Ctx, db: Ctx["db"], course: LoadedCourse, extensionId: string, plan: Plan): string {
  const all = flatLessons(plan);
  const at = all.findIndex((x) => !x.l.done);
  if (at === -1) throw new HttpError(409, "every lesson is already written");
  const { c, l, ci, li } = all[at]!;
  return enqueueJob(
    db,
    "lesson",
    {
      course: { title: course.manifest.title, description: course.manifest.description },
      chapter: { title: c.title, why: c.why },
      lesson: { title: l.title, objective: l.objective, why: l.why },
      previous: all.filter((x) => x.l.done).map((x) => x.l.title),
      upcoming: all.slice(at + 1).map((x) => x.l.title),
      existing: courseOutlineFor(ctx, course).flatMap((ch) => ch.lessons),
      sourcesMd: course.sourcesMd,
    },
    ctx.now(),
    { extensionId, chapter: ci, lesson: li },
  );
}

/** Replaces a leading `---` block and a leading `# Title` line: the API owns the frontmatter and the title. */
export function cleanBody(body: string, title: string): string {
  let text = body.replace(/\r\n/g, "\n").trim();
  const fm = /^---\n[\s\S]*?\n---\n?/.exec(text);
  if (fm) text = text.slice(fm[0].length).trim();
  const h1 = /^#\s+(.+)\n/.exec(text);
  if (h1 && h1[1]!.trim().toLowerCase() === title.trim().toLowerCase()) text = text.slice(h1[0].length).trim();
  return text;
}

function writeAtomic(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${newId()}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

/** Writes the quiz, then the lesson, then the chapter entry (so the loader never sees a chapter before its first lesson). Every id and path comes from the plan, never from the model. */
function writeLesson(ctx: Ctx, courseId: string, plan: Plan, ci: number, li: number, result: LessonResult): void {
  const overlay = ctx.catalog.overlayDirFor(courseId);
  if (!overlay) throw new ResultRejected("no extensions folder is configured");
  const chapter = plan.chapters[ci]!;
  const l = chapter.lessons[li]!;
  const dir = join(overlay, chapter.dir);

  const quiz = quizSchema.parse({
    id: l.quizId,
    title: `Check: ${l.title}`,
    questions: result.questions.map((q, k) => ({ ...q, id: `${l.quizId}-${k + 1}`, sources: [] })),
  });
  const front = lessonFrontmatterSchema.parse({ id: l.id, title: l.title, quiz: l.quizFile, sources: "none" });

  writeAtomic(join(dir, l.quizFile), stringifyYaml(quiz));
  writeAtomic(join(dir, l.file), `---\n${stringifyYaml(front)}---\n${cleanBody(result.body, l.title)}\n`);

  const manifestFile = join(overlay, "extension.yaml");
  const manifest = (existsSync(manifestFile) ? parseYaml(readFileSync(manifestFile, "utf8")) : { schemaVersion: 1, chapters: [] }) as {
    schemaVersion: number;
    chapters: { dir: string; [key: string]: unknown }[];
  };
  if (!manifest || !Array.isArray(manifest.chapters)) throw new ResultRejected("extension.yaml is not in the expected shape");
  if (!manifest.chapters.some((c) => c.dir === chapter.dir)) {
    manifest.chapters.push({ dir: chapter.dir, title: chapter.title, level: plan.level, origin: "quick" });
    writeAtomic(manifestFile, stringifyYaml(manifest));
  }
  ctx.catalog.invalidate();
}

/** Writes the lesson, marks it done and queues the next one. A result from a job that was replaced by a resume is dropped. */
export function applyLessonResult(ctx: Ctx, job: typeof jobs.$inferSelect, result: LessonResult): void {
  const at = job.ctx as { extensionId?: string; chapter?: number; lesson?: number } | null;
  if (!at?.extensionId || at.chapter === undefined || at.lesson === undefined) return;
  const row = rowOf(ctx, at.extensionId);
  const plan = planOf(row);
  if (!plan || row.generationJobId !== job.id) return;
  const lesson = plan.chapters[at.chapter]?.lessons[at.lesson];
  if (!lesson || lesson.done) return;

  try {
    writeLesson(ctx, row.packageId, plan, at.chapter, at.lesson, result);
  } catch (e) {
    throw e instanceof ResultRejected ? e : new ResultRejected(`could not write the lesson: ${e instanceof Error ? e.message : String(e)}`);
  }
  lesson.done = true;
  const more = flatLessons(plan).some((x) => !x.l.done);
  const nextJob = more ? enqueueLesson(ctx, ctx.db, getCourse(ctx, row.packageId), at.extensionId, plan) : job.id;
  ctx.db.update(extensions).set({ plan, generationJobId: nextJob }).where(eq(extensions.id, at.extensionId)).run();
}

/** Approve keeps the learner's edited outline; nothing is generated here. Only a ready proposal can be decided. */
export function decideExtension(ctx: Ctx, extensionId: string, decision: ExtensionDecision): ExtensionView {
  const current = view(ctx, rowOf(ctx, extensionId));
  if (current.status !== "ready") throw new HttpError(409, `extension is ${current.status}, not ready for a decision`);
  const now = ctx.now();
  if (decision.decision === "approve") {
    ctx.db.update(extensions).set({ status: "approved", outline: decision.outline, decidedAt: now }).where(eq(extensions.id, extensionId)).run();
  } else {
    ctx.db.update(extensions).set({ status: "rejected", decidedAt: now }).where(eq(extensions.id, extensionId)).run();
  }
  return view(ctx, rowOf(ctx, extensionId));
}
