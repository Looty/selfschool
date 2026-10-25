import { randomUUID } from "node:crypto";
import { and, asc, eq, lt, or } from "drizzle-orm";
import { jobPayloadSchemas, jobResultSchemas, type JobEnvelope, type JobKind } from "@selfschool/shared";
import type { Db } from "./db/client.js";
import { jobs } from "./db/schema.js";
import { HttpError } from "./util.js";

export const MAX_ATTEMPTS = 3;
/** A `running` job not updated for this long is assumed orphaned (runner died) and re-claimable. */
export const STALE_RUNNING_MS = 10 * 60 * 1000;

export class JobError extends HttpError {}

/** Thrown by a result hook when a syntactically valid result must not be accepted (e.g. uncited chat answer). */
export class ResultRejected extends Error {}

export interface ResultHooks {
  /** Runs inside the same transaction as the status update; throw ResultRejected to fail the job. */
  apply?: (job: typeof jobs.$inferSelect, result: unknown) => void;
}

/** `ctx` is server-side routing info for applying the result; it is never sent to the runner. */
export function enqueueJob(
  db: Db,
  kind: JobKind,
  payload: unknown,
  now = Date.now(),
  ctx?: Record<string, unknown>,
): string {
  const parsed = jobPayloadSchemas[kind].safeParse(payload);
  if (!parsed.success) throw new JobError(400, `invalid ${kind} payload: ${parsed.error.message}`);
  const id = randomUUID();
  db.insert(jobs).values({ id, kind, payload: parsed.data, ctx: ctx ?? null, status: "pending", createdAt: now, updatedAt: now }).run();
  return id;
}

/** Atomically claims the oldest pending (or stale running) job, or returns null. */
export function claimNextJob(db: Db, now = Date.now()): JobEnvelope | null {
  return db.transaction((tx) => {
    for (;;) {
      const row = tx
        .select()
        .from(jobs)
        .where(or(eq(jobs.status, "pending"), and(eq(jobs.status, "running"), lt(jobs.updatedAt, now - STALE_RUNNING_MS))))
        .orderBy(asc(jobs.createdAt))
        .limit(1)
        .get();
      if (!row) return null;
      if (row.attempts >= MAX_ATTEMPTS) {
        tx.update(jobs)
          .set({ status: "failed", error: "gave up after repeated attempts", updatedAt: now })
          .where(eq(jobs.id, row.id))
          .run();
        continue;
      }
      tx.update(jobs)
        .set({ status: "running", attempts: row.attempts + 1, updatedAt: now })
        .where(eq(jobs.id, row.id))
        .run();
      return { id: row.id, kind: row.kind, payload: row.payload, attempts: row.attempts + 1 };
    }
  });
}

/** Stores a runner's outcome. A result that fails its kind's schema fails the job. */
export function submitJobResult(
  db: Db,
  id: string,
  submission: { ok: true; result: unknown } | { ok: false; error: string },
  now = Date.now(),
  hooks: ResultHooks = {},
): { status: "done" | "failed"; error?: string } {
  const row = db.select().from(jobs).where(eq(jobs.id, id)).get();
  if (!row) throw new JobError(404, "no such job");
  if (row.status !== "running") throw new JobError(409, `job is ${row.status}, not running`);

  if (!submission.ok) {
    db.update(jobs).set({ status: "failed", error: submission.error, updatedAt: now }).where(eq(jobs.id, id)).run();
    return { status: "failed", error: submission.error };
  }
  const parsed = jobResultSchemas[row.kind].safeParse(submission.result);
  if (!parsed.success) {
    const error = `result failed ${row.kind} schema: ${parsed.error.message}`;
    db.update(jobs).set({ status: "failed", error, updatedAt: now }).where(eq(jobs.id, id)).run();
    return { status: "failed", error };
  }
  try {
    db.transaction((tx) => {
      tx.update(jobs).set({ status: "done", result: parsed.data, error: null, updatedAt: now }).where(eq(jobs.id, id)).run();
      hooks.apply?.(row, parsed.data);
    });
  } catch (e) {
    if (!(e instanceof ResultRejected)) throw e;
    db.update(jobs).set({ status: "failed", error: e.message, updatedAt: now }).where(eq(jobs.id, id)).run();
    return { status: "failed", error: e.message };
  }
  return { status: "done" };
}

export function getJob(db: Db, id: string) {
  return db.select().from(jobs).where(eq(jobs.id, id)).get();
}
