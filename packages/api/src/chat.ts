import { and, asc, eq, inArray } from "drizzle-orm";
import { chatPayloadSchema, type ChatCitation, type ChatMessage, type ChatThread } from "@selfschool/shared";
import { parseSources, type LoadedCourse, type LoadedLesson } from "./catalog.js";
import type { Ctx } from "./ctx.js";
import { chatMessages, jobs } from "./db/schema.js";
import { enqueueJob, ResultRejected } from "./jobs.js";
import { getPartial } from "./partials.js";
import { slug } from "./util.js";

type Row = typeof chatMessages.$inferSelect;

const HISTORY_LIMIT = 10;
export const FAILED_TEXT = "Could not produce a grounded answer. Ask again.";

function view(ctx: Ctx, r: Row): ChatMessage {
  let status: ChatMessage["status"] = "done";
  if (r.role === "assistant" && r.jobId) {
    const job = ctx.db.select({ status: jobs.status }).from(jobs).where(eq(jobs.id, r.jobId)).get();
    status = !job ? "failed" : job.status === "done" ? "done" : job.status === "failed" ? "failed" : "pending";
  }
  const partial = status === "pending" ? getPartial(r.jobId) : undefined;
  return {
    id: r.id,
    role: r.role,
    content: status === "failed" ? FAILED_TEXT : r.content,
    covered: r.role === "assistant" && status === "done" ? r.covered : null,
    citations: (r.citations ?? []) as ChatCitation[],
    status,
    jobId: r.jobId,
    createdAt: r.createdAt,
    ...(partial ? { partial } : {}),
  };
}

const rowsFor = (ctx: Ctx, courseId: string, lessonId: string) =>
  ctx.db
    .select()
    .from(chatMessages)
    .where(and(eq(chatMessages.packageId, courseId), eq(chatMessages.lessonId, lessonId)))
    .orderBy(asc(chatMessages.id))
    .all();

/**
 * Chat is scratch work, not learning state: every API start begins with empty threads. The rows only
 * exist so an answer can arrive from the runner while the page is open. Queued chat jobs from the
 * previous run are dropped with them.
 */
export function resetChat(ctx: Ctx): void {
  ctx.db.transaction((tx) => {
    tx.update(jobs)
      .set({ status: "failed", error: "chat reset on start", updatedAt: ctx.now() })
      .where(and(eq(jobs.kind, "chat"), inArray(jobs.status, ["pending", "running"])))
      .run();
    tx.delete(chatMessages).run();
  });
}

export function chatThread(ctx: Ctx, course: LoadedCourse, lesson: LoadedLesson): ChatThread {
  return { ai: { available: ctx.aiAvailable() }, unverified: lesson.origin === "quick", messages: rowsFor(ctx, course.id, lesson.id).map((r) => view(ctx, r)) };
}

/** Number of answered (done) assistant messages in the lesson thread. */
export function answerCount(ctx: Ctx, courseId: string, lessonId: string): number {
  return rowsFor(ctx, courseId, lessonId).filter((r) => r.role === "assistant" && view(ctx, r).status === "done").length;
}

export function ask(
  ctx: Ctx,
  course: LoadedCourse,
  lesson: LoadedLesson,
  body: { question: string; selection?: string | undefined },
): { user: ChatMessage; assistant: ChatMessage } {
  const { db } = ctx;
  const now = ctx.now();
  const history = rowsFor(ctx, course.id, lesson.id)
    .map((r) => view(ctx, r))
    .filter((m) => m.status === "done" && m.content)
    .slice(-HISTORY_LIMIT)
    .map((m) => ({ role: m.role, content: m.content }));

  return db.transaction((tx) => {
    const user = tx
      .insert(chatMessages)
      .values({
        packageId: course.id, lessonId: lesson.id, role: "user", citations: [], createdAt: now,
        content: body.selection ? `“${body.selection}”\n\n${body.question}` : body.question,
      })
      .returning()
      .get();
    const assistant = tx
      .insert(chatMessages)
      .values({ packageId: course.id, lessonId: lesson.id, role: "assistant", content: "", citations: [], createdAt: now })
      .returning()
      .get();
    const jobId = enqueueJob(
      tx as unknown as Ctx["db"],
      "chat",
      {
        lesson: { id: lesson.id, title: lesson.title, text: lesson.body },
        ...(body.selection ? { selection: body.selection } : {}),
        sourcesMd: course.sourcesMd,
        history,
        question: body.question,
      },
      now,
      { messageId: assistant.id },
    );
    tx.update(chatMessages).set({ jobId }).where(eq(chatMessages.id, assistant.id)).run();
    return { user: view(ctx, user), assistant: view(ctx, { ...assistant, jobId }) };
  });
}

/** Keeps only citations that point at something in the context the model was given. */
export function validateCitations(payload: unknown, citations: { kind: "lesson" | "source"; ref: string }[]): ChatCitation[] {
  const p = chatPayloadSchema.parse(payload);
  const sources = new Map(parseSources(p.sourcesMd).map((s) => [s.n, s]));
  const headings = [...p.lesson.text.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)].map((m) => m[1]!);
  const sections = new Map<string, string>([[slug(p.lesson.title), p.lesson.title], [slug(p.lesson.id), p.lesson.title]]);
  for (const h of headings) sections.set(slug(h), h);

  const out: ChatCitation[] = [];
  const seen = new Set<string>();
  for (const c of citations) {
    let cite: ChatCitation | null = null;
    if (c.kind === "source") {
      const n = Number(/\d+/.exec(c.ref)?.[0]);
      const s = sources.get(n);
      if (s) cite = { kind: "source", ref: String(n), label: `[${n}] ${s.title}` };
    } else {
      const label = sections.get(slug(c.ref));
      if (label) cite = { kind: "lesson", ref: slug(c.ref), label };
    }
    if (cite && !seen.has(`${cite.kind}:${cite.ref}`)) {
      seen.add(`${cite.kind}:${cite.ref}`);
      out.push(cite);
    }
  }
  return out;
}

/** Applies a chat-job result. A "covered" answer without a single valid citation is rejected. */
export function applyChatResult(
  ctx: Ctx,
  job: typeof jobs.$inferSelect,
  result: { covered: boolean; answer: string; citations: { kind: "lesson" | "source"; ref: string }[] },
): void {
  const messageId = (job.ctx as { messageId?: number } | null)?.messageId;
  if (messageId === undefined) return;
  const citations = validateCitations(job.payload, result.citations);
  if (result.covered && citations.length === 0) {
    throw new ResultRejected("rejected: answer claims to be covered but cites nothing from the supplied lesson or sources");
  }
  ctx.db
    .update(chatMessages)
    .set({ content: result.answer, covered: result.covered, citations })
    .where(eq(chatMessages.id, messageId))
    .run();
}
