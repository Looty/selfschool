import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { lstat, readdir, readFile } from "node:fs/promises";
import { basename, join, posix, relative } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  EXTENSION_ID_PREFIX,
  EXTENSION_SOURCE_BASE,
  examBlueprintSchema,
  lessonFrontmatterSchema,
  lessonMinutes,
  overlayManifestSchema,
  quizSchema,
  type ChapterOrigin,
  type CourseManifest,
  type CourseRef,
  type ExamBlueprint,
  type Question,
  type Quiz,
} from "@selfschool/shared";
import { splitFrontmatter, validateCoursePackage } from "@selfschool/shared/node";
import { DiskCache, fingerprintHash, type CacheRecord, type CourseMeta } from "./catalogCache.js";
import { hueFor, monogramFor, sha256 } from "./util.js";

export interface LoadedSource {
  n: number;
  title: string;
  url?: string;
  note?: string;
}

export interface LoadedLesson {
  id: string;
  title: string;
  chapterDir: string;
  chapterTitle: string;
  /** 1 = core course; 2 and up are extensions. */
  level: number;
  origin: ChapterOrigin;
  /** 0-based position among all lessons of the course. */
  index: number;
  /** Markdown body (frontmatter removed), relative links rewritten to the files endpoint. */
  body: string;
  hash: string;
  minutes: number;
  quizId: string | null;
  sourceNumbers: number[];
  resources: { name: string; url: string }[];
}

export interface LoadedQuiz {
  quiz: Quiz;
  lessonId: string;
  chapterDir: string;
}

export interface LoadedExam {
  id: string;
  after: string | null;
  blueprint: ExamBlueprint;
}

/** Just enough about a lesson to list it, count it and estimate its time. No body. */
export interface LightLesson {
  id: string;
  title: string;
  chapterDir: string;
  chapterTitle: string;
  level: number;
  origin: ChapterOrigin;
  index: number;
  minutes: number;
  quizId: string | null;
}

/**
 * What the course list, dashboard and outline need, without the lesson bodies. Summaries must read this and never
 * `lessons` / `quizzes`, so that a course can stay unloaded until someone opens it.
 */
export interface CourseLight {
  lessons: LightLesson[];
  /** Questions of each quiz by quiz id (used for time estimates and question counts). */
  quizQuestions: Map<string, Question[]>;
  /** Number of entries in sources.md, extension sources included (same as `sources.length`). */
  sourceCount: number;
}

export const lightOf = (lessons: LoadedLesson[], quizzes: Map<string, LoadedQuiz>, sourceCount: number): CourseLight => ({
  sourceCount,
  lessons: lessons.map(({ id, title, chapterDir, chapterTitle, level, origin, index, minutes, quizId }) => ({ id, title, chapterDir, chapterTitle, level, origin, index, minutes, quizId })),
  quizQuestions: new Map([...quizzes].map(([id, q]) => [id, q.quiz.questions])),
});

export interface LoadedCourse {
  id: string;
  dir: string;
  dirName: string;
  /** App-owned folder whose chapters were merged in as extensions; absent when there is none. */
  overlayDir?: string;
  manifest: CourseManifest;
  ref: CourseRef;
  lessons: LoadedLesson[];
  lessonById: Map<string, LoadedLesson>;
  quizzes: Map<string, LoadedQuiz>;
  /** Always cheap to read (see CourseLight). */
  light: CourseLight;
  exams: LoadedExam[];
  sourcesMd: string;
  sources: LoadedSource[];
  /** Hash of every file in the package; changes whenever anything does. */
  contentHash: string;
}

export interface CatalogOptions {
  coursesDir: string;
  /** App-owned folder with one subfolder per course id holding its extension chapters. Unset = no extensions. */
  extensionsDir?: string | undefined;
  /** URL prefix the browser reaches the api under (resource links). */
  publicPrefix?: string;
  /**
   * Walking every file to detect edits is slow on a bind-mounted folder, so the check runs at most this often
   * (ms). 0 = on every call. The app's own writers call `invalidate()` to force the next check.
   */
  recheckMs?: number;
  /**
   * Read the library in the background on the first call instead of blocking it (the app serves the courses read so far
   * while a large library fills in). Off by default, so tests and one-off tools get everything on the first call.
   */
  warmUpInBackground?: boolean;
  /** Ids of courses the user removed from the app; their files stay where they are but they are not served. */
  hidden?: () => ReadonlySet<string>;
  /** How many courses keep their lesson bodies, quizzes and sources in memory (the most recently opened). Default 8. */
  maxLoadedCourses?: number;
  /**
   * Folder for the on-disk copy of every course's light part (see catalogCache.ts), so a restart only re-reads the
   * courses whose files changed. Unset = no disk cache (what tests get unless they ask for it).
   */
  cacheDir?: string | undefined;
  /** No `load()` for this long (ms) counts as idle: the next background check then waits `idleRecheckMs`. Default 15000. */
  idleAfterMs?: number;
  /** Wait between background checks while idle, ms. Default 30000. */
  idleRecheckMs?: number;
}

