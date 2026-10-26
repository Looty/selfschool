import { z } from "zod";

/** Highest `schemaVersion` this build understands; newer packages are rejected loudly. */
export const SCHEMA_VERSION = 1;

const slug = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/, "use lowercase letters, digits and dashes");

/**
 * A new course id: the title as a slug plus 6 random base36 characters ("python-basics-k3x9f2"). Progress is keyed
 * by course id, so ids must not clash between courses you write and courses you import. The suffix makes a clash
 * practically impossible. An id never changes after the first publish.
 */
export function newCourseId(title: string): string {
  const base = title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "") || "course";
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(6));
  const suffix = Array.from(bytes, (b) => (b % 36).toString(36)).join("");
  return `${base}-${suffix}`;
}

// ---------- course.yaml ----------

/** `researched` = written with real sources (the authoring skill or deep research); `quick` = written in-app from model knowledge. */
export const chapterOriginSchema = z.enum(["researched", "quick"]);
export type ChapterOrigin = z.infer<typeof chapterOriginSchema>;

export const chapterRefSchema = z.object({
  dir: z.string().min(1),
  title: z.string().min(1),
  /** 1 = the core course; 2 and up are extensions, never counted in the core percent or time. */
  level: z.number().int().min(1).default(1),
  origin: chapterOriginSchema.default("researched"),
});

/**
 * `extension.yaml` in an app-owned overlay folder: chapters that extend a course without touching its package.
 * Ids (lessons, quizzes, questions) start with `x` and source numbers start at `EXTENSION_SOURCE_BASE`, so
 * they can never collide with what the package author adds later.
 */
export const overlayManifestSchema = z.object({
  schemaVersion: z.literal(1),
  chapters: z.array(chapterRefSchema.extend({ level: z.number().int().min(2).default(2) })).min(1),
});
export type OverlayManifest = z.infer<typeof overlayManifestSchema>;
export const EXTENSION_ID_PREFIX = "x";
export const EXTENSION_SOURCE_BASE = 101;

export const examRefSchema = z.object({
  id: slug,
  file: z.string().min(1),
  after: z.string().min(1).optional(),
});

export const courseManifestSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: slug,
  title: z.string().min(1),
  short_intro: z.string().min(1),
  description: z.string().default(""),
  /** Language the course is written in (two-letter code, e.g. "en"); translations live in `i18n/<language>/` (translation.ts). */
  language: z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, "use a language code such as en or he").default("en"),
  level: z.string().min(1),
  /** Course color; default is derived from the id by the app. */
  hue: z.enum(["blue", "orange", "teal", "pink"]).optional(),
  /** 2-4 letter monogram shown on covers and bands (e.g. "TS"); default is the title's initials. */
  monogram: z.string().min(1).max(4).optional(),
  tags: z.array(z.string()).default([]),
  /** Target depth in learner minutes: a hint for deep authoring, a cap for quick generation. */
  budget_minutes: z.number().int().positive().optional(),
  chapters: z.array(chapterRefSchema).min(1),
  exams: z.array(examRefSchema).default([]),
});
export type CourseManifest = z.infer<typeof courseManifestSchema>;

// ---------- lesson frontmatter ----------

export const lessonFrontmatterSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  quiz: z.string().optional(),
  resources: z.array(z.string()).default([]),
  /** Numbers refer to entries in sources.md; `none` is an explicit opt-out. */
  sources: z.union([z.literal("none"), z.array(z.number().int().positive()).min(1)]),
});
export type LessonFrontmatter = z.infer<typeof lessonFrontmatterSchema>;

// ---------- quiz ----------

const questionBase = {
  id: z.string().min(1),
  text: z.string().min(1),
  code: z.string().optional(),
  concepts: z.array(z.string()).default([]),
  sources: z.array(z.number().int().positive()).default([]),
};

export const mcqOptionSchema = z.object({
  text: z.string().min(1),
  correct: z.boolean(),
  explanation: z.string().min(1),
});

