import { z } from "zod";
import { chapterOriginSchema, ellipseRegionSchema, polyRegionSchema, rectRegionSchema } from "./course.js";
import { jobKindSchema, jobStatusSchema, healthSchema, outlineResultSchema } from "./jobs.js";

/**
 * HTTP contract between web and api: zod schemas for every endpoint the six screens need, plus a
 * typed route table (`routes`) both sides build on. Learner-facing payloads never contain answer
 * keys; those are revealed only in answer/attempt results after submission.
 * Timestamps are unix ms. All paths are relative to the api root (web reaches it at `/api`).
 */

// ---------- common ----------

export const hueSchema = z.enum(["blue", "orange", "teal", "pink"]);
export type Hue = z.infer<typeof hueSchema>;

const id = z.string().min(1);

export const progressSchema = z.object({
  done: z.number().int().min(0),
  total: z.number().int().min(0),
  /** 0..100, integer */
  percent: z.number().min(0).max(100),
});
export type Progress = z.infer<typeof progressSchema>;

export const courseRefSchema = z.object({
  id,
  title: z.string(),
  /** 2-4 letter mono monogram, e.g. TS */
  monogram: z.string().min(1).max(4),
  hue: hueSchema,
});
export type CourseRef = z.infer<typeof courseRefSchema>;

export const lessonRefSchema = z.object({ id, title: z.string() });
export type LessonRef = z.infer<typeof lessonRefSchema>;

export const aiStatusSchema = z.object({
  /** false = runner down: chat and open-answer grading are paused (jobs still queue). */
  available: z.boolean(),
});
export type AiStatus = z.infer<typeof aiStatusSchema>;

export const marksSchema = z.object({ got: z.number(), max: z.number() });
export type Marks = z.infer<typeof marksSchema>;

// ---------- courses ----------

/** End-to-end time estimate from the content (see `time.ts` for the constants). Minutes. */
export const courseTimeSchema = z.object({
  /** Reading every lesson. */
  readingMinutes: z.number().int(),
  /** Answering every quiz once. */
  practiceMinutes: z.number().int(),
  /** Sitting every exam once (their time limit). */
  examMinutes: z.number().int(),
  totalMinutes: z.number().int(),
  /** What is left: lessons not completed with their quizzes, and exams not passed. */
  remainingMinutes: z.number().int(),
});
export type CourseTime = z.infer<typeof courseTimeSchema>;

export const courseSummarySchema = courseRefSchema.extend({
  lessonCount: z.number().int(),
  examCount: z.number().int(),
  time: courseTimeSchema,
  percent: z.number().min(0).max(100),
  started: z.boolean(),
  /** A newer package revision changed a lesson the learner already completed. */
  updated: z.boolean(),
});
export type CourseSummary = z.infer<typeof courseSummarySchema>;

export const lessonStatusSchema = z.enum(["done", "current", "todo"]);
export type LessonStatus = z.infer<typeof lessonStatusSchema>;

export const lessonRowSchema = z.object({
  id,
  title: z.string(),
  minutes: z.number().int(),
  status: lessonStatusSchema,
  /** Revision the learner would read now. */
  revision: z.number().int().min(1),
  /** Shows the `UPDATED · REV n` pill: revision is newer than the one completed. */
  updated: z.boolean(),
  /** The quiz at the end of the lesson, if it has one. */
  quiz: z.object({ questionCount: z.number().int() }).nullable(),
});
export type LessonRow = z.infer<typeof lessonRowSchema>;

export const chapterOutlineSchema = z.object({
  dir: z.string(),
  title: z.string(),
  /** Reading the chapter's lessons plus answering their quizzes once. */
  minutes: z.number().int(),
  /** 1 = core course; 2 and up are extensions (shown apart, outside the core percent and time). */
  level: z.number().int().min(1),
  /** `quick` chapters are written in-app from model knowledge and are unverified. */
  origin: chapterOriginSchema,
  done: z.number().int(),
  total: z.number().int(),
  lessons: z.array(lessonRowSchema),
});
export type ChapterOutline = z.infer<typeof chapterOutlineSchema>;

export const examStatusSchema = z.enum(["not_started", "in_progress", "provisional", "passed", "failed"]);
export type ExamStatus = z.infer<typeof examStatusSchema>;

export const examRowSchema = z.object({
  id,
  title: z.string(),
  questionCount: z.number().int(),
  durationMinutes: z.number().int(),
  passingPercentage: z.number(),
  /** 0 = unlimited */
  maxAttempts: z.number().int(),
  attemptCount: z.number().int(),
  pendingCount: z.number().int(),
  status: examStatusSchema,
});
export type ExamRow = z.infer<typeof examRowSchema>;