const SKIP_DIRS = new Set([".git", "node_modules"]);

/** Every regular file under dir (symlinks are skipped, never followed). */
export function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      if (SKIP_DIRS.has(name)) continue;
      const p = join(d, name);
      const st = lstatSync(p);
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) walk(p);
      else if (st.isFile()) out.push(p);
    }
  };
  walk(dir);
  return out;
}

/** Same files as `listFiles`, found with parallel async reads: much faster on a bind-mounted folder, and the event loop stays free. */
export async function listFilesAsync(dir: string): Promise<string[]> {
  const walk = async (d: string): Promise<string[]> => {
    const names = (await readdir(d)).filter((n) => !SKIP_DIRS.has(n)).sort();
    const nested = await Promise.all(
      names.map(async (name) => {
        const p = join(d, name);
        const st = await lstat(p);
        if (st.isSymbolicLink()) return [];
        if (st.isDirectory()) return walk(p);
        return st.isFile() ? [p] : [];
      }),
    );
    return nested.flat();
  };
  return walk(dir);
}

export function parseSources(md: string): LoadedSource[] {
  const out: LoadedSource[] = [];
  const lines = md.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*(\d+)\.\s+(.*)$/.exec(lines[i]!);
    if (!m) continue;
    const n = Number(m[1]);
    const rest = m[2]!;
    const link = /^\[(.+?)\]\((.+?)\)/.exec(rest);
    const src: LoadedSource = link
      ? { n, title: link[1]!, url: link[2]! }
      : { n, title: rest.split(" · ")[0]!.trim() || `Source ${n}` };
    const next = lines[i + 1] ?? "";
    const note = /^\s+-\s+Notes?:\s*(.*)$/i.exec(next);
    if (note) src.note = note[1]!.trim();
    out.push(src);
  }
  return out;
}

const REWRITE_EXT = /\.(svg|png|jpe?g|gif|webp|pdf|md|txt|csv|xlsx|docx)$/i;

/** Rewrites relative file links (`](../resources/x.svg)`) to the course files endpoint. */
export function rewriteLinks(body: string, courseId: string, chapterDir: string, prefix: string): string {
  return body.replace(/\]\(([^)\s]+)\)/g, (whole, target: string) => {
    if (/^([a-z][a-z0-9+.-]*:|#|\/)/i.test(target) || !REWRITE_EXT.test(target.split("#")[0]!)) return whole;
    const resolved = posix.normalize(posix.join(chapterDir, target));
    if (resolved.startsWith("..")) return whole;
    return `](${resourceUrl(prefix, courseId, resolved)})`;
  });
}

export const resourceUrl = (prefix: string, courseId: string, relPath: string) =>
  `${prefix}/courses/${encodeURIComponent(courseId)}/files/${relPath.split("/").map(encodeURIComponent).join("/")}`;

type ChapterRef = CourseManifest["chapters"][number];

/** Reads a file as text. The loader reads each file of a package through one of these, so it touches the disk once. */
type Reader = (path: string) => string;
type Warn = (message: string) => void;

/** A reader that remembers what it has read. Pre-fill `memo` (see `prefetch`) to read a package without blocking. */
const memoReader =
  (memo: Map<string, string>): Reader =>
  (path) => {
    let text = memo.get(path);
    if (text === undefined) {
      text = readFileSync(path, "utf8");
      memo.set(path, text);
    }
    return text;
  };

/** Reads files into `memo` asynchronously, a few at a time. A file that cannot be read is left for the sync reader to report. */
async function prefetch(files: string[], memo: Map<string, string>, limit = 16): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < files.length) {
      const f = files[next++]!;
      try {
        memo.set(f, await readFile(f, "utf8"));
      } catch {
        /* the sync reader will throw the same error where it matters */
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, files.length) }, worker));
}

interface ChapterSink {
  lessons: LoadedLesson[];
  quizzes: Map<string, LoadedQuiz>;
}