/** Pick the right option (or every right option). Where to use it: `QUESTION_TYPE_INFO.mcq` in questionTypes.ts. */
export const mcqQuestionSchema = z.object({
  ...questionBase,
  type: z.literal("mcq"),
  options: z
    .array(mcqOptionSchema)
    .min(2)
    .refine((o) => o.some((x) => x.correct), "at least one option must be correct"),
});

/** Type a short answer, matched loosely. Where to use it: `QUESTION_TYPE_INFO.short` in questionTypes.ts. */
export const shortQuestionSchema = z.object({
  ...questionBase,
  type: z.literal("short"),
  answers: z.array(z.string().min(1)).min(1),
});

/** Write an answer in own words, graded by the runner against `rubric`. Where to use it: `QUESTION_TYPE_INFO.open` in questionTypes.ts. */
export const openQuestionSchema = z.object({
  ...questionBase,
  type: z.literal("open"),
  rubric: z.string().min(1),
});

/** Most slots one fill question may have; past this it turns into a typing test. */
export const FILL_MAX_SLOTS = 8;
export const FILL_SLOT = /\{\{(\d+)\}\}/g;

export const fillChipSchema = z.object({
  text: z.string().min(1),
  /** The slot (1-based) this chip belongs in; omit for a distractor. */
  slot: z.number().int().positive().optional(),
  explanation: z.string().min(1),
});

/**
 * Drag chips into numbered slots in `template` (`{{1}}`, `{{2}}`, ...). A template of nothing but slots is an
 * ordering question. Every chip, right or wrong, carries an explanation.
 * Where to use it: `QUESTION_TYPE_INFO.fill` in questionTypes.ts.
 */
export const fillQuestionSchema = z
  .object({
    ...questionBase,
    type: z.literal("fill"),
    template: z.string().min(1),
    chips: z.array(fillChipSchema).min(1),
  })
  .superRefine((q, ctx) => {
    const slots = [...q.template.matchAll(FILL_SLOT)].map((m) => Number(m[1]));
    const n = slots.length;
    const bad = (message: string) => ctx.addIssue({ code: "custom", message });
    if (n === 0 || n > FILL_MAX_SLOTS) return bad(`template needs 1 to ${FILL_MAX_SLOTS} slots written {{1}}, {{2}}, ...`);
    if (slots.some((s, i) => s !== i + 1)) return bad("slots must be numbered {{1}}, {{2}}, ... in order, each once");
    for (let s = 1; s <= n; s++) {
      if (q.chips.filter((c) => c.slot === s).length !== 1) return bad(`slot ${s} needs exactly one chip with slot: ${s}`);
    }
    if (q.chips.some((c) => c.slot !== undefined && c.slot > n)) return bad("a chip points at a slot that is not in the template");
  });

export const SORT_MAX_BUCKETS = 6;
export const SORT_MAX_ITEMS = 12;

/**
 * Drag each item into the bucket it belongs to; several items may share a bucket. Every item carries an explanation.
 * Where to use it: `QUESTION_TYPE_INFO.sort` in questionTypes.ts.
 */
export const sortQuestionSchema = z
  .object({
    ...questionBase,
    type: z.literal("sort"),
    buckets: z.array(z.string().min(1)).min(2).max(SORT_MAX_BUCKETS),
    items: z
      .array(z.object({ text: z.string().min(1), bucket: z.string().min(1), explanation: z.string().min(1) }))
      .min(2)
      .max(SORT_MAX_ITEMS),
  })
  .superRefine((q, ctx) => {
    if (new Set(q.buckets).size !== q.buckets.length) ctx.addIssue({ code: "custom", message: "bucket names must be unique" });
    for (const it of q.items) {
      if (!q.buckets.includes(it.bucket)) ctx.addIssue({ code: "custom", message: `item "${it.text}" names a bucket that is not in buckets: "${it.bucket}"` });
    }
  });

/**
 * Click the line(s) of `code` that answer the question. `correct` holds 1-based line numbers.
 * Where to use it: `QUESTION_TYPE_INFO.spot` in questionTypes.ts.
 */