export const courseDetailSchema = courseSummarySchema.extend({
  description: z.string(),
  level: z.string(),
  tags: z.array(z.string()),
  progress: progressSchema,
  chapters: z.array(chapterOutlineSchema),
  exams: z.array(examRowSchema),
  resume: lessonRefSchema.nullable(),
  source: z.object({ repo: z.string(), sha: z.string(), sourceCount: z.number().int() }),
});
export type CourseDetail = z.infer<typeof courseDetailSchema>;

// ---------- dashboard ----------

export const continueCardSchema = z.object({
  course: courseRefSchema,
  lesson: lessonRefSchema,
  /** 1-based position in the course, e.g. 6 of 12 */
  lessonNumber: z.number().int(),
  lessonTotal: z.number().int(),
  chapterTitle: z.string(),
  minutes: z.number().int(),
  progress: progressSchema,
  upNext: lessonRefSchema.nullable(),
});
export type ContinueCard = z.infer<typeof continueCardSchema>;

export const weekStatsSchema = z.object({
  streakDays: z.number().int(),
  studiedMinutes: z.number().int(),
  questionsAnswered: z.number().int(),
  /** Monday first. */
  days: z.array(z.object({ label: z.string(), minutes: z.number().int(), today: z.boolean() })).length(7),
});
export type WeekStats = z.infer<typeof weekStatsSchema>;

export const activityCellSchema = z.object({
  /** YYYY-MM-DD */
  date: z.string(),
  /** heatmap ramp level 0..4 */
  level: z.number().int().min(0).max(4),
});

export const weakSpotSchema = z.object({
  concept: z.string(),
  /** 0..100 mastery */
  percent: z.number().min(0).max(100),
  course: courseRefSchema,
  lesson: lessonRefSchema,
});
export type WeakSpot = z.infer<typeof weakSpotSchema>;

export const dashboardSchema = z.object({
  continue: continueCardSchema.nullable(),
  week: weekStatsSchema,
  /** 16 weeks x 7 days, oldest first (112 cells). */
  activity: z.array(activityCellSchema).length(112),
  weakSpots: z.array(weakSpotSchema).max(5),
  /** AI-graded answers still waiting for the runner. */
  pendingGrading: z.number().int(),
  courses: z.array(courseSummarySchema),
});
export type Dashboard = z.infer<typeof dashboardSchema>;

// ---------- lesson ----------

export const lessonSourceSchema = z.object({
  n: z.number().int().positive(),
  title: z.string(),
  url: z.string().optional(),
  note: z.string().optional(),
});

export const lessonResourceSchema = z.object({ name: z.string(), url: z.string() });

export const lessonSchema = z.object({
  course: courseRefSchema,
  chapterTitle: z.string(),
  lesson: lessonRefSchema,
  /** 1-based position among all lessons of the course. */
  number: z.number().int(),
  total: z.number().int(),
  revision: z.number().int().min(1),
  minutes: z.number().int(),
  /** 1 = core course; 2 and up are extensions. */
  level: z.number().int().min(1),
  /** `quick` lessons were written from the model's knowledge and are unverified. */
  origin: chapterOriginSchema,
  /** First paragraph, rendered large as the standfirst; NOT repeated in `markdown`. */
  standfirst: z.string(),
  /** Rest of the lesson body. Citations are written `[3]`, resolved against `sources`. */
  markdown: z.string(),
  sources: z.array(lessonSourceSchema),
  resources: z.array(lessonResourceSchema),
  prev: lessonRefSchema.nullable(),
  next: lessonRefSchema.nullable(),
  quiz: z.object({ id, title: z.string(), questionCount: z.number().int() }).nullable(),
  completed: z.boolean(),
  progress: progressSchema,
  /** Contents menu. */
  chapters: z.array(chapterOutlineSchema),
  /** Exam row in the Contents menu, if one follows this chapter. */
  exam: examRowSchema.nullable(),
  ai: aiStatusSchema,
  answerCount: z.number().int(),
});
export type Lesson = z.infer<typeof lessonSchema>;

export const completeLessonResultSchema = z.object({
  completed: z.literal(true),
  revision: z.number().int(),
  progress: progressSchema,
});

// ---------- questions, quizzes, attempts ----------

