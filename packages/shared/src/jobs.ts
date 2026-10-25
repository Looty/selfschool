import { z } from "zod";
import { examBlueprintSchema, questionSchema } from "./course.js";

export const JOB_KINDS = ["grade", "chat", "generate", "verify", "outline", "lesson"] as const;
export const jobKindSchema = z.enum(JOB_KINDS);
export type JobKind = z.infer<typeof jobKindSchema>;

export const JOB_STATUSES = ["pending", "running", "done", "failed"] as const;
export const jobStatusSchema = z.enum(JOB_STATUSES);
export type JobStatus = z.infer<typeof jobStatusSchema>;

// ---------- payloads (what the runner receives; course text is data, never instructions) ----------

export const gradePayloadSchema = z.object({
  question: z.object({
    id: z.string(),
    text: z.string(),
    rubric: z.string(),
    code: z.string().optional(),
  }),
  answer: z.string(),
  /** Relevant lesson / sources text the rubric refers to. */
  context: z.string().default(""),
});

export const chatPayloadSchema = z.object({
  lesson: z.object({ id: z.string(), title: z.string(), text: z.string() }),
  selection: z.string().optional(),
  sourcesMd: z.string().default(""),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() }))
    .default([]),
  question: z.string(),
});

export const generatePayloadSchema = z.object({
  blueprint: examBlueprintSchema,
  domain: z.string(),
  count: z.number().int().positive(),
  sourcesMd: z.string(),
  /** Hashes / concepts of questions already in the bank, to avoid duplicates. */
  existing: z.array(z.object({ hash: z.string(), concepts: z.array(z.string()) })).default([]),
});

export const verifyPayloadSchema = z.object({
  question: questionSchema,
  sourcesMd: z.string(),
});

/** Proposes a Level 2 extension. The runner has no web access: everything it may use is in the payload. */
export const outlinePayloadSchema = z.object({
  course: z.object({ title: z.string(), description: z.string().default("") }),
  /** Existing chapters and lesson titles, so the proposal builds on them instead of repeating them. */
  outline: z.array(z.object({ title: z.string(), lessons: z.array(z.string()) })),
  /** Concepts the learner is weak on (mastery 0..100), worst first. */
  weakSpots: z.array(z.object({ concept: z.string(), percent: z.number(), lesson: z.string() })).default([]),
  /** What prompted the proposal: a topic typed by the learner or an uncovered chat question. */
  seed: z
    .object({
      topic: z.string().optional(),
      question: z.string().optional(),
      /** The tutor's general-knowledge answer to the question (unverified). */
      answer: z.string().optional(),
    })
    .default({}),
  sourcesMd: z.string().default(""),
  /** How much to propose, in learner minutes (lessons plus quizzes): about 12 minutes per lesson. */
  budgetMinutes: z.number().int().positive().default(60),
});

/**
 * Writes one lesson and its quiz for an approved extension (the quick path). No web access: the lesson comes from
 * the model's own knowledge and the course sources, and is stored as unverified.
 */
export const lessonPayloadSchema = z.object({
  course: z.object({ title: z.string(), description: z.string().default("") }),
  /** Where this lesson sits in the extension, to keep tone and scope consistent. */
  chapter: z.object({ title: z.string(), why: z.string().default("") }),
  lesson: z.object({ title: z.string(), objective: z.string(), why: z.string().default("") }),
  /** Titles of the lessons written before this one in the same extension, in order. */
  previous: z.array(z.string()).default([]),
  /** Titles of the lessons still to come, so this one does not cover their ground. */
  upcoming: z.array(z.string()).default([]),
  /** Titles of the core course's lessons, so nothing is repeated. */
  existing: z.array(z.string()).default([]),
  sourcesMd: z.string().default(""),
});

export const jobPayloadSchemas = {
  grade: gradePayloadSchema,
  chat: chatPayloadSchema,
  generate: generatePayloadSchema,
  verify: verifyPayloadSchema,
  outline: outlinePayloadSchema,
  lesson: lessonPayloadSchema,
} as const;

// ---------- results (what the model must return; validated before it is posted) ----------

export const gradeResultSchema = z.object({
  /** 0..1 */
  score: z.number().min(0).max(1),
  correct: z.boolean(),
  feedback: z.string().min(1),
});

export const citationSchema = z.object({
  kind: z.enum(["lesson", "source"]),
  /** Source number for `source`, or a lesson section heading for `lesson`. */
  ref: z.string().min(1),
});

export const chatResultSchema = z.object({
  /** false = "not covered in this course" */
  covered: z.boolean(),
  answer: z.string().min(1),
  citations: z.array(citationSchema).default([]),
});

export const generateResultSchema = z.object({
  questions: z.array(questionSchema),
});

export const verifyResultSchema = z.object({
  verdict: z.enum(["ok", "wrong", "unclear"]),
  notes: z.string().default(""),
});

export const outlineLessonSchema = z.object({
  title: z.string().min(1),
  /** One sentence: what the learner will be able to do afterwards. */
  objective: z.string().min(1),
  /** Why it is proposed (a weak spot, a gap, a follow-up to a question). */
  why: z.string().default(""),
});

export const outlineChapterSchema = z.object({
  title: z.string().min(1),
  why: z.string().default(""),
  lessons: z.array(outlineLessonSchema).min(1),
});

export const outlineResultSchema = z.object({
  /** Level name, e.g. "Level 2 · Deep dive". */
  title: z.string().min(1),
  rationale: z.string().min(1),
  chapters: z.array(outlineChapterSchema).min(1),
  /** True when the outline relies on facts that are not in the course sources (no research was possible). */
  unverified: z.boolean().default(true),
});
export type OutlineResult = z.infer<typeof outlineResultSchema>;

/** The model returns content only. Ids, frontmatter, file names and the quiz id are assigned by the API. */
export const lessonResultSchema = z.object({
  /** Markdown body without frontmatter. */
  body: z.string().min(1),
  questions: z.array(questionSchema).min(1),
});
export type LessonResult = z.infer<typeof lessonResultSchema>;

export const jobResultSchemas = {
  grade: gradeResultSchema,
  chat: chatResultSchema,
  generate: generateResultSchema,
  verify: verifyResultSchema,
  outline: outlineResultSchema,
  lesson: lessonResultSchema,
} as const;

export type JobPayloads = { [K in JobKind]: z.infer<(typeof jobPayloadSchemas)[K]> };
export type JobResults = { [K in JobKind]: z.infer<(typeof jobResultSchemas)[K]> };

// ---------- API wire shapes ----------

/** `GET /jobs/next` response body (204 when nothing is pending). */
export const jobEnvelopeSchema = z.object({
  id: z.string(),
  kind: jobKindSchema,
  payload: z.unknown(),
  attempts: z.number().int(),
});
export type JobEnvelope = z.infer<typeof jobEnvelopeSchema>;

/** `POST /jobs/:id/result` request body. */
export const jobResultSubmissionSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), result: z.unknown(), meta: z.record(z.string(), z.unknown()).optional() }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type JobResultSubmission = z.infer<typeof jobResultSubmissionSchema>;

/** `GET /health` response body. */
export const healthSchema = z.object({
  ok: z.boolean(),
  migrated: z.boolean(),
  runner: z.object({ connected: z.boolean(), lastSeen: z.number().nullable() }),
});
export type Health = z.infer<typeof healthSchema>;
