import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import {
  addPackageSchema,
  jobKindSchema,
  jobResultSubmissionSchema,
  routeDef,
  type Health,
  type RouteName,
  type RouteResponse,
  type Routes,
} from "@selfschool/shared";
import {
  buildAttemptResult,
  finishAttempt,
  listAllAttempts,
  deleteAttempt,
  startQuizAttempt,
  submitAnswer,
  applyGradeResult,
} from "./attempts.js";
import { Catalog } from "./catalog.js";
import { applyChatResult, ask, chatThread, resetChat } from "./chat.js";
import {
  applyLessonResult,
  applyOutlineResult,
  decideExtension,
  extensionBrief,
  generateExtension,
  getExtension,
  listExtensions,
  proposeExtension,
  redraftExtension,
  resumeExtension,
} from "./extensions.js";
import { completeLesson, courseDetail, findLesson, lessonView, listCourses, quizView } from "./courses.js";
import { getCourse, loadCourses, type Ctx, type GitRunner } from "./ctx.js";
import { dashboard } from "./dashboard.js";
import { isMigrated, type Db } from "./db/client.js";
import { jobs } from "./db/schema.js";
import {
  applyGenerateResult,
  applyVerifyResult,
  examInfo,
  instanceView,
  regenerateExam,
  reportQuestion,
  startExam,
} from "./exams.js";
import { claimNextJob, enqueueJob, getJob, submitJobResult, type ResultHooks } from "./jobs.js";
import { addPackage, addPackageZip, insideDir, listPackages, previewPackage, previewPackageZip, runGit, ZIP_LIMITS } from "./packages.js";
import { clearPartial, setPartial } from "./partials.js";
import { listRemoved, removalSummary, removeCourse, removedIds, restoreCourse } from "./removal.js";
import { getModels, settingsView, updateModels } from "./settings.js";
import { HttpError } from "./util.js";

export interface AppOptions {
  /** Max long-poll wait for GET /jobs/next, ms. */
  maxWaitMs?: number;
  pollIntervalMs?: number;
  /** Runner counts as connected if it polled within this window. */
  runnerTtlMs?: number;
  /** Folder holding course packages (default: SELFSCHOOL_COURSES_DIR or <repo>/courses). */
  coursesDir?: string;
  /** App-owned folder with one subfolder per course holding its extension chapters (default: SELFSCHOOL_EXTENSIONS_DIR or <repo>/extensions). */
  extensionsDir?: string;
  /** Prefix under which the browser reaches this api (resource links). Default "/api". */
  publicPrefix?: string;
  /** How often the course folders are re-scanned for edits, ms. Default 2000, or 0 (every request) when a test brings its own courses folder. */
  catalogRecheckMs?: number;
  /** Folder for the catalog's on-disk copy of every course's summary data. Unset = none (tests). */
  catalogCacheDir?: string;
  /** How many courses keep their lesson bodies in memory. Default 8. */
  catalogMaxLoaded?: number;
  git?: GitRunner;
  now?: () => number;
}

export const defaultCoursesDir = () =>
  process.env.SELFSCHOOL_COURSES_DIR || fileURLToPath(new URL("../../../courses", import.meta.url));

export const defaultExtensionsDir = () =>
  process.env.SELFSCHOOL_EXTENSIONS_DIR || fileURLToPath(new URL("../../../extensions", import.meta.url));

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
  });

const MIME: Record<string, string> = {
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".webp": "image/webp", ".pdf": "application/pdf", ".md": "text/markdown; charset=utf-8", ".txt": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
};

type Parsed<T> = T extends { parse(x: unknown): infer O } ? O : never;
type Input<N extends RouteName> = { params: Parsed<Routes[N]["params"]>; body: Parsed<Routes[N]["body"]> };