/** Question as shown to the learner: no answer keys. MCQ options are addressed by index. */
export const learnerQuestionSchema = z.discriminatedUnion("type", [
  z.object({
    id, type: z.literal("mcq"), text: z.string(), code: z.string().optional(),
    options: z.array(z.object({ text: z.string() })).min(2),
    /** More than one option is correct: the learner selects all that apply. */
    multiple: z.boolean().optional(),
  }),
  z.object({ id, type: z.literal("short"), text: z.string(), code: z.string().optional() }),
  z.object({ id, type: z.literal("open"), text: z.string(), code: z.string().optional() }),
  z.object({
    id, type: z.literal("fill"), text: z.string(), code: z.string().optional(),
    template: z.string(),
    /** The bank in display order; `id` is the chip's authored index, which answers refer to. */
    chips: z.array(z.object({ id: z.number().int().min(0), text: z.string() })).min(1),
  }),
  z.object({
    id, type: z.literal("sort"), text: z.string(), code: z.string().optional(),
    buckets: z.array(z.string()).min(2),
    /** Items in display order; `id` is the item's authored index, which answers refer to. */
    items: z.array(z.object({ id: z.number().int().min(0), text: z.string() })).min(2),
  }),
  z.object({ id, type: z.literal("spot"), text: z.string(), code: z.string(), diff: z.boolean().optional() }),
  z.object({
    id, type: z.literal("match"), text: z.string(), code: z.string().optional(),
    /** Items on the left in authored order; `id` is the item's authored index (its partner has the same right-hand id). */
    left: z.array(z.object({ id: z.number().int().min(0), text: z.string() })).min(2),
    /** Items on the right in display order; ids at or past the number of pairs are distractors. */
    right: z.array(z.object({ id: z.number().int().min(0), text: z.string() })).min(2),
  }),
  z.object({
    id, type: z.literal("trace"), text: z.string(), code: z.string(),
    variables: z.array(z.string()).min(1),
    /** One row per step. `given` holds only the cells that are shown pre-filled; every other cell is the learner's to fill in. */
    steps: z.array(z.object({ label: z.string(), given: z.record(z.string(), z.string()) })).min(1),
  }),
  z.object({
    id, type: z.literal("hotspot"), text: z.string(), code: z.string().optional(),
    /** Path under the course, e.g. `resources/diagram.svg`; served by the course files endpoint. */
    image: z.string(), alt: z.string(),
    /** How many markers to place: the number of correct regions. The regions themselves are never sent. */
    picks: z.number().int().min(1),
  }),
]);
export type LearnerQuestion = z.infer<typeof learnerQuestionSchema>;

export const learnerQuizSchema = z.object({
  course: courseRefSchema,
  lesson: lessonRefSchema,
  quiz: z.object({
    id,
    title: z.string(),
    passingPercentage: z.number(),
    /** 0 = unlimited */
    maxAttempts: z.number().int(),
    showAnswers: z.boolean(),
  }),
  /** Next attempt number (1-based). */
  attemptNumber: z.number().int(),
  questions: z.array(learnerQuestionSchema).min(1),
  progress: progressSchema,
});
export type LearnerQuiz = z.infer<typeof learnerQuizSchema>;

export const answerInputSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("mcq"), selected: z.array(z.number().int().min(0)).min(1) }),
  z.object({ type: z.literal("short"), text: z.string() }),
  z.object({ type: z.literal("open"), text: z.string().min(1) }),
  /** Chip ids in slot order (slot 1 first); every slot filled, no chip used twice. */
  z.object({ type: z.literal("fill"), slots: z.array(z.number().int().min(0)).min(1) }),
  /** Bucket index for each item, by the item's authored id (item 0 first); every item placed. */
  z.object({ type: z.literal("sort"), buckets: z.array(z.number().int().min(0)).min(1) }),
  /** 1-based line numbers the learner selected. */
  z.object({ type: z.literal("spot"), lines: z.array(z.number().int().positive()).min(1) }),
  /** For each left item (by authored id, item 0 first), the id of the right item it was connected to; every item connected, no right item twice. */
  z.object({ type: z.literal("match"), pairs: z.array(z.number().int().min(0)).min(1) }),
  /** Typed values, one row per step and one column per variable; a pre-filled (given) cell is sent as an empty string and ignored. */
  z.object({ type: z.literal("trace"), cells: z.array(z.array(z.string())).min(1) }),
  /** Where the learner clicked, in percent of the image; at most `picks` markers. */
  z.object({ type: z.literal("hotspot"), points: z.array(z.object({ x: z.number().min(0).max(100), y: z.number().min(0).max(100) })).min(1) }),
]);
export type AnswerInput = z.infer<typeof answerInputSchema>;

export const feedbackPointSchema = z.object({
  ok: z.boolean(),
  text: z.string(),
  lesson: lessonRefSchema.optional(),
});

export const aiFeedbackSchema = z.object({
  marks: marksSchema,
  points: z.array(feedbackPointSchema),
});
export type AiFeedback = z.infer<typeof aiFeedbackSchema>;

/**
 * recorded: stored, nothing revealed (exams, or quiz with show_answers off)
 * scored: MCQ/short scored locally; grading: open answer queued as a job;
 * graded: AI feedback arrived; failed: the grade job failed (retry via re-submit).
 */
export const answerStateSchema = z.enum(["recorded", "scored", "grading", "graded", "failed"]);