/**
 * Reads one chapter's lessons and quizzes into the sink. A core package is already validated; for an overlay,
 * `accept` may veto a lesson (returns why), and a lesson that fails to parse is skipped with a warning.
 */
function readChapter(
  base: string,
  chapter: ChapterRef,
  courseId: string,
  prefix: string,
  sink: ChapterSink,
  rd: Reader,
  warn: Warn,
  accept?: (id: string, quiz: Quiz | null) => string | null,
): void {
  const chapterDir = join(base, chapter.dir);
  const files = readdirSync(chapterDir).sort();
  for (const f of files.filter((n) => /^lesson-.*\.md$/.test(n))) {
    try {
      const raw = rd(join(chapterDir, f));
      const fm = splitFrontmatter(raw);
      const parsed = fm ? lessonFrontmatterSchema.parse(fm.data) : null;
      if (!fm || !parsed) continue;
      const quiz = parsed.quiz ? quizSchema.parse(parseYaml(rd(join(chapterDir, parsed.quiz)))) : null;
      const veto = accept?.(parsed.id, quiz);
      if (veto) {
        warn(`[catalog] skipping ${chapter.dir}/${f}: ${veto}`);
        continue;
      }
      if (quiz) sink.quizzes.set(quiz.id, { quiz, lessonId: parsed.id, chapterDir: chapter.dir });
      const resources = parsed.resources.map((r) => {
        const rel = posix.normalize(posix.join(chapter.dir, r));
        return { name: posix.basename(r), url: resourceUrl(prefix, courseId, rel) };
      });
      sink.lessons.push({
        id: parsed.id,
        title: parsed.title,
        chapterDir: chapter.dir,
        chapterTitle: chapter.title,
        level: chapter.level,
        origin: chapter.origin,
        index: sink.lessons.length,
        body: rewriteLinks(fm.body.trim(), courseId, chapter.dir, prefix),
        hash: sha256(raw.replace(/\r\n/g, "\n")),
        minutes: lessonMinutes(fm.body),
        quizId: quiz?.id ?? null,
        sourceNumbers: parsed.sources === "none" ? [] : parsed.sources,
        resources,
      });
    } catch (err) {
      if (!accept) throw err;
      warn(`[catalog] skipping ${chapter.dir}/${f}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/**
 * Adds an app-owned overlay (`extension.yaml`, `sources.md`, chapter folders) after the core chapters. The overlay
 * never touches the package: its ids must start with `x` and its source numbers with `EXTENSION_SOURCE_BASE`, which
 * keeps them clear of anything the package author adds later. Anything that breaks those rules is skipped and logged.
 */
function applyOverlay(
  core: CourseData,
  id: string,
  overlayDir: string,
  prefix: string,
  rd: Reader,
  warn: Warn,
  files?: string[],
): { data: CourseData; overlayHash: () => string } | null {
  const manifestFile = join(overlayDir, "extension.yaml");
  if (!existsSync(manifestFile)) return null;
  const parsed = overlayManifestSchema.safeParse(parseYaml(rd(manifestFile)));
  if (!parsed.success) {
    warn(`[catalog] ignoring ${overlayDir}: extension.yaml: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
    return null;
  }

  const sink: ChapterSink = { lessons: [...core.lessons], quizzes: new Map(core.quizzes) };
  const lessonIds = new Set(core.lessons.map((l) => l.id));
  const questionIds = new Set([...core.quizzes.values()].flatMap((q) => q.quiz.questions.map((x) => x.id)));
  const coreDirs = new Set(core.manifest.chapters.map((c) => c.dir));
  const chapters: ChapterRef[] = [];

  const mine = (id: string) => id.startsWith(EXTENSION_ID_PREFIX);
  const accept = (id: string, quiz: Quiz | null): string | null => {
    if (!mine(id) || lessonIds.has(id)) return `lesson id "${id}" must be new and start with "${EXTENSION_ID_PREFIX}"`;
    if (quiz) {
      if (!mine(quiz.id) || sink.quizzes.has(quiz.id)) return `quiz id "${quiz.id}" must be new and start with "${EXTENSION_ID_PREFIX}"`;
      const bad = quiz.questions.find((q) => !mine(q.id) || questionIds.has(q.id));
      if (bad) return `question id "${bad.id}" must be new and start with "${EXTENSION_ID_PREFIX}"`;
      quiz.questions.forEach((q) => questionIds.add(q.id));
    }
    lessonIds.add(id);
    return null;
  };

  for (const chapter of parsed.data.chapters) {
    if (coreDirs.has(chapter.dir) || !existsSync(join(overlayDir, chapter.dir))) {
      warn(`[catalog] skipping extension chapter ${chapter.dir}: folder missing or same name as a core chapter`);
      continue;
    }
    readChapter(overlayDir, chapter, id, prefix, sink, rd, warn, accept);
    if (sink.lessons.some((l) => l.chapterDir === chapter.dir)) chapters.push(chapter);
  }
  if (!chapters.length) return null;

  const coreNumbers = new Set(core.sources.map((s) => s.n));
  const overlaySourcesMd = existsSync(join(overlayDir, "sources.md")) ? rd(join(overlayDir, "sources.md")) : "";
  const sources = parseSources(overlaySourcesMd).filter((s) => {
    const ok = s.n >= EXTENSION_SOURCE_BASE && !coreNumbers.has(s.n);
    if (!ok) warn(`[catalog] ignoring extension source ${s.n}: extension sources start at ${EXTENSION_SOURCE_BASE}`);
    return ok;
  });

  return {
    data: {
      manifest: { ...core.manifest, chapters: [...core.manifest.chapters, ...chapters] },
      lessons: sink.lessons,
      quizzes: sink.quizzes,
      sourcesMd: overlaySourcesMd ? `${core.sourcesMd.trimEnd()}\n\n${overlaySourcesMd}` : core.sourcesMd,
      sources: [...core.sources, ...sources],
    },
    overlayHash: () => dirHash(overlayDir, rd, files),
  };
}

const dirHash = (dir: string, rd: Reader, files = listFiles(dir)) =>
  sha256(files.map((p) => `${relative(dir, p).split("\\").join("/")}\0${sha256(rd(p))}`).join("\n"));

/** What is read from the files of a package (plus its extensions): the heavy part of a course. */
interface CourseData {
  manifest: CourseManifest;
  lessons: LoadedLesson[];
  quizzes: Map<string, LoadedQuiz>;
  sourcesMd: string;
  sources: LoadedSource[];
}

function readCore(dir: string, manifest: CourseManifest, prefix: string, rd: Reader, warn: Warn): CourseData {
  const sink: ChapterSink = { lessons: [], quizzes: new Map() };
  for (const chapter of manifest.chapters) readChapter(dir, chapter, manifest.id, prefix, sink, rd, warn);
  const sourcesMd = rd(join(dir, "sources.md"));
  return { manifest, lessons: sink.lessons, quizzes: sink.quizzes, sourcesMd, sources: parseSources(sourcesMd) };
}

type Heavy = Pick<LoadedCourse, "lessons" | "lessonById" | "quizzes" | "sourcesMd" | "sources">;

const heavyOf = (d: CourseData): Heavy => ({
  lessons: d.lessons,
  lessonById: new Map(d.lessons.map((l) => [l.id, l])),
  quizzes: d.quizzes,
  sourcesMd: d.sourcesMd,
  sources: d.sources,
});

/** Reads the bodies, quizzes and sources of an already validated course again (its extensions included). */
function loadHeavy(meta: CourseMeta, prefix: string): Heavy {
  const rd = memoReader(new Map());
  const quiet: Warn = () => {};
  const core = readCore(meta.dir, meta.coreManifest, prefix, rd, quiet);
  const overlay = meta.overlayDir ? applyOverlay(core, meta.id, meta.overlayDir, prefix, rd, quiet) : null;
  return heavyOf(overlay?.data ?? core);
}

interface LruLike {
  touch(c: LazyCourse): void;
}

/**
 * A course whose light part (see CourseLight) is always there and whose heavy part (`lessons` with bodies, `lessonById`,
 * `quizzes`, `sourcesMd`, `sources`) is read on first use and kept while the course is among the most recently opened.
 * Afterwards the next access reads it again, so callers never see a difference except in time.
 */
class LazyCourse implements LoadedCourse {
  readonly id: string;
  readonly dir: string;
  readonly dirName: string;
  readonly overlayDir?: string;
  readonly manifest: CourseManifest;
  readonly ref: CourseRef;
  readonly light: CourseLight;
  readonly exams: LoadedExam[];
  readonly contentHash: string;
  private heavy: Heavy | null;
  private lru: LruLike | null;

  constructor(
    readonly meta: CourseMeta,
    private readonly prefix: string,
    lru: LruLike | null,
    heavy?: Heavy,
  ) {
    this.id = meta.id;
    this.dir = meta.dir;
    this.dirName = meta.dirName;
    if (meta.overlayDir) this.overlayDir = meta.overlayDir;
    this.manifest = meta.manifest;
    this.ref = meta.ref;
    this.light = meta.light;
    this.exams = meta.exams;
    this.contentHash = meta.contentHash;
    this.heavy = heavy ?? null;
    this.lru = lru;
    if (heavy) lru?.touch(this);
  }

  private body(): Heavy {
    this.heavy ??= loadHeavy(this.meta, this.prefix);
    this.lru?.touch(this);
    return this.heavy;
  }

  get lessons() {
    return this.body().lessons;
  }
  get lessonById() {
    return this.body().lessonById;
  }
  get quizzes() {
    return this.body().quizzes;
  }
  get sourcesMd() {
    return this.body().sourcesMd;
  }
  get sources() {
    return this.body().sources;
  }

  get isLoaded() {
    return this.heavy !== null;
  }
  /** Lets go of the heavy part (it is read again on the next access). */
  drop() {
    this.heavy = null;
  }
  /** The catalog has replaced this course: stop being tracked, so an old reference does not push others out. */
  retire() {
    this.lru = null;
  }
}

interface BuildOptions {
  /** Files of the package, when the caller has already listed them. */
  files?: string[];
  overlayDirFor?: (courseId: string) => string | null;
  overlayFiles?: string[];
}

/**
 * Validates one package and reads it (every file once, through `rd`): the light part for the cache and the list, and the
 * heavy part, which the caller may keep or throw away. Null when the package is invalid (warned, as before).
 */
function buildCourse(dir: string, prefix: string, rd: Reader, opts: BuildOptions = {}): { meta: CourseMeta; heavy: Heavy } | null {
  const result = validateCoursePackage(dir);
  if (!result.ok || !result.manifest) {
    console.warn(`[catalog] skipping ${dir}: ${result.issues.map((i) => `${i.file}: ${i.message}`).join("; ")}`);
    return null;
  }
  const manifest = result.manifest;
  const core = readCore(dir, manifest, prefix, rd, console.warn);
  const exams: LoadedExam[] = manifest.exams.map((e) => ({
    id: e.id,
    after: e.after ?? null,
    blueprint: examBlueprintSchema.parse(parseYaml(rd(join(dir, e.file)))),
  }));
  let contentHash = dirHash(dir, rd, opts.files);

  let data = core;
  let overlayDir: string | undefined;
  const overlay = opts.overlayDirFor?.(manifest.id);
  if (overlay && existsSync(overlay)) {
    const applied = applyOverlay(core, manifest.id, overlay, prefix, rd, console.warn, opts.overlayFiles);
    if (applied) {
      data = applied.data;
      overlayDir = overlay;
      contentHash = sha256(`${contentHash}\n${applied.overlayHash()}`);
    }
  }

  const meta: CourseMeta = {
    id: manifest.id,
    dir,
    dirName: basename(dir),
    ...(overlayDir ? { overlayDir } : {}),
    coreManifest: manifest,
    manifest: data.manifest,
    ref: { id: manifest.id, title: manifest.title, monogram: manifest.monogram ?? monogramFor(manifest.title), hue: manifest.hue ?? hueFor(manifest.id) },
    exams,
    light: lightOf(data.lessons, data.quizzes, data.sources.length),
    contentHash,
    counts: {
      lessons: data.lessons.length,
      quizzes: data.quizzes.size,
      questions: [...data.quizzes.values()].reduce((n, q) => n + q.quiz.questions.length, 0),
    },
  };
  return { meta, heavy: heavyOf(data) };
}

/** Loads one package (without extensions) with its bodies in memory; null, with a warning, when it is invalid. */
export function loadCourse(dir: string, prefix: string): LoadedCourse | null {
  const built = buildCourse(dir, prefix, memoReader(new Map()));
  return built ? new LazyCourse(built.meta, prefix, null, built.heavy) : null;
}

class LoadedLru implements LruLike {
  private order = new Set<LazyCourse>();
  constructor(private readonly max: number) {}

  touch(c: LazyCourse) {
    this.order.delete(c);
    this.order.add(c);
    for (const old of this.order) {
      if (this.order.size <= this.max || old === c) break;
      this.order.delete(old);
      old.drop();
    }
  }

  forget(c: LazyCourse) {
    this.order.delete(c);
    c.retire();
  }

  get size() {
    return this.order.size;
  }
}

export const questionKey = (courseId: string, qid: string) => `${courseId}:${qid}`;
export type { Question };

/** Reads course packages from a directory; reloads when any file changes. */
interface CourseEntry {
  /** Name, size and modified time of every file of the course package. */
  fingerprint: string;
  /** The same for its extensions folder ("" when it has none). */
  overlayFingerprint: string;
  course: LazyCourse;
}

/** Names, sizes and modified times of a folder's files, and the files themselves. */
interface Stamp {
  fingerprint: string;
  files: string[];
}

const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * Reads course packages from a directory. Each course is cached on its own, so an edit reloads that one course and
 * not the whole library. Checking for edits happens off the request path (see `refresh`).
 */
export class Catalog {
  private entries = new Map<string, CourseEntry>();
  /** `load()` has run, or the start-up warm-up has begun: requests are served from `entries` (possibly still filling up). */
  private started = false;
  private checkedAt = 0;
  /** A background check is running (only one at a time). */
  private refreshing = false;
  /** The background check changed `entries`: the next `load()` reports `changed`. */
  private swapped = false;
  /** `invalidate()` was called: the next `load()` looks for new, removed and extended courses straight away. */
  private forceSync = false;
  private readonly prefix: string;
  /** Goes up by one every time the set of loaded courses (or any of their content) changes. Caches key on it. */
  private gen = 0;
  private readonly lru: LoadedLru;
  private readonly disk: DiskCache | null;
  /** Saved light parts read from the disk cache; only used until the first pass over the folders is done. */
  private saved: Map<string, CacheRecord> | null = null;
  /** How long the last background check took to compare fingerprints (not counting reloads), ms. */
  private checkMs = 0;
  private lastRequestAt = Date.now();
  /** Time between the previous burst of `load()` calls and the current one. */
  private requestGap = 0;

  /** URL prefix the browser reaches the api under (resource links in lesson text). */
  get publicPrefix(): string {
    return this.prefix;
  }

  get generation(): number {
    return this.gen;
  }

  constructor(private readonly opts: CatalogOptions) {
    this.prefix = opts.publicPrefix ?? "/api";
    this.lru = new LoadedLru(Math.max(1, opts.maxLoadedCourses ?? 8));
    this.disk = opts.cacheDir ? new DiskCache(opts.cacheDir, this.prefix) : null;
  }

  /** Courses known, how many have their bodies in memory, and the last background check's duration. */
  get stats() {
    return { courses: this.entries.size, loaded: this.lru.size, lastCheckMs: this.checkMs };
  }

  /** Resolves when every disk-cache write queued so far has landed. */
  flushCache(): Promise<void> {
    return this.disk?.flush() ?? Promise.resolve();
  }

  /**
   * How long to wait after a background check started before the next one: the base interval, but at least five times
   * what the last check cost, and longer (up to `idleRecheckMs`) when requests have been rare.
   */
  get recheckWaitMs(): number {
    const base = this.opts.recheckMs ?? 0;
    if (base <= 0) return 0;
    const wait = Math.max(base, 5 * this.checkMs);
    return this.requestGap >= (this.opts.idleAfterMs ?? 15_000) ? Math.max(wait, this.opts.idleRecheckMs ?? 30_000) : wait;
  }

  get coursesDir() {
    return this.opts.coursesDir;
  }

  private packageDirs(): string[] {
    if (!existsSync(this.opts.coursesDir)) return [];
    return readdirSync(this.opts.coursesDir)
      .filter((n) => !n.startsWith("."))
      .sort()
      .map((n) => join(this.opts.coursesDir, n))
      .filter((p) => lstatSync(p).isDirectory() && existsSync(join(p, "course.yaml")));
  }

  get extensionsDir() {
    return this.opts.extensionsDir ?? null;
  }

  /** Where a course's extension chapters live (the folder may not exist). */
  overlayDirFor(courseId: string): string | null {
    return this.opts.extensionsDir ? join(this.opts.extensionsDir, courseId) : null;
  }

  /** The extensions folder of a course whose id we already know, when it exists. */
  private overlayFor(dir: string): string | null {
    const id = this.entries.get(dir)?.course.id ?? this.saved?.get(dir)?.meta.id;
    const overlay = id ? this.overlayDirFor(id) : null;
    return overlay && existsSync(overlay) ? overlay : null;
  }

  // Paths in a fingerprint are relative to the folder, so moving the library (another mount point) does not invalidate it.
  private static async stamp(dir: string): Promise<Stamp> {
    const files = await listFilesAsync(dir);
    const stats = await Promise.all(files.map((f) => lstat(f)));
    return { files, fingerprint: files.map((f, i) => `${relative(dir, f)}:${stats[i]!.mtimeMs}:${stats[i]!.size}`).join("|") };
  }

  private static stampSync(dir: string): Stamp {
    const files = listFiles(dir);
    return {
      files,
      fingerprint: files
        .map((f) => {
          const st = lstatSync(f);
          return `${relative(dir, f)}:${st.mtimeMs}:${st.size}`;
        })
        .join("|"),
    };
  }

  private overlayStampSync(dir: string): Stamp {
    const overlay = this.overlayFor(dir);
    return overlay ? Catalog.stampSync(overlay) : { fingerprint: "", files: [] };
  }

  /** Forgets a course; its saved copy goes too. */
  private drop(dir: string): boolean {
    const known = this.entries.get(dir);
    if (!known) return false;
    this.lru.forget(known.course);
    this.entries.delete(dir);
    this.disk?.remove(dir);
    this.gen++;
    return true;
  }

  private remember(dir: string, entry: CourseEntry): void {
    const old = this.entries.get(dir);
    if (old) this.lru.forget(old.course);
    this.entries.set(dir, entry);
    this.gen++;
  }

  /**
   * Reads one course (and its extensions) and remembers it, or forgets it when it no longer loads. The files come
   * through `memo` (filled in advance by the background path), so each is read from the disk once. `keepBodies`: the
   * caller is on the request path and is about to use the course, so its bodies stay in memory.
   */
  private readCourse(dir: string, main: Stamp, keepBodies: boolean, memo = new Map<string, string>(), overlayFiles?: string[]): void {
    const built = buildCourse(dir, this.prefix, memoReader(memo), {
      ...(main.files.length ? { files: main.files } : {}),
      ...(overlayFiles ? { overlayFiles } : {}),
      overlayDirFor: (id) => this.overlayDirFor(id),
    });
    if (!built) {
      this.drop(dir);
      return;
    }
    const overlay = this.overlayDirFor(built.meta.id);
    const overlayFingerprint = overlay && existsSync(overlay) ? Catalog.stampSync(overlay).fingerprint : "";
    const course = new LazyCourse(built.meta, this.prefix, this.lru, keepBodies ? built.heavy : undefined);
    this.remember(dir, { fingerprint: main.fingerprint, overlayFingerprint, course });
    this.disk?.write(dir, { fingerprint: fingerprintHash(main.fingerprint), overlayFingerprint: fingerprintHash(overlayFingerprint), meta: built.meta });
  }

  /** Takes a course from its saved copy when that copy was made from exactly these files. */
  private adopt(dir: string, main: string, overlay: string): boolean {
    const rec = this.saved?.get(dir);
    if (!rec || rec.fingerprint !== fingerprintHash(main) || rec.overlayFingerprint !== fingerprintHash(overlay)) return false;
    const expected = this.overlayDirFor(rec.meta.id);
    if (rec.meta.overlayDir && rec.meta.overlayDir !== expected) return false;
    this.remember(dir, { fingerprint: main, overlayFingerprint: overlay, course: new LazyCourse(rec.meta, this.prefix, this.lru) });
    return true;
  }

  private forgetMissing(dirs: string[]): boolean {
    const present = new Set(dirs);
    let changed = false;
    for (const dir of [...this.entries.keys()]) {
      if (!present.has(dir) && this.drop(dir)) changed = true;
    }
    return changed;
  }

  /** Saved copies of courses that are gone from the folder are deleted. */
  private tidySaved(dirs: string[]): void {
    const present = new Set(dirs);
    for (const dir of this.saved?.keys() ?? []) if (!present.has(dir)) this.disk?.remove(dir);
  }

  private courses(dirs = this.packageDirs()): LoadedCourse[] {
    return dirs.flatMap((d) => {
      const e = this.entries.get(d);
      return e ? [e.course] : [];
    });
  }

  /**
   * Walks the courses one at a time, off the request path: every course whose files changed is reloaded, new ones are
   * added, missing ones dropped. The event loop gets a turn between courses, so requests keep being answered while a
   * large library is read for the first time (they see the courses read so far). Also used once at start-up.
   */
  async refresh(): Promise<void> {
    if (this.refreshing) return;
    this.refreshing = true;
    this.started = true;
    try {
      const dirs = this.packageDirs();
      let changed = this.forgetMissing(dirs);
      if (this.disk && !this.saved) {
        this.saved = await this.disk.readAll();
        this.tidySaved(dirs);
      }
      const t0 = Date.now();
      const prints = await Promise.all(
        dirs.map(async (d) => {
          const overlay = this.overlayFor(d);
          return { main: await Catalog.stamp(d), overlay: overlay ? await Catalog.stamp(overlay) : { fingerprint: "", files: [] as string[] } };
        }),
      );
      this.checkMs = Date.now() - t0;
      for (const [i, dir] of dirs.entries()) {
        const { main, overlay } = prints[i]!;
        const known = this.entries.get(dir);
        if (known && known.fingerprint === main.fingerprint && known.overlayFingerprint === overlay.fingerprint) continue;
        await yieldToEventLoop();
        if (!known && this.adopt(dir, main.fingerprint, overlay.fingerprint)) {
          changed = true;
          continue;
        }
        // Read every file of the course now, a few at a time, so the synchronous parsing that follows never waits on the disk.
        const memo = new Map<string, string>();
        await prefetch([...main.files, ...overlay.files], memo);
        this.readCourse(dir, main, false, memo, overlay.files);
        changed = true;
      }
      this.saved = new Map();
      if (changed) this.swapped = true;
    } catch (e) {
      console.warn(`[catalog] background re-check failed: ${(e as Error).message}`);
    } finally {
      this.checkedAt = Date.now();
      this.refreshing = false;
    }
  }

  /** Start-up: read every course in the background so the first page is not the one that waits. */
  warmUp(): Promise<void> {
    return this.refresh();
  }

  /** Makes the next `load()` notice new, removed and extended courses, for code that has just written into the folders. */
  invalidate(): void {
    this.checkedAt = 0;
    this.forceSync = true;
  }

  private hiddenKey = "";

  /** Returns the visible courses (those the user has not removed) and whether they changed since the previous call. */
  load(): { courses: LoadedCourse[]; changed: boolean } {
    this.noteRequest();
    const scan = this.scan();
    const hidden = this.opts.hidden?.() ?? new Set<string>();
    const key = [...hidden].sort().join("|");
    const changed = scan.changed || key !== this.hiddenKey;
    this.hiddenKey = key;
    return { courses: hidden.size ? scan.courses.filter((c) => !hidden.has(c.id)) : scan.courses, changed };
  }

  /** Courses whose files are in the folder but which the user removed from the app. */
  loadHidden(): LoadedCourse[] {
    this.noteRequest();
    const hidden = this.opts.hidden?.() ?? new Set<string>();
    return hidden.size ? this.scan().courses.filter((c) => hidden.has(c.id)) : [];
  }

  private burstStart = 0;

  /** Calls within 250 ms of each other are one request; the quiet time before a request decides whether the app is idle. */
  private noteRequest(): void {
    const now = Date.now();
    if (now - this.lastRequestAt > 250) {
      this.requestGap = now - this.lastRequestAt;
      this.burstStart = now;
    } else if (now - this.burstStart > 250) {
      this.requestGap = 0; // a steady stream of calls is not idle
    }
    this.lastRequestAt = now;
  }

  private scan(): { courses: LoadedCourse[]; changed: boolean } {
    const recheck = this.opts.recheckMs ?? 0;
    if (this.started && this.swapped) {
      this.swapped = false;
      return { courses: this.courses(), changed: true };
    }
    if (this.started && recheck > 0 && !this.forceSync) {
      if (Date.now() - this.checkedAt >= this.recheckWaitMs && !this.refreshing) void this.refresh();
      return { courses: this.courses(), changed: false };
    }
    if (!this.started && this.opts.warmUpInBackground) {
      void this.refresh();
      return { courses: this.courses(), changed: false };
    }
    // First call, a call right after invalidate(), or a re-check on every call: look now, reload only what differs.
    const quick = this.started && this.forceSync && recheck > 0;
    this.forceSync = false;
    this.started = true;
    const dirs = this.packageDirs();
    let changed = this.forgetMissing(dirs);
    if (this.disk && !this.saved) {
      this.saved = this.disk.readAllSync();
      this.tidySaved(dirs);
    }
    for (const dir of dirs) {
      const known = this.entries.get(dir);
      // After invalidate() only new courses and extension changes can have happened, so known courses are not walked
      // again (that is the slow part); only their small extensions folders are compared.
      const main: Stamp = quick && known ? { fingerprint: known.fingerprint, files: [] } : Catalog.stampSync(dir);
      const overlay = this.overlayStampSync(dir);
      if (known && known.fingerprint === main.fingerprint && known.overlayFingerprint === overlay.fingerprint) continue;
      if (!known && this.adopt(dir, main.fingerprint, overlay.fingerprint)) {
        changed = true;
        continue;
      }
      this.readCourse(dir, main, true);
      changed = true;
    }
    this.saved = new Map();
    this.checkedAt = Date.now();
    return { courses: this.courses(dirs), changed };
  }
}
