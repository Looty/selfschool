import { and, count, eq, inArray, like, or, sql } from "drizzle-orm";
import type { CourseRemoval, RemovedCourse } from "@selfschool/shared";
import type { Ctx } from "./ctx.js";
import { getCourse } from "./ctx.js";
import type { Db } from "./db/client.js";
import {
  attemptAnswers, attempts, chatMessages, completions, examInstances, extensions, jobs, lessonRevisions, packages, questions, settings, xpEvents,
} from "./db/schema.js";
import { HttpError } from "./util.js";

const KEY = "removedCourses";
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Ids of courses the user removed from the app. Their folders are untouched; the app just does not serve them. */
export function removedIds(db: Db): Set<string> {
  const row = db.select().from(settings).where(eq(settings.key, KEY)).get();
  return new Set(Array.isArray(row?.value) ? (row.value as unknown[]).filter((x): x is string => typeof x === "string") : []);
}

function saveRemoved(db: Db, ids: Set<string>) {
  const value = [...ids].sort();
  db.insert(settings).values({ key: KEY, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run();
}

/** Makes a removed course visible again (restore, or importing it again). A no-op when it was not removed. */
export function unremoveCourse(ctx: Ctx, courseId: string): void {
  const ids = removedIds(ctx.db);
  if (ids.delete(courseId)) {
    saveRemoved(ctx.db, ids);
    ctx.catalog.invalidate();
  }
}

/** XP events tied to a course: `<course>:<target>` refs, and `<attempt>:<question>` refs of its attempts. */
function xpFilter(ctx: Ctx, courseId: string) {
  const attemptIds = ctx.db.select({ id: attempts.id }).from(attempts).where(eq(attempts.packageId, courseId)).all().map((a) => a.id);
  return or(like(xpEvents.ref, `${escapeLike(courseId)}:%`), ...attemptIds.map((id) => like(xpEvents.ref, `${escapeLike(id)}:%`)))!;
}

export function removalSummary(ctx: Ctx, courseId: string): CourseRemoval {
  const course = getCourse(ctx, courseId);
  const pkg = ctx.db.select().from(packages).where(eq(packages.id, courseId)).get();
  const n = (table: any, col: any) => ctx.db.select({ n: count() }).from(table).where(eq(col, courseId)).get()?.n ?? 0;
  const xp = ctx.db.select({ total: sql<number>`coalesce(sum(${xpEvents.amount}), 0)` }).from(xpEvents).where(xpFilter(ctx, courseId)).get()?.total ?? 0;
  return {
    id: courseId,
    title: course.manifest.title,
    source: pkg?.url ?? `local:${course.dirName}`,
    lessonsCompleted: n(completions, completions.packageId),
    attempts: n(attempts, attempts.packageId),
    bankQuestions: n(questions, questions.packageId),
    chatMessages: n(chatMessages, chatMessages.packageId),
    extensionProposals: n(extensions, extensions.packageId),
    xp,
  };
}

/**
 * Removes a course from the app: its attempts, completions, XP, question bank, chat and extension proposals are
 * deleted and the course is hidden. No file is touched, so a course written by hand in `courses/` is safe; it
 * comes back by importing it again or with `restoreCourse`, from zero.
 */
export function removeCourse(ctx: Ctx, courseId: string): { removed: true } {
  getCourse(ctx, courseId); // 404 when it is not installed
  const { db } = ctx;
  db.transaction((tx) => {
    const t = tx as unknown as Db;
    const attemptIds = t.select({ id: attempts.id }).from(attempts).where(eq(attempts.packageId, courseId)).all().map((a) => a.id);
    t.delete(xpEvents).where(xpFilter(ctx, courseId)).run();
    if (attemptIds.length) t.delete(attemptAnswers).where(inArray(attemptAnswers.attemptId, attemptIds)).run();
    t.delete(attempts).where(eq(attempts.packageId, courseId)).run();
    t.delete(examInstances).where(eq(examInstances.packageId, courseId)).run();
    t.delete(completions).where(eq(completions.packageId, courseId)).run();
    t.delete(lessonRevisions).where(eq(lessonRevisions.packageId, courseId)).run();
    t.delete(questions).where(eq(questions.packageId, courseId)).run();
    t.delete(chatMessages).where(eq(chatMessages.packageId, courseId)).run();
    t.delete(extensions).where(eq(extensions.packageId, courseId)).run();
    // queued work for this course must not run against a course that is hidden
    t.delete(jobs)
      .where(and(inArray(jobs.status, ["pending", "running"]), or(like(jobs.payload, `%${escapeLike(courseId)}%`), like(jobs.ctx, `%${escapeLike(courseId)}%`))!))
      .run();
    t.delete(packages).where(eq(packages.id, courseId)).run();
    saveRemoved(t, removedIds(t).add(courseId));
  });
  ctx.catalog.invalidate();
  return { removed: true };
}

/** Courses removed from the app whose files are still in the courses folder, for the "Removed" list. */
export function listRemoved(ctx: Ctx): RemovedCourse[] {
  return ctx.catalog.loadHidden().map((c) => ({ id: c.id, title: c.manifest.title, folder: c.dirName }));
}

/** Shows a removed course again, from zero (its progress was deleted when it was removed). */
export function restoreCourse(ctx: Ctx, courseId: string): { restored: true } {
  if (!removedIds(ctx.db).has(courseId)) throw new HttpError(404, "that course was not removed");
  unremoveCourse(ctx, courseId);
  return { restored: true };
}