export function createApp(db: Db, opts: AppOptions = {}) {
  const maxWaitMs = opts.maxWaitMs ?? 30_000;
  const pollIntervalMs = opts.pollIntervalMs ?? 250;
  const runnerTtlMs = opts.runnerTtlMs ?? 60_000;
  const now = opts.now ?? Date.now;
  let runnerLastSeen: number | null = null;
  const seen = () => (runnerLastSeen = now());
  const aiAvailable = () => runnerLastSeen !== null && now() - runnerLastSeen < runnerTtlMs;

  const ctx: Ctx = {
    db,
    catalog: new Catalog({
      coursesDir: opts.coursesDir ?? defaultCoursesDir(),
      // tests that bring their own courses folder get no extensions unless they pass one
      extensionsDir: opts.extensionsDir ?? (opts.coursesDir ? undefined : defaultExtensionsDir()),
      publicPrefix: opts.publicPrefix ?? "/api",
      recheckMs: opts.catalogRecheckMs ?? (opts.coursesDir ? 0 : 3000),
      warmUpInBackground: !opts.coursesDir,
      cacheDir: opts.catalogCacheDir,
      ...(opts.catalogMaxLoaded ? { maxLoadedCourses: opts.catalogMaxLoaded } : {}),
      hidden: () => removedIds(db),
    }),
    now,
    runnerLastSeen: () => runnerLastSeen,
    aiAvailable,
    git: opts.git ?? runGit,
  };
  resetChat(ctx);

  const hooks: ResultHooks = {
    apply(job, result) {
      switch (job.kind) {
        case "grade": return applyGradeResult(ctx, job.id, result as Parameters<typeof applyGradeResult>[2]);
        case "chat": return applyChatResult(ctx, job, result as Parameters<typeof applyChatResult>[2]);
        case "generate": return applyGenerateResult(ctx, job, result as Parameters<typeof applyGenerateResult>[2]);
        case "verify": return applyVerifyResult(ctx, job, result as Parameters<typeof applyVerifyResult>[2]);
        case "outline": return applyOutlineResult(ctx, job, result as Parameters<typeof applyOutlineResult>[2]);
        case "lesson": return applyLessonResult(ctx, job, result as Parameters<typeof applyLessonResult>[2]);
      }
    },
  };

  const app = new Hono();

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
    console.error(err);
    return c.json({ error: "internal error" }, 500);
  });

  /** Registers a contract route: validates params/body, and the response, against the shared schemas. */
  function route<N extends RouteName>(
    name: N,
    handler: (i: Input<N>, signal: AbortSignal) => RouteResponse<N> | Promise<RouteResponse<N>>,
  ) {
    const def = routeDef(name);
    app.on(def.method, def.path, async (c) => {
      const params = def.params ? def.params.safeParse(c.req.param()) : { success: true as const, data: {} };
      if (!params.success) return c.json({ error: "invalid params", issues: params.error.issues }, 400);
      let body: unknown = undefined;
      if (def.body) {
        const parsed = def.body.safeParse(await c.req.json().catch(() => undefined));
        if (!parsed.success) return c.json({ error: "invalid body", issues: parsed.error.issues }, 400);
        body = parsed.data;
      }
      const out = await handler({ params: params.data, body } as Input<N>, c.req.raw.signal);
      const res = def.res.safeParse(out);
      if (!res.success) {
        console.error(`response for ${name} violates the contract`, res.error.issues);
        return c.json({ error: "internal error" }, 500);
      }
      return c.json(res.data);
    });
  }

  // ---------- health + jobs (runner-facing) ----------

  route("health", () => {
    const migrated = isMigrated(db);
    const body: Health = { ok: migrated, migrated, runner: { connected: aiAvailable(), lastSeen: runnerLastSeen } };
    return body;
  });

  // Long-poll: hold the request until a job is pending or ?wait= (seconds) elapses -> 204.
  app.get("/jobs/next", async (c) => {
    seen();
    const waitParam = Number(c.req.query("wait") ?? "0");
    const waitMs = Math.min(Math.max(Number.isFinite(waitParam) ? waitParam * 1000 : 0, 0), maxWaitMs);
    const deadline = Date.now() + waitMs;
    const signal = c.req.raw.signal;
    for (;;) {
      const job = claimNextJob(db);
      if (job) return c.json({ ...job, model: getModels(ctx)[job.kind === "outline" || job.kind === "lesson" ? "generate" : job.kind] });
      if (signal.aborted || Date.now() >= deadline) {
        seen();
        return c.body(null, 204);
      }
      await sleep(Math.min(pollIntervalMs, deadline - Date.now()), signal);
    }
  });

  app.post("/jobs/:id/result", async (c) => {
    seen();
    const body = jobResultSubmissionSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid body", issues: body.error.issues }, 400);
    const outcome = submitJobResult(db, c.req.param("id"), body.data, now(), hooks);
    clearPartial(c.req.param("id"));
    return c.json(outcome);
  });

  /** Progress from the runner: the chat answer written so far. Ignored unless the job is a running chat job. */
  app.post("/jobs/:id/partial", async (c) => {
    seen();
    const body = (await c.req.json().catch(() => null)) as { text?: unknown } | null;
    if (typeof body?.text !== "string" || body.text.length > 20_000) return c.json({ error: "invalid body" }, 400);
    const job = getJob(db, c.req.param("id"));
    if (job?.status === "running" && job.kind === "chat") setPartial(job.id, body.text, now());
    return c.body(null, 204);
  });

  // Raw enqueue (tests, tooling). Payloads are validated per kind.
  app.post("/jobs", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { kind?: unknown; payload?: unknown } | null;
    const kind = jobKindSchema.safeParse(body?.kind);
    if (!kind.success) return c.json({ error: "invalid kind" }, 400);
    return c.json({ id: enqueueJob(db, kind.data, body?.payload) }, 201);
  });

  // After /jobs/next, which it would otherwise shadow.
  route("job", ({ params }) => {
    const j = getJob(db, params.id);
    if (!j) throw new HttpError(404, "no such job");
    return { id: j.id, kind: j.kind, status: j.status, error: j.error };
  });

  // ---------- courses, lessons, dashboard ----------

  route("dashboard", () => dashboard(ctx));
  route("courses", () => ({ courses: listCourses(ctx) }));
  route("course", ({ params }) => courseDetail(ctx, params.courseId));
  route("proposeExtension", ({ params, body }) => proposeExtension(ctx, params.courseId, body));
  route("extensions", ({ params }) => ({ extensions: listExtensions(ctx, params.courseId) }));
  route("extension", ({ params }) => getExtension(ctx, params.extensionId));
  route("redraftExtension", ({ params, body }) => redraftExtension(ctx, params.extensionId, body.budgetMinutes));
  route("extensionBrief", ({ params }) => extensionBrief(ctx, params.extensionId));
  route("generateExtension", ({ params }) => generateExtension(ctx, params.extensionId));
  route("resumeExtension", ({ params }) => resumeExtension(ctx, params.extensionId));
  route("decideExtension", ({ params, body }) => decideExtension(ctx, params.extensionId, body));
  route("lesson", ({ params }) => lessonView(ctx, params.courseId, params.lessonId));
  route("completeLesson", ({ params }) => completeLesson(ctx, params.courseId, params.lessonId));

  route("chat", ({ params }) => {
    const course = getCourse(ctx, params.courseId);
    return chatThread(ctx, course, findLesson(course, params.lessonId));
  });
  route("ask", ({ params, body }) => {
    const course = getCourse(ctx, params.courseId);
    return ask(ctx, course, findLesson(course, params.lessonId), body);
  });

  // ---------- quizzes, exams, attempts ----------

  route("quiz", ({ params }) => quizView(ctx, params.courseId, params.quizId));
  route("startQuizAttempt", ({ params }) => ({ attemptId: startQuizAttempt(ctx, params.courseId, params.quizId) }));
  route("exam", ({ params }) => examInfo(ctx, params.courseId, params.examId));
  route("startExam", ({ params }) => startExam(ctx, params.courseId, params.examId));
  route("regenerateExam", ({ params }) => regenerateExam(ctx, params.courseId, params.examId));
  route("examInstance", ({ params }) => instanceView(ctx, params.instanceId));
  route("attempts", () => listAllAttempts(ctx));
  route("attempt", ({ params }) => buildAttemptResult(ctx, params.attemptId));
  route("deleteAttempt", ({ params }) => deleteAttempt(ctx, params.attemptId));
  route("submitAnswer", ({ params, body }) => submitAnswer(ctx, params.attemptId, params.questionId, body));
  route("finishAttempt", ({ params }) => finishAttempt(ctx, params.attemptId));
  route("reportQuestion", ({ params, body }) => {
    reportQuestion(ctx, params.questionId, body.reason);
    return { retired: true as const };
  });

  // ---------- settings + packages ----------

  route("settings", () => settingsView(ctx));
  route("updateSettings", ({ body }) => {
    updateModels(ctx, body.models);
    return settingsView(ctx);
  });
  route("packages", () => ({ packages: listPackages(ctx) }));
  route("addPackage", ({ body }) => addPackage(ctx, body));
  // Removing a course: the confirm popup reads the summary, then DELETE does it (see removal.ts).
  app.get("/packages/removed", (c) => c.json({ courses: listRemoved(ctx) }));
  app.post("/packages/:id/restore", (c) => c.json(restoreCourse(ctx, c.req.param("id"))));
  app.get("/packages/:id/removal", (c) => c.json(removalSummary(ctx, c.req.param("id"))));
  app.delete("/packages/:id", (c) => c.json(removeCourse(ctx, c.req.param("id"))));
  // Dry run of the above for the add popup: same fetch and checks, nothing installed.
  app.post("/packages/preview", async (c) => {
    const body = addPackageSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid body" }, 400);
    return c.json(await previewPackage(ctx, body.data));
  });
  // Course zips: the raw zip is the request body, its file name the `name` query. `preview` is a dry run.
  const zipBody = bodyLimit({
    maxSize: ZIP_LIMITS.zipBytes,
    onError: (c) => c.json({ error: "the zip is larger than 50 MB" }, 413),
  });
  app.post("/packages/upload/preview", zipBody, async (c) =>
    c.json(previewPackageZip(ctx, new Uint8Array(await c.req.arrayBuffer()), c.req.query("name") ?? "course.zip")),
  );
  app.post("/packages/upload", zipBody, async (c) =>
    c.json(addPackageZip(ctx, new Uint8Array(await c.req.arrayBuffer()), c.req.query("name") ?? "course.zip")),
  );

  // ---------- course files (resources/ only, never answer keys) ----------

  // A consistent copy of the whole progress database (a SQLite file), for the Settings "Export backup" button.
  app.get("/backup", (c) => {
    const bytes = ctx.db.$client.serialize();
    const day = new Date(now()).toISOString().slice(0, 10);
    return c.body(new Uint8Array(bytes), 200, {
      "content-type": "application/vnd.sqlite3",
      "content-disposition": `attachment; filename="selfschool-backup-${day}.sqlite"`,
      "cache-control": "no-store",
    });
  });

  app.get("/courses/:courseId/files/*", (c) => {
    const course = loadCourses(ctx).find((x) => x.id === c.req.param("courseId"));
    if (!course) return c.json({ error: "course not found" }, 404);
    const prefix = `/courses/${c.req.param("courseId")}/files/`;
    const rel = decodeURIComponent(new URL(c.req.url).pathname.split(prefix)[1] ?? "");
    // the package first, then the extensions folder; only a resources/ folder is ever served
    const root = [course.dir, course.overlayDir].find((base) => {
      if (!base || !rel) return false;
      const target = resolve(join(base, rel));
      const resourcesDir = resolve(join(base, "resources"));
      return insideDir(resourcesDir, target) && existsSync(target);
    });
    if (!root) return c.json({ error: "not found" }, 404);
    const target = resolve(join(root, rel));
    const resourcesDir = resolve(join(root, "resources"));
    if (lstatSync(target).isSymbolicLink() || !lstatSync(target).isFile()) return c.json({ error: "not found" }, 404);
    if (!insideDir(realpathSync(resourcesDir), realpathSync(target))) return c.json({ error: "not found" }, 404);
    const type = MIME[extname(target).toLowerCase()] ?? "application/octet-stream";
    // A short cache plus a validator: the browser reuses the image for a minute, then asks and gets a 304 with no body.
    const st = lstatSync(target);
    const etag = `W/"${st.size.toString(16)}-${Math.round(st.mtimeMs).toString(16)}"`;
    const headers = {
      etag,
      "cache-control": "private, max-age=60",
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox",
    };
    if (c.req.header("if-none-match") === etag) return c.body(null, 304, headers);
    return c.body(readFileSync(target), 200, { ...headers, "content-type": type });
  });

  return app;
}