export const answerResultSchema = z.object({
  questionId: id,
  type: z.enum(["mcq", "short", "open", "fill", "sort", "spot", "hotspot", "match", "trace"]),
  state: answerStateSchema,
  correct: z.boolean().nullable(),
  marks: marksSchema.nullable(),
  /** Match: per left item what it was connected to, what it belongs with and why, once revealed. */
  matches: z
    .array(z.object({ id: z.number().int(), left: z.string(), placed: z.string().nullable(), correct: z.boolean(), answer: z.string(), explanation: z.string() }))
    .optional(),
  /** Trace: every cell with what was typed and what was expected, once revealed. */
  trace: z
    .object({
      variables: z.array(z.string()),
      steps: z.array(z.object({ label: z.string(), cells: z.array(z.object({ given: z.boolean(), placed: z.string(), correct: z.boolean(), answer: z.string() })) })),
      explanation: z.string(),
    })
    .optional(),
  /** Sort: per item (authored order) where it was put, where it belongs and why, once revealed. */
  sorted: z
    .array(z.object({ id: z.number().int(), text: z.string(), placed: z.string(), correct: z.boolean(), answer: z.string(), explanation: z.string() }))
    .optional(),
  /** Spot: the lines selected, the lines that were the answer and why, once revealed. */
  spot: z.object({ picked: z.array(z.number().int()), correct: z.array(z.number().int()), explanation: z.string() }).optional(),
  /** Hotspot: every region (answer and decoys) with whether a marker landed in it, and each marker's verdict. */
  hotspot: z
    .object({
      regions: z.array(
        z.discriminatedUnion("shape", [
          rectRegionSchema.extend({ hit: z.boolean() }),
          ellipseRegionSchema.extend({ hit: z.boolean() }),
          polyRegionSchema.extend({ hit: z.boolean() }),
        ]),
      ),
      points: z.array(z.object({ x: z.number(), y: z.number(), ok: z.boolean(), region: z.string().nullable() })),
    })
    .optional(),
  /**
   * Fill: per slot what was placed and what belongs there, once revealed. `explanation` is about the chip that
   * belongs in the slot; `placedExplanation` says why the placed chip does not fit, and only a wrong slot has it.
   */
  slots: z
    .array(
      z.object({
        placed: z.string(),
        correct: z.boolean(),
        answer: z.string(),
        explanation: z.string(),
        placedExplanation: z.string().optional(),
      }),
    )
    .optional(),
  /** MCQ: every option with its authored explanation, once revealed. */
  options: z
    .array(z.object({ text: z.string(), correct: z.boolean(), selected: z.boolean(), explanation: z.string() }))
    .optional(),
  /** Short: accepted answers, once revealed. */
  accepted: z.array(z.string()).optional(),
  /** Open: what the learner wrote, feedback when graded. */
  answerText: z.string().optional(),
  feedback: aiFeedbackSchema.nullable(),
  jobId: z.string().nullable(),
});
export type AnswerResult = z.infer<typeof answerResultSchema>;

export const attemptKindSchema = z.enum(["quiz", "exam"]);

export const attemptResultSchema = z.object({
  id,
  kind: attemptKindSchema,
  course: courseRefSchema,
  /** Quiz id or exam id. */
  targetId: id,
  title: z.string(),
  number: z.number().int(),
  startedAt: z.number().int(),
  finishedAt: z.number().int().nullable(),
  passingPercentage: z.number(),
  score: z.object({
    /** Percent of marks from graded answers so far; null when nothing is scored yet. */
    percent: z.number().nullable(),
    got: z.number(),
    max: z.number(),
    scoredCount: z.number().int(),
    totalCount: z.number().int(),
    pendingCount: z.number().int(),
    /** Largest swing in percentage points the pending answers could cause. */
    maxSwingPoints: z.number(),
  }),
  /** True while pendingCount > 0. */
  provisional: z.boolean(),
  /** null until finished and not provisional. */
  passed: z.boolean().nullable(),
  byDomain: z.array(z.object({ id, title: z.string(), percent: z.number() })),
  answers: z.array(answerResultSchema),
  missed: z.array(
    z.object({
      questionId: id,
      number: z.number().int(),
      text: z.string(),
      domainTitle: z.string().nullable(),
      lesson: lessonRefSchema.nullable(),
      /** Open answer still waiting for the runner: shown with a clock, no report button. */
      pending: z.boolean(),
    }),
  ),
  /** Other attempts at the same target, oldest first. */
  history: z.array(
    z.object({
      id,
      number: z.number().int(),
      date: z.number().int(),
      percent: z.number().nullable(),
      status: z.enum(["in_progress", "provisional", "passed", "failed"]),
    }),
  ),
  ai: aiStatusSchema,
});
export type AttemptResult = z.infer<typeof attemptResultSchema>;

export const startedAttemptSchema = z.object({ attemptId: id });