export const spotQuestionSchema = z
  .object({
    ...questionBase,
    type: z.literal("spot"),
    code: z.string().min(1),
    /** Show `code` as a diff: lines starting with `+` or `-` are drawn as added or removed. Selection works the same. */
    diff: z.boolean().default(false),
    correct: z.array(z.number().int().positive()).min(1),
    explanation: z.string().min(1),
  })
  .superRefine((q, ctx) => {
    const lines = q.code.replace(/\n+$/, "").split("\n").length;
    if (new Set(q.correct).size !== q.correct.length) ctx.addIssue({ code: "custom", message: "correct lines must be unique" });
    if (q.correct.some((n) => n > lines)) ctx.addIssue({ code: "custom", message: `correct names a line past the end of the code (${lines} lines)` });
  });

// ---------- hotspot ----------

/** Percent of the image, 0 to 100 from the top left, so a region survives the image being shown at any size. */
const pct = z.number().min(0).max(100);
const regionFields = { name: z.string().min(1), correct: z.boolean().default(false), explanation: z.string().min(1) };

export const rectRegionSchema = z.object({ ...regionFields, shape: z.literal("rect"), x: pct, y: pct, w: pct, h: pct });
export const ellipseRegionSchema = z.object({ ...regionFields, shape: z.literal("ellipse"), x: pct, y: pct, rx: pct, ry: pct });
export const polyRegionSchema = z.object({ ...regionFields, shape: z.literal("poly"), points: z.array(z.tuple([pct, pct])).min(3) });
export const hotspotRegionSchema = z.discriminatedUnion("shape", [rectRegionSchema, ellipseRegionSchema, polyRegionSchema]);
export type HotspotRegion = z.infer<typeof hotspotRegionSchema>;

/**
 * Click the right place on an image: a diagram, screenshot, chart, map. The image is a file under `resources/`.
 * `regions` mark where the answer is (and decoys with their own explanation). More than one `correct` region means
 * the learner places that many markers; a marker counts when it lands inside a correct region.
 * Where to use it: `QUESTION_TYPE_INFO.hotspot` in questionTypes.ts.
 */
export const hotspotQuestionSchema = z
  .object({
    ...questionBase,
    type: z.literal("hotspot"),
    image: z.string().regex(/^resources\/.+\.(svg|png|jpe?g|gif|webp)$/i, "image must be a file under resources/ (svg, png, jpg, gif, webp)"),
    alt: z.string().min(1),
    regions: z.array(hotspotRegionSchema).min(1),
  })
  .superRefine((q, ctx) => {
    if (!q.regions.some((r) => r.correct)) ctx.addIssue({ code: "custom", message: "at least one region must be correct" });
    if (new Set(q.regions.map((r) => r.name)).size !== q.regions.length) ctx.addIssue({ code: "custom", message: "region names must be unique" });
  });

export const MATCH_MAX_PAIRS = 8;
export const MATCH_MAX_DISTRACTORS = 4;

/**
 * Connect each item on the left to its partner on the right. `distractors` are extra right-hand items that
 * belong to nothing. Every pair carries an explanation.
 * Where to use it: `QUESTION_TYPE_INFO.match` in questionTypes.ts.
 */
export const matchQuestionSchema = z
  .object({
    ...questionBase,
    type: z.literal("match"),
    pairs: z
      .array(z.object({ left: z.string().min(1), right: z.string().min(1), explanation: z.string().min(1) }))
      .min(2)
      .max(MATCH_MAX_PAIRS),
    distractors: z.array(z.string().min(1)).max(MATCH_MAX_DISTRACTORS).default([]),
  })
  .superRefine((q, ctx) => {
    const lefts = q.pairs.map((p) => p.left);
    const rights = [...q.pairs.map((p) => p.right), ...q.distractors];
    if (new Set(lefts).size !== lefts.length) ctx.addIssue({ code: "custom", message: "left items must be unique" });
    if (new Set(rights).size !== rights.length) ctx.addIssue({ code: "custom", message: "right items (including distractors) must be unique" });
  });

