import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CourseManifest, CourseRef, Question } from "@selfschool/shared";
import type { CourseLight, LightLesson, LoadedExam } from "./catalog.js";
import { sha256 } from "./util.js";

/** Goes up whenever the shape of a cache file changes; files with another number are ignored and rebuilt. */
export const CACHE_VERSION = 1;

/** Everything about a course that does not need the lesson bodies (what the list, the dashboard and the outline read). */
export interface CourseMeta {
  id: string;
  dir: string;
  dirName: string;
  overlayDir?: string;
  /** The package's own manifest, without extension chapters (needed to read the bodies again). */
  coreManifest: CourseManifest;
  /** Core plus extension chapters. */
  manifest: CourseManifest;
  ref: CourseRef;
  exams: LoadedExam[];
  light: CourseLight;
  contentHash: string;
  counts: { lessons: number; quizzes: number; questions: number };
}

export interface CacheRecord {
  /** Hash of the course package's file fingerprint (names, sizes, modified times). */
  fingerprint: string;
  /** The same for its extensions folder ("" when it has none). */
  overlayFingerprint: string;
  meta: CourseMeta;
}

interface FileShape {
  v: number;
  prefix: string;
  dir: string;
  fingerprint: string;
  overlayFingerprint: string;
  meta: Omit<CourseMeta, "light"> & { light: { lessons: LightLesson[]; quizQuestions: [string, Question[]][]; sourceCount: number } };
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null;

export const fingerprintHash = (fingerprint: string) => (fingerprint ? sha256(fingerprint) : "");

/**
 * One JSON file per course in `<dir>`, named after the course folder. Never trusted over the course files: the caller
 * compares fingerprints and rebuilds on any doubt. A file that is unreadable, partial, from another version, from
 * another prefix, or that does not fit its own counts is simply not returned.
 */
export class DiskCache {
  private queue: Promise<void> = Promise.resolve();
  private seq = 0;

  constructor(
    readonly dir: string,
    private readonly prefix: string,
  ) {}

  private fileFor(courseDir: string) {
    return join(this.dir, `${sha256(courseDir).slice(0, 24)}.json`);
  }

  private decode(text: string): { dir: string; record: CacheRecord } | null {
    try {
      const f = JSON.parse(text) as FileShape;
      if (!isObj(f) || f.v !== CACHE_VERSION || f.prefix !== this.prefix || typeof f.dir !== "string") return null;
      const m = f.meta;
      if (!isObj(m) || m.dir !== f.dir || typeof m.id !== "string" || typeof m.contentHash !== "string" || !isObj(m.manifest) || !isObj(m.coreManifest) || !isObj(m.ref)) return null;
      if (!Array.isArray(m.exams) || !isObj(m.light) || !Array.isArray(m.light.lessons) || !Array.isArray(m.light.quizQuestions) || typeof m.light.sourceCount !== "number") return null;
      if (typeof f.fingerprint !== "string" || typeof f.overlayFingerprint !== "string") return null;
      const quizQuestions = new Map(m.light.quizQuestions);
      const questions = [...quizQuestions.values()].reduce((n, q) => n + q.length, 0);
      if (m.counts?.lessons !== m.light.lessons.length || m.counts?.quizzes !== quizQuestions.size || m.counts?.questions !== questions) return null;
      const meta: CourseMeta = { ...m, light: { lessons: m.light.lessons, quizQuestions, sourceCount: m.light.sourceCount } };
      return { dir: f.dir, record: { fingerprint: f.fingerprint, overlayFingerprint: f.overlayFingerprint, meta } };
    } catch {
      return null;
    }
  }

  private encode(courseDir: string, r: CacheRecord): string {
    const { light, ...rest } = r.meta;
    const file: FileShape = {
      v: CACHE_VERSION,
      prefix: this.prefix,
      dir: courseDir,
      fingerprint: r.fingerprint,
      overlayFingerprint: r.overlayFingerprint,
      meta: { ...rest, light: { lessons: light.lessons, quizQuestions: [...light.quizQuestions], sourceCount: light.sourceCount } },
    };
    return JSON.stringify(file);
  }

  /** Every usable record by course folder. Leftover temp files from an interrupted write are removed. */
  async readAll(): Promise<Map<string, CacheRecord>> {
    const out = new Map<string, CacheRecord>();
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch {
      return out;
    }
    const files = names.filter((n) => n.endsWith(".json"));
    for (const n of names.filter((n) => n.endsWith(".tmp"))) void rm(join(this.dir, n), { force: true }).catch(() => {});
    let next = 0;
    const worker = async () => {
      while (next < files.length) {
        const name = files[next++]!;
        try {
          const got = this.decode(await readFile(join(this.dir, name), "utf8"));
          if (got) out.set(got.dir, got.record);
        } catch {
          /* unreadable: rebuilt */
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(8, files.length) }, worker));
    return out;
  }

  /** Same as `readAll`, for the synchronous first load. */
  readAllSync(): Map<string, CacheRecord> {
    const out = new Map<string, CacheRecord>();
    let names: string[];
    try {
      names = readdirSync(this.dir);
    } catch {
      return out;
    }
    for (const name of names.filter((n) => n.endsWith(".json"))) {
      try {
        const got = this.decode(readFileSync(join(this.dir, name), "utf8"));
        if (got) out.set(got.dir, got.record);
      } catch {
        /* unreadable: rebuilt */
      }
    }
    return out;
  }

  private enqueue(job: () => Promise<void>) {
    this.queue = this.queue.then(job).catch((e) => console.warn(`[catalog] cache write failed: ${(e as Error).message}`));
  }

  /** Writes in the background, one file at a time: temp file, then rename, so a reader never sees half a file. */
  write(courseDir: string, record: CacheRecord): void {
    const text = this.encode(courseDir, record);
    const file = this.fileFor(courseDir);
    this.enqueue(async () => {
      mkdirSync(this.dir, { recursive: true });
      const tmp = `${file}.${process.pid}.${this.seq++}.tmp`;
      await writeFile(tmp, text);
      try {
        await rename(tmp, file);
      } catch (e) {
        await rm(tmp, { force: true });
        throw e;
      }
    });
  }

  remove(courseDir: string): void {
    this.enqueue(() => rm(this.fileFor(courseDir), { force: true }));
  }

  /** Resolves when every queued write has landed (tests, shutdown). */
  flush(): Promise<void> {
    return this.queue;
  }
}