/** One row of the Attempts page: any quiz or exam attempt, newest first. */
export const attemptListItemSchema = z.object({
  id,
  kind: z.enum(["quiz", "exam"]),
  course: courseRefSchema,
  targetId: id,
  title: z.string(),
  number: z.number().int(),
  date: z.number().int(),
  percent: z.number().nullable(),
  status: z.enum(["in_progress", "provisional", "passed", "failed"]),
  /** Open answers still waiting for the runner. */
  pendingCount: z.number().int(),
});
export type AttemptListItem = z.infer<typeof attemptListItemSchema>;
export const attemptListSchema = z.object({ attempts: z.array(attemptListItemSchema) });

// ---------- exams ----------

export const examInfoSchema = z.object({
  course: courseRefSchema,
  exam: examRowSchema,
  domains: z.array(z.object({ id, title: z.string(), weight: z.number() })),
  attempts: attemptResultSchema.shape.history,
  latestAttemptId: id.nullable(),
});
export type ExamInfo = z.infer<typeof examInfoSchema>;

export const examInstanceSchema = z.object({
  id,
  examId: id,
  course: courseRefSchema,
  title: z.string(),
  attemptId: id,
  durationMinutes: z.number().int(),
  startedAt: z.number().int(),
  questions: z.array(learnerQuestionSchema),
});
export type ExamInstance = z.infer<typeof examInstanceSchema>;

export const regenerateResultSchema = z.object({
  instance: examInstanceSchema,
  /** How the new instance was filled: unseen bank questions first, then generated + verified. */
  drawn: z.object({ fromBank: z.number().int(), generating: z.number().int() }),
  /** Set when generation jobs were queued and the instance is not yet full. */
  jobId: z.string().nullable(),
});

// ---------- chat ----------

export const chatCitationSchema = z.object({
  kind: z.enum(["lesson", "source"]),
  ref: z.string(),
  /** Human label for the chip, e.g. "Type predicates" or "[3] Handbook: Narrowing". */
  label: z.string(),
});
export type ChatCitation = z.infer<typeof chatCitationSchema>;

export const chatMessageSchema = z.object({
  id: z.number().int(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  /** Assistant only: false = "Not covered in this course." (offers Propose as extension). */
  covered: z.boolean().nullable(),
  citations: z.array(chatCitationSchema),
  status: z.enum(["done", "pending", "failed"]),
  jobId: z.string().nullable(),
  createdAt: z.number().int(),
  /** While pending: the answer written so far. A preview only; citations are checked when the answer is final. */
  partial: z.string().optional(),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const chatThreadSchema = z.object({
  ai: aiStatusSchema,
  /** The lesson was written by the model (quick chapter), so even a "covered" answer rests on unverified text. */
  unverified: z.boolean(),
  messages: z.array(chatMessageSchema),
});
export type ChatThread = z.infer<typeof chatThreadSchema>;

export const askRequestSchema = z.object({
  question: z.string().min(1),
  /** Text the learner selected in the lesson ("Ask about this"). */
  selection: z.string().optional(),
});

export const askResultSchema = z.object({
  user: chatMessageSchema,
  /** status "pending" until the chat job finishes; poll `job` or refetch the thread. */
  assistant: chatMessageSchema,
});

export const jobStatusViewSchema = z.object({
  id,
  kind: jobKindSchema,
  status: jobStatusSchema,
  error: z.string().nullable(),
});
export type JobStatusView = z.infer<typeof jobStatusViewSchema>;

// ---------- extensions (Level 2 proposals) ----------

export const EXTENSION_STATUSES = ["drafting", "ready", "failed", "approved", "rejected"] as const;
export const extensionStatusSchema = z.enum(EXTENSION_STATUSES);
export type ExtensionStatus = z.infer<typeof extensionStatusSchema>;

/** What the learner asked for. A chat seed carries the question and the tutor's answer, because chat is not kept. */
export const extensionSeedSchema = z.object({
  topic: z.string().optional(),
  question: z.string().optional(),
  answer: z.string().optional(),
  fromLesson: lessonRefSchema.optional(),
});
export type ExtensionSeed = z.infer<typeof extensionSeedSchema>;

/** Progress of "Generate here": the runner writes one lesson at a time into the extensions folder. */
export const extensionGenerationSchema = z.object({
  total: z.number().int().nonnegative(),
  done: z.number().int().nonnegative(),
  state: z.enum(["running", "failed", "done"]),
  /** Title of the lesson being written, or the one that failed; null when done. */
  current: z.string().nullable(),
  error: z.string().nullable(),
});
export type ExtensionGeneration = z.infer<typeof extensionGenerationSchema>;

export const extensionViewSchema = z.object({
  id,
  courseId: id,
  status: extensionStatusSchema,
  seed: extensionSeedSchema,
  /** Depth the outline was sized for, in learner minutes. */
  budgetMinutes: z.number().int().positive(),
  jobId: id.nullable(),
  /** Why drafting failed. */
  error: z.string().nullable(),
  /** Present once drafted; after approval it is the version the learner approved (possibly edited). */
  outline: outlineResultSchema.nullable(),
  /** Set once "Generate here" has started (approved proposals only). */
  generation: extensionGenerationSchema.nullable(),
  createdAt: z.number(),
  decidedAt: z.number().nullable(),
});
export type ExtensionView = z.infer<typeof extensionViewSchema>;

export const extensionListSchema = z.object({ extensions: z.array(extensionViewSchema) });

export const extensionDecisionSchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("approve"), outline: outlineResultSchema }),
  z.object({ decision: z.literal("reject") }),
]);
export type ExtensionDecision = z.infer<typeof extensionDecisionSchema>;