export const TRACE_MAX_VARIABLES = 5;
export const TRACE_MAX_STEPS = 8;

/** YAML turns `a: 1` into a number; values are compared as text, so numbers and booleans are read as their text. */
const traceText = z.preprocess((v) => (typeof v === "number" || typeof v === "boolean" ? String(v) : v), z.string().min(1));

/**
 * Fill in what each variable holds after each step of `code`. A cell's value may list several accepted spellings
 * (the first is shown as the answer). `given` cells are shown pre-filled; everything else is typed and graded.
 * Where to use it: `QUESTION_TYPE_INFO.trace` in questionTypes.ts.
 */
export const traceQuestionSchema = z
  .object({
    ...questionBase,
    type: z.literal("trace"),
    code: z.string().min(1),
    variables: z.array(z.string().min(1)).min(1).max(TRACE_MAX_VARIABLES),
    steps: z
      .array(
        z.object({
          label: z.string().min(1),
          values: z.record(z.string(), z.union([traceText, z.array(traceText).min(1)])),
          given: z.array(z.string()).default([]),
        }),
      )
      .min(1)
      .max(TRACE_MAX_STEPS),
    explanation: z.string().min(1),
  })
  .superRefine((q, ctx) => {
    const vars = new Set(q.variables);
    if (vars.size !== q.variables.length) ctx.addIssue({ code: "custom", message: "variable names must be unique" });
    let graded = 0;
    for (const s of q.steps) {
      const keys = Object.keys(s.values);
      if (keys.length !== vars.size || keys.some((k) => !vars.has(k))) ctx.addIssue({ code: "custom", message: `step "${s.label}" must give a value for exactly: ${q.variables.join(", ")}` });
      if (s.given.some((g) => !vars.has(g))) ctx.addIssue({ code: "custom", message: `step "${s.label}" gives a cell for a variable that is not listed` });
      graded += q.variables.length - new Set(s.given).size;
    }
    if (graded === 0) ctx.addIssue({ code: "custom", message: "at least one cell must be left for the learner to fill in" });
  });

export const questionSchema = z.discriminatedUnion("type", [
  mcqQuestionSchema,
  shortQuestionSchema,
  openQuestionSchema,
  fillQuestionSchema,
  sortQuestionSchema,
  spotQuestionSchema,
  hotspotQuestionSchema,
  matchQuestionSchema,
  traceQuestionSchema,
]);
export type Question = z.infer<typeof questionSchema>;
export type QuestionType = Question["type"];

export const quizSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  /** 0 = unlimited */
  max_attempts: z.number().int().min(0).default(0),
  passing_percentage: z.number().min(0).max(100).default(70),
  show_answers: z.boolean().default(true),
  shuffle: z.boolean().default(false),
  questions: z.array(questionSchema).min(1),
});
export type Quiz = z.infer<typeof quizSchema>;

// ---------- exam blueprint ----------

export const examBlueprintSchema = z.object({
  id: slug,
  title: z.string().min(1),
  schemaVersion: z.literal(1).default(1),
  duration_minutes: z.number().int().positive(),
  /** 0 = unlimited */
  max_attempts: z.number().int().min(0).default(0),
  passing_percentage: z.number().min(0).max(100).default(70),
  shuffle: z.boolean().default(true),
  /** Questions drawn per exam instance. */
  limit_questions: z.number().int().positive(),
  /** Relative weights per domain (e.g. cert exam-guide domains); the draw is proportional. */
  domains: z
    .array(
      z.object({
        id: slug,
        title: z.string().min(1),
        weight: z.number().positive(),
        /** Bank questions from these chapters' quizzes. */
        chapters: z.array(z.string()).default([]),
        /** Optional extra filter / generation targets. */
        concepts: z.array(z.string()).default([]),
      }),
    )
    .min(1),
});
export type ExamBlueprint = z.infer<typeof examBlueprintSchema>;
