import { and, desc, eq } from "drizzle-orm";
import { SCHEMA_VERSION, type Question } from "@selfschool/shared";
import { type Catalog, questionKey, type LoadedCourse } from "./catalog.js";
import type { Db } from "./db/client.js";
import { lessonRevisions, packages, questions } from "./db/schema.js";
import { HttpError, sha256 } from "./util.js";

/** Runs git with an argv array (never a shell string). Injectable so tests never touch the network. */
export type GitRunner = (args: string[], opts: { cwd?: string; timeoutMs: number }) => Promise<string>;

export interface Ctx {
  db: Db;
  catalog: Catalog;
  now(): number;
  /** Unix ms of the runner's last poll, or null. */
  runnerLastSeen(): number | null;
  aiAvailable(): boolean;
  git: GitRunner;
}

/** Normalized content hash of a question, used for bank dedupe. */
export function questionHash(q: Question): string {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const core =
    q.type === "mcq"
      ? { t: q.type, x: norm(q.text), c: norm(q.code ?? ""), o: q.options.map((o) => [norm(o.text), o.correct]).sort() }
      : q.type === "short"
        ? { t: q.type, x: norm(q.text), c: norm(q.code ?? ""), a: q.answers.map(norm).sort() }
        : q.type === "fill"
          ? { t: q.type, x: norm(q.text), c: norm(q.code ?? ""), f: norm(q.template), s: q.chips.map((c) => [norm(c.text), c.slot ?? 0]).sort() }
          : q.type === "sort"
            ? { t: q.type, x: norm(q.text), c: norm(q.code ?? ""), b: q.buckets.map(norm), i: q.items.map((i) => [norm(i.text), norm(i.bucket)]).sort() }
            : q.type === "spot"
              ? { t: q.type, x: norm(q.text), c: norm(q.code), l: [...q.correct].sort(), d: q.diff }
              : q.type === "hotspot"
                ? { t: q.type, x: norm(q.text), c: norm(q.code ?? ""), m: q.image, r: q.regions.map((r) => [r.name, r.correct]).sort() }
                : q.type === "match"
                  ? { t: q.type, x: norm(q.text), c: norm(q.code ?? ""), p: q.pairs.map((p) => [norm(p.left), norm(p.right)]).sort(), d: q.distractors.map(norm).sort() }
                  : q.type === "trace"
                    ? { t: q.type, x: norm(q.text), c: norm(q.code), v: q.variables, s: q.steps.map((s) => [s.label, s.values, s.given]) }
                    : { t: q.type, x: norm(q.text), c: norm(q.code ?? "") };
  return sha256(JSON.stringify(core));
}

/** Pins lesson revisions and loads authored quiz questions into the bank. Idempotent. */
export function syncCourse(ctx: Ctx, course: LoadedCourse): void {
  const { db } = ctx;
  const now = ctx.now();
  // Already inside a transaction (e.g. a result hook): join it instead of nesting.
  const run = (fn: (tx: Db) => void) => (db.$client.inTransaction ? fn(db) : db.transaction((tx) => fn(tx as unknown as Db)));
  run((tx) => {
    const row = tx.select().from(packages).where(eq(packages.id, course.id)).get();
    const sha = course.contentHash.slice(0, 12);
    if (!row) {
      tx.insert(packages)
        .values({ id: course.id, url: `local:${course.dirName}`, path: "", ref: "local", fetchedAt: now, schemaVersion: SCHEMA_VERSION, sha })
        .run();
    } else if (row.url.startsWith("local:") && row.sha !== sha) {
      tx.update(packages).set({ sha, fetchedAt: now }).where(eq(packages.id, course.id)).run();
    }

    for (const lesson of course.lessons) {
      const last = tx
        .select()
        .from(lessonRevisions)
        .where(and(eq(lessonRevisions.packageId, course.id), eq(lessonRevisions.lessonId, lesson.id)))
        .orderBy(desc(lessonRevisions.revision))
        .limit(1)
        .get();
      if (!last || last.contentHash !== lesson.hash) {
        tx.insert(lessonRevisions)
          .values({ packageId: course.id, lessonId: lesson.id, contentHash: lesson.hash, revision: (last?.revision ?? 0) + 1, createdAt: now })
          .run();
      }
    }

    for (const lq of course.quizzes.values()) {
      for (const q of lq.quiz.questions) {
        const id = questionKey(course.id, q.id);
        const hash = questionHash(q);
        const existing = tx.select().from(questions).where(eq(questions.id, id)).get();
        const meta = { chapter: lq.chapterDir, lessonId: lq.lessonId };
        // questions the model wrote for a quick lesson have no checked answer key: the quiz still shows them, exams do not draw them
        const quick = course.lessonById.get(lq.lessonId)?.origin === "quick";
        if (existing) {
          if (existing.contentHash !== hash || JSON.stringify(existing.payload) !== JSON.stringify(q)) {
            tx.update(questions).set({ contentHash: hash, payload: q, concepts: q.concepts, sources: q.sources, ...meta }).where(eq(questions.id, id)).run();
          }
          if (quick && existing.status === "active") tx.update(questions).set({ status: "unverified" }).where(eq(questions.id, id)).run();
          // a quick chapter upgraded by the deep path becomes researched, and its authored questions count again
          if (!quick && existing.origin === "authored" && existing.status === "unverified") tx.update(questions).set({ status: "active" }).where(eq(questions.id, id)).run();
          continue;
        }
        const dup = tx.select().from(questions).where(and(eq(questions.packageId, course.id), eq(questions.contentHash, hash))).get();
        if (dup) continue; // identical content already in the bank
        tx.insert(questions)
          .values({ id, packageId: course.id, contentHash: hash, type: q.type, payload: q, concepts: q.concepts, sources: q.sources, origin: "authored", status: quick ? "unverified" : "active", ...meta })
          .run();
      }
    }
  });
}

/** All valid courses on disk; syncs state into the DB whenever files changed. */
export function loadCourses(ctx: Ctx): LoadedCourse[] {
  const { courses, changed } = ctx.catalog.load();
  if (changed) for (const c of courses) syncCourse(ctx, c);
  return courses;
}

export function getCourse(ctx: Ctx, id: string): LoadedCourse {
  const c = loadCourses(ctx).find((x) => x.id === id);
  if (!c) throw new HttpError(404, `course "${id}" not found`);
  return c;
}