// ---------- settings + packages ----------

export const modelsSchema = z.object({
  grade: z.string(),
  chat: z.string(),
  generate: z.string(),
  verify: z.string(),
});
export type Models = z.infer<typeof modelsSchema>;

export const settingsSchema = z.object({
  models: modelsSchema,
  /** Allowed model names per job kind, for the selects. */
  modelOptions: z.record(jobKindSchema, z.array(z.string())),
  runner: z.object({ connected: z.boolean(), lastSeen: z.number().nullable() }),
  provider: z.object({ name: z.string(), detail: z.string() }),
  database: z.object({ sizeBytes: z.number().int() }),
});
export type Settings = z.infer<typeof settingsSchema>;

export const updateSettingsSchema = z.object({ models: modelsSchema.partial() });

export const packageInfoSchema = z.object({
  id,
  course: courseRefSchema,
  url: z.string(),
  path: z.string(),
  ref: z.string(),
  sha: z.string(),
  status: z.enum(["up_to_date", "update_available"]),
  latestSha: z.string().nullable(),
});
export type PackageInfo = z.infer<typeof packageInfoSchema>;

export const addPackageSchema = z.object({ url: z.string().min(1), path: z.string().default(""), ref: z.string().default("main") });

/**
 * What a dropped course zip contains and whether it can be added, from a dry run that installs nothing.
 * Served by `POST /packages/upload/preview` (raw zip body); `POST /packages/upload` installs and answers with a PackageInfo.
 */
/** One course folder inside a repository that holds several. `path` is what to send as Path to import it. */
export const courseChoiceSchema = z.object({
  path: z.string(),
  id: z.string(),
  title: z.string(),
  level: z.string(),
  lessonCount: z.number(),
  /** False when the folder does not validate; it cannot be imported. */
  ok: z.boolean(),
  /** `update` = installed from this same repo (import replaces it); `clash` = the id belongs to another source. */
  conflict: z.enum(["none", "update", "clash"]),
});
export type CourseChoice = z.infer<typeof courseChoiceSchema>;

export const packagePreviewSchema = z.object({
  /** True when every check passed and the course can be added. */
  ok: z.boolean(),
  fileName: z.string(),
  sizeBytes: z.number(),
  fileCount: z.number(),
  /** The steps the server ran, in order; the first failing one carries the reason. */
  checks: z.array(z.object({ label: z.string(), ok: z.boolean(), detail: z.string().optional() })),
  /** Validator findings (file and message), empty when the package is valid. */
  issues: z.array(z.object({ file: z.string(), message: z.string() })),
  /** `update` = an earlier upload of this course will be replaced; `clash` = the id belongs to a different source. */
  conflict: z.enum(["none", "update", "clash"]),
  /** A repository that holds several courses: one entry per course folder, so the popup can offer a multi-select. */
  choices: z.array(courseChoiceSchema).optional(),
  course: z
    .object({
      id: z.string(),
      title: z.string(),
      shortIntro: z.string(),
      level: z.string(),
      lessonCount: z.number(),
      quizCount: z.number(),
      questionCount: z.number(),
      examCount: z.number(),
      chapters: z.array(
        z.object({
          dir: z.string(),
          title: z.string(),
          lessons: z.array(z.object({ id: z.string(), title: z.string(), quiz: z.object({ title: z.string(), questions: z.number(), types: z.array(z.string()) }).nullable() })),
        }),
      ),
      exams: z.array(z.object({ id: z.string(), title: z.string(), minutes: z.number(), questions: z.number() })),
    })
    .nullable(),
});
export type PackagePreview = z.infer<typeof packagePreviewSchema>;

/** What removing a course deletes, shown in the confirm popup. Served by `GET /packages/:id/removal`; `DELETE /packages/:id` does it. */
export const courseRemovalSchema = z.object({
  id: z.string(),
  title: z.string(),
  /** Where it was installed from (repo URL, `zip:<name>`, or `local:<folder>`). */
  source: z.string(),
  lessonsCompleted: z.number(),
  attempts: z.number(),
  bankQuestions: z.number(),
  chatMessages: z.number(),
  extensionProposals: z.number(),
  /** XP earned on this course, which the dashboard total loses. */
  xp: z.number(),
});
export type CourseRemoval = z.infer<typeof courseRemovalSchema>;

/**
 * Whether a course installed from a GitHub repo has news, and which other branches or tags it could be switched to.
 * Served by `GET /packages/:id/updates` (on demand, never automatic: anonymous GitHub calls are limited to 60 an hour).
 * `status` is "unknown" when nothing could be checked (not from GitHub, offline, rate limit); `note` says why.
 */
export const packageUpdatesSchema = z.object({
  ref: z.string(),
  sha: z.string(),
  latestSha: z.string().nullable(),
  status: z.enum(["up_to_date", "update_available", "unknown"]),
  branches: z.array(z.string()),
  tags: z.array(z.string()),
  note: z.string().nullable(),
});
export type PackageUpdates = z.infer<typeof packageUpdatesSchema>;

/** A course removed from the app whose files are still in the courses folder; `GET /packages/removed`. */
export const removedCourseSchema = z.object({ id: z.string(), title: z.string(), folder: z.string() });
export type RemovedCourse = z.infer<typeof removedCourseSchema>;
export const removedCoursesSchema = z.object({ courses: z.array(removedCourseSchema) });

export const reportQuestionSchema = z.object({ reason: z.string().optional() });

// ---------- route table ----------

type Opt = z.ZodType | undefined;
type Method = "GET" | "POST" | "PUT" | "DELETE";

export interface RouteDef<P extends Opt, Q extends Opt, B extends Opt, R extends z.ZodType> {
  method: Method;
  /** `:name` segments are filled from `params`. */
  path: string;
  params?: P;
  query?: Q;
  body?: B;
  res: R;
}

function route<P extends Opt = undefined, Q extends Opt = undefined, B extends Opt = undefined, R extends z.ZodType = z.ZodType>(
  d: RouteDef<P, Q, B, R>,
): RouteDef<P, Q, B, R> {
  return d;
}

const p = <S extends Record<string, z.ZodString>>(shape: S) => z.object(shape);
const course = p({ courseId: id });
const lessonP = p({ courseId: id, lessonId: id });
const examP = p({ courseId: id, examId: id });
const attemptP = p({ attemptId: id });

export const routes = {
  health: route({ method: "GET", path: "/health", res: healthSchema }),
  job: route({ method: "GET", path: "/jobs/:id", params: p({ id }), res: jobStatusViewSchema }),

  dashboard: route({ method: "GET", path: "/dashboard", res: dashboardSchema }),

  courses: route({ method: "GET", path: "/courses", res: z.object({ courses: z.array(courseSummarySchema) }) }),
  course: route({ method: "GET", path: "/courses/:courseId", params: course, res: courseDetailSchema }),
  proposeExtension: route({
    method: "POST",
    path: "/courses/:courseId/extensions",
    params: course,
    body: z.object({
      topic: z.string().optional(),
      fromLessonId: id.optional(),
      question: z.string().optional(),
      answer: z.string().optional(),
      budgetMinutes: z.number().int().positive().max(5000).optional(),
    }),
    res: z.object({ extensionId: id, jobId: id }),
  }),
  extensions: route({ method: "GET", path: "/courses/:courseId/extensions", params: course, res: extensionListSchema }),
  extension: route({ method: "GET", path: "/extensions/:extensionId", params: p({ extensionId: id }), res: extensionViewSchema }),
  /** Drafts the outline again at another depth. Replaces the current outline; only before a decision. */
  redraftExtension: route({
    method: "POST",
    path: "/extensions/:extensionId/redraft",
    params: p({ extensionId: id }),
    body: z.object({ budgetMinutes: z.number().int().positive().max(5000) }),
    res: z.object({ jobId: id }),
  }),
  /** Approving saves the (possibly edited) outline. Nothing is generated by this call. */
  decideExtension: route({
    method: "POST",
    path: "/extensions/:extensionId/decision",
    params: p({ extensionId: id }),
    body: extensionDecisionSchema,
    res: extensionViewSchema,
  }),
  /** Quick path: the runner writes the approved lessons one job at a time, unverified, into the extensions folder. */
  generateExtension: route({
    method: "POST",
    path: "/extensions/:extensionId/generate",
    params: p({ extensionId: id }),
    res: z.object({ jobId: id }),
  }),
  /** Continues a generation that stopped on a failed lesson, from the first lesson not yet written. */
  resumeExtension: route({
    method: "POST",
    path: "/extensions/:extensionId/resume",
    params: p({ extensionId: id }),
    res: z.object({ jobId: id }),
  }),
  /** Self-contained markdown for writing the approved chapters elsewhere (deep path). Approved proposals only. */
  extensionBrief: route({
    method: "GET",
    path: "/extensions/:extensionId/brief",
    params: p({ extensionId: id }),
    res: z.object({ markdown: z.string() }),
  }),

  lesson: route({ method: "GET", path: "/courses/:courseId/lessons/:lessonId", params: lessonP, res: lessonSchema }),
  completeLesson: route({
    method: "POST",
    path: "/courses/:courseId/lessons/:lessonId/complete",
    params: lessonP,
    res: completeLessonResultSchema,
  }),

  chat: route({ method: "GET", path: "/courses/:courseId/lessons/:lessonId/chat", params: lessonP, res: chatThreadSchema }),
  ask: route({
    method: "POST",
    path: "/courses/:courseId/lessons/:lessonId/chat",
    params: lessonP,
    body: askRequestSchema,
    res: askResultSchema,
  }),

  quiz: route({ method: "GET", path: "/courses/:courseId/quizzes/:quizId", params: p({ courseId: id, quizId: id }), res: learnerQuizSchema }),
  startQuizAttempt: route({
    method: "POST",
    path: "/courses/:courseId/quizzes/:quizId/attempts",
    params: p({ courseId: id, quizId: id }),
    res: startedAttemptSchema,
  }),

  exam: route({ method: "GET", path: "/courses/:courseId/exams/:examId", params: examP, res: examInfoSchema }),
  startExam: route({ method: "POST", path: "/courses/:courseId/exams/:examId/instances", params: examP, res: examInstanceSchema }),
  regenerateExam: route({
    method: "POST",
    path: "/courses/:courseId/exams/:examId/regenerate",
    params: examP,
    res: regenerateResultSchema,
  }),
  examInstance: route({ method: "GET", path: "/exam-instances/:instanceId", params: p({ instanceId: id }), res: examInstanceSchema }),

  attempts: route({ method: "GET", path: "/attempts", res: attemptListSchema }),
  attempt: route({ method: "GET", path: "/attempts/:attemptId", params: attemptP, res: attemptResultSchema }),
  /** Removes the attempt and its answers; queued AI grading for it is cancelled. Lesson completion is kept. */
  deleteAttempt: route({ method: "DELETE", path: "/attempts/:attemptId", params: attemptP, res: z.object({ deleted: z.literal(true) }) }),
  submitAnswer: route({
    method: "POST",
    path: "/attempts/:attemptId/answers/:questionId",
    params: p({ attemptId: id, questionId: id }),
    body: answerInputSchema,
    res: answerResultSchema,
  }),
  finishAttempt: route({ method: "POST", path: "/attempts/:attemptId/finish", params: attemptP, res: attemptResultSchema }),
  reportQuestion: route({
    method: "POST",
    path: "/questions/:questionId/report",
    params: p({ questionId: id }),
    body: reportQuestionSchema,
    res: z.object({ retired: z.literal(true) }),
  }),

  settings: route({ method: "GET", path: "/settings", res: settingsSchema }),
  updateSettings: route({ method: "PUT", path: "/settings", body: updateSettingsSchema, res: settingsSchema }),
  packages: route({ method: "GET", path: "/packages", res: z.object({ packages: z.array(packageInfoSchema) }) }),
  addPackage: route({ method: "POST", path: "/packages", body: addPackageSchema, res: packageInfoSchema }),
} as const;

export type Routes = typeof routes;
export type RouteName = keyof Routes;

type Def = RouteDef<Opt, Opt, Opt, z.ZodType>;
/** true when the route declares that part (its type is a schema, not `undefined`). */
type Has<T> = [Exclude<T, undefined>] extends [never] ? false : true;
type In<T> = T extends z.ZodType ? z.input<T> : never;

/** What a caller passes: `params` / `query` / `body` appear only when the route declares them. */
export type RouteInput<N extends RouteName> = (Has<Routes[N]["params"]> extends true ? { params: In<Exclude<Routes[N]["params"], undefined>> } : unknown) &
  (Has<Routes[N]["query"]> extends true ? { query?: In<Exclude<Routes[N]["query"], undefined>> } : unknown) &
  (Has<Routes[N]["body"]> extends true ? { body: In<Exclude<Routes[N]["body"], undefined>> } : unknown);

export type RouteResponse<N extends RouteName> = z.output<Routes[N]["res"]>;

/** Fills `:param` segments (URI-encoded). */
export function buildPath(path: string, params: Record<string, string> = {}): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, (_, k: string) => {
    const v = params[k];
    if (v === undefined) throw new Error(`missing path param "${k}" for ${path}`);
    return encodeURIComponent(v);
  });
}

export function routeNames(): RouteName[] {
  return Object.keys(routes) as RouteName[];
}

export function routeDef(name: RouteName): Def {
  return routes[name] as unknown as Def;
}
