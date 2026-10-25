import { execFile } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import { unzipSync } from "fflate";
import { SCHEMA_VERSION, type CourseChoice, type PackageInfo, type PackagePreview } from "@selfschool/shared";
import { validateCoursePackage } from "@selfschool/shared/node";
import { listFiles, loadCourse } from "./catalog.js";
import { loadCourses, type Ctx, type GitRunner } from "./ctx.js";
import { removedIds, unremoveCourse } from "./removal.js";
import { packages } from "./db/schema.js";
import { HttpError, newId } from "./util.js";

const execFileP = promisify(execFile);

/** Real git, argv only (no shell). Prompts and system config are disabled. */
export const runGit: GitRunner = async (args, { cwd, timeoutMs }) => {
  const { stdout } = await execFileP("git", args, {
    cwd,
    timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024,
    windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "", GIT_CONFIG_NOSYSTEM: "1" },
  });
  return stdout.trim();
};

export function listPackages(ctx: Ctx): PackageInfo[] {
  return loadCourses(ctx).flatMap((c) => {
    const row = ctx.db.select().from(packages).where(eq(packages.id, c.id)).get();
    if (!row) return [];
    return [{
      id: c.id, course: c.ref, url: row.url, path: row.path, ref: row.ref, sha: row.sha,
      status: "up_to_date" as const, latestSha: null,
    }];
  });
}

// ---------- input validation (everything here is untrusted) ----------

const PRIVATE_HOST = /^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i;
const PRIVATE_IPV4 = /^(0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

/** Only plain https URLs without credentials to public-looking hosts. */
export function validateGitUrl(raw: string): string {
  if (raw.length > 500 || /[\s\u0000-\u001f]/.test(raw)) throw new HttpError(400, "invalid package URL");
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new HttpError(400, "invalid package URL");
  }
  if (u.protocol !== "https:") throw new HttpError(400, "only https:// package URLs are allowed");
  if (u.username || u.password) throw new HttpError(400, "credentials in package URLs are not allowed");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (!host || PRIVATE_HOST.test(host) || PRIVATE_IPV4.test(host) || host === "::1" || /^(fc|fd|fe80)/i.test(host)) {
    throw new HttpError(400, "package URL must point at a public host");
  }
  u.hash = "";
  return u.toString();
}

export function validateRef(ref: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/.test(ref) || ref.includes("..") || ref.endsWith("/") || ref.endsWith(".lock")) {
    throw new HttpError(400, "ref must be a branch or tag name");
  }
  return ref;
}

export function validateSubpath(p: string): string {
  if (p === "") return "";
  const norm = p.replace(/\/+$/, "");
  if (norm.length > 200 || norm.startsWith("/") || norm.includes("\\") || norm.split("/").some((s) => s === ".." || s === "." || s === "" || s.startsWith("-") || !/^[A-Za-z0-9._ -]+$/.test(s))) {
    throw new HttpError(400, "path must be a relative folder inside the repository");
  }
  return norm;
}

/** Copies a package folder, skipping .git, node_modules and symlinks. */
function copyPackage(from: string, to: string): void {
  cpSync(from, to, {
    recursive: true,
    filter: (src) => {
      const name = src.split(/[\\/]/).pop();
      if (name === ".git" || name === "node_modules") return false;
      return !lstatSync(src).isSymbolicLink();
    },
  });
}

interface FetchedPackage {
  /** Temp folder to remove when done (also holds the clone for repos). */
  tmp: string;
  pkgDir: string;
  url: string;
  path: string;
  ref: string;
  sha: string;
  /** Short description of what was read, for the preview ("github.com/a/b @ 1a2b3c4"). */
  from: string;
}

/**
 * Fetches a course package without installing it: a public https git repo (shallow clone, never executed) or an
 * absolute local folder. Removes its temp folder itself when it throws; otherwise the caller does.
 */
async function fetchPackage(ctx: Ctx, body: { url: string; path: string; ref: string }): Promise<FetchedPackage> {
  const coursesDir = resolve(ctx.catalog.coursesDir);
  mkdirSync(coursesDir, { recursive: true });
  const isUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(body.url);
  const sub = validateSubpath(body.path);
  const tmp = join(coursesDir, `.fetch-${newId()}`);

  let srcRoot: string;
  let url: string;
  let ref: string;
  let sha = "";
  try {
    if (isUrl) {
      url = validateGitUrl(body.url);
      ref = validateRef(body.ref || "main");
      await ctx.git(
        ["-c", "protocol.allow=never", "-c", "protocol.https.allow=always", "-c", "core.symlinks=false",
          "clone", "--depth", "1", "--single-branch", "--no-tags", "--branch", ref, "--", url, tmp],
        { timeoutMs: 120_000 },
      ).catch((e: Error) => {
        throw new HttpError(422, `git clone failed: ${String(e.message).split("\n")[0]}`);
      });
      sha = await ctx.git(["rev-parse", "HEAD"], { cwd: tmp, timeoutMs: 10_000 });
      srcRoot = tmp;
    } else if (isAbsolute(body.url)) {
      const p = resolve(body.url);
      if (!existsSync(p) || !lstatSync(p).isDirectory()) throw new HttpError(400, "local path is not a folder");
      url = `local:${p}`;
      ref = "local";
      srcRoot = p;
    } else {
      throw new HttpError(400, "give an https:// git URL or an absolute local folder");
    }

    const pkgDir = sub ? resolve(srcRoot, sub) : resolve(srcRoot);
    const rel = relative(resolve(srcRoot), pkgDir);
    if (rel.startsWith("..") || isAbsolute(rel)) throw new HttpError(400, "path escapes the repository");
    if (!existsSync(pkgDir) || !lstatSync(pkgDir).isDirectory()) throw new HttpError(422, "path does not exist in the repository");

    return { tmp, pkgDir, url, path: sub, ref, sha, from: `${url.replace(/^https:\/\//, "")}${sub ? `/${sub}` : ""}${sha ? ` @ ${sha.slice(0, 7)}` : ""}` };
  } catch (e) {
    rmSync(tmp, { recursive: true, force: true });
    throw e;
  }
}

/** Lesson files in a course folder (lesson-NN.md one level down), without parsing anything. */
function countLessons(dir: string): number {
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .reduce((n, d) => n + readdirSync(join(dir, d.name)).filter((f) => /^lesson-\d+\.md$/.test(f)).length, 0);
}

/**
 * Null when `pkgDir` holds a course.yaml. Otherwise says so, and when the folder is a repo of several courses
 * (one subfolder each), names them so the user knows what to put in Path.
 */
function missingCourseHint(ctx: Ctx, pkgDir: string, url: string, basePath: string): { message: string; choices: CourseChoice[] } | null {
  if (existsSync(join(pkgDir, "course.yaml"))) return null;
  const removed = removedIds(ctx.db);
  const choices = readdirSync(pkgDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith(".") && existsSync(join(pkgDir, d.name, "course.yaml")))
    .map((d): CourseChoice => {
      const dir = join(pkgDir, d.name);
      const path = basePath ? `${basePath}/${d.name}` : d.name;
      const check = validateCoursePackage(dir);
      const id = check.manifest?.id ?? d.name;
      const taken = existsSync(join(resolve(ctx.catalog.coursesDir), id));
      const prev = ctx.db.select().from(packages).where(eq(packages.id, id)).get();
      return {
        path,
        id,
        title: check.manifest?.title ?? d.name,
        level: check.manifest?.level ?? "",
        lessonCount: countLessons(dir),
        ok: check.ok,
        conflict: !taken || removed.has(id) ? "none" : sameSource(prev, url, path) ? "update" : "clash",
      };
    });
  return {
    choices,
    message: choices.length ? `This repository holds ${choices.length} course${choices.length === 1 ? "" : "s"}.` : "no course.yaml in this folder",
  };
}

/**
 * Adds a course package from a repo or local folder. The package is validated before it is moved into the
 * courses directory.
 */
export async function addPackage(ctx: Ctx, body: { url: string; path: string; ref: string }): Promise<PackageInfo> {
  const f = await fetchPackage(ctx, body);
  try {
    const hint = missingCourseHint(ctx, f.pkgDir, f.url, f.path);
    if (hint) throw new HttpError(422, hint.choices.length ? `no course.yaml here; set Path to one of: ${hint.choices.map((c) => c.path).join(", ")}` : hint.message);
    return installFromDir(ctx, f.pkgDir, f);
  } finally {
    rmSync(f.tmp, { recursive: true, force: true });
  }
}

/** Dry run of `addPackage` for the add popup: same fetch, same checks, nothing installed. */
export async function previewPackage(ctx: Ctx, body: { url: string; path: string; ref: string }): Promise<PackagePreview> {
  const empty = { fileName: body.url.replace(/^https:\/\//, "").slice(0, 120), sizeBytes: 0, fileCount: 0, issues: [], conflict: "none" as const, course: null };
  let f: FetchedPackage;
  try {
    f = await fetchPackage(ctx, body);
  } catch (e) {
    const message = e instanceof HttpError ? e.message : "could not fetch the package";
    return { ...empty, ok: false, checks: [{ label: "Fetch the package", ok: false, detail: message }] };
  }
  try {
    const hint = missingCourseHint(ctx, f.pkgDir, f.url, f.path);
    if (hint) {
      return { ...empty, ok: false, ...(hint.choices.length ? { choices: hint.choices } : {}), checks: [{ label: "Fetch the package", ok: true, detail: f.from }, { label: "Find course.yaml", ok: false, detail: hint.message }] };
    }
    const files = listFiles(f.pkgDir);
    return summarizePackage(ctx, f.pkgDir, {
      fileName: f.from,
      sizeBytes: files.reduce((n, p) => n + lstatSync(p).size, 0),
      fileCount: files.length,
      url: f.url,
      path: f.path,
      checks: [{ label: "Fetch the package", ok: true, detail: f.from }, { label: "Find course.yaml", ok: true }],
    });
  } finally {
    rmSync(f.tmp, { recursive: true, force: true });
  }
}

/** A course that is already installed may be replaced only by the same source (any zip counts as the same for uploads). */
function sameSource(prev: { url: string; path: string } | undefined, url: string, path: string): boolean {
  return !!prev && prev.path === path && (prev.url === url || (url.startsWith("zip:") && prev.url.startsWith("zip:")));
}

/**
 * Validates a course folder and moves a copy into the courses directory. A course whose id is already
 * installed from a different source is refused; the same source (or, for uploads, another zip) replaces it.
 */
export function installFromDir(ctx: Ctx, pkgDir: string, src: { url: string; path: string; ref: string; sha: string }): PackageInfo {
  const coursesDir = resolve(ctx.catalog.coursesDir);
  mkdirSync(coursesDir, { recursive: true });
  const { url, path: sub, ref, sha } = src;
  const check = validateCoursePackage(pkgDir);
  if (!check.ok || !check.manifest) {
    throw new HttpError(422, `not a valid course package: ${check.issues.slice(0, 5).map((i) => `${i.file}: ${i.message}`).join("; ")}`);
  }
  const id = check.manifest.id;
  const final = join(coursesDir, id);
  const prev = ctx.db.select().from(packages).where(eq(packages.id, id)).get();
  const staged = join(coursesDir, `.stage-${newId()}`);
  copyPackage(pkgDir, staged);

  // a course the user removed from the app may be imported again; its old folder (if still there) is replaced
  const wasRemoved = removedIds(ctx.db).has(id);
  if (existsSync(final)) {
    if (!wasRemoved && !sameSource(prev, url, sub)) {
      rmSync(staged, { recursive: true, force: true });
      throw new HttpError(409, `a different course with the id "${id}" is already installed. Course ids must be unique because progress is keyed by id; ask the author to give their course a new id (school new-id)`);
    }
    const old = join(coursesDir, `.old-${newId()}`);
    renameSync(final, old);
    renameSync(staged, final);
    rmSync(old, { recursive: true, force: true });
  } else {
    renameSync(staged, final);
  }

  unremoveCourse(ctx, id);
  ctx.catalog.invalidate();
  const values = { id, url, path: sub, ref, sha, fetchedAt: ctx.now(), schemaVersion: SCHEMA_VERSION };
  ctx.db.insert(packages).values(values).onConflictDoUpdate({ target: packages.id, set: values }).run();
  const info = listPackages(ctx).find((p) => p.id === id);
  if (!info) throw new HttpError(422, "package was added but could not be loaded");
  if (!sha) {
    // local copies and uploads pin their content hash like on-disk packages
    const c = loadCourses(ctx).find((x) => x.id === id);
    if (c) ctx.db.update(packages).set({ sha: c.contentHash.slice(0, 12) }).where(eq(packages.id, id)).run();
  }
  return listPackages(ctx).find((p) => p.id === id)!;
}

// ---------- zip upload (everything inside the archive is untrusted) ----------

export const ZIP_LIMITS = { zipBytes: 50 * 1024 * 1024, totalBytes: 200 * 1024 * 1024, fileBytes: 50 * 1024 * 1024, files: 3000 };

/** Returns a safe relative path for a zip entry, `null` for entries to ignore, or throws for an unsafe name. */
export function zipEntryPath(raw: string): string | null {
  const name = raw.replace(/\\/g, "/");
  if (name.endsWith("/")) return null; // directory entry
  if (name.startsWith("__MACOSX/") || name.split("/").pop() === ".DS_Store" || name.split("/").some((s) => s === ".git")) return null;
  const parts = name.split("/");
  if (name.startsWith("/") || /^[A-Za-z]:/.test(name) || name.includes("\0") || parts.some((s) => s === ".." || s === "." || s === "")) {
    throw new HttpError(422, `the zip contains an unsafe path: "${raw.slice(0, 80)}"`);
  }
  return parts.join("/");
}

interface ExtractedZip {
  /** Temp folder holding the extraction; the caller removes it. */
  tmp: string;
  pkgDir: string;
  label: string;
  fileCount: number;
}

/**
 * Extracts a zip into a temp folder with path, size and file-count limits and finds the package root (the zip
 * root, or the single folder inside it). Throws an HttpError for anything unsafe or unusable; removes the temp
 * folder itself in that case.
 */
function extractZip(ctx: Ctx, data: Uint8Array, fileName: string): ExtractedZip {
  if (data.length > ZIP_LIMITS.zipBytes) throw new HttpError(413, "the zip is larger than 50 MB");
  if (data.length < 4 || data[0] !== 0x50 || data[1] !== 0x4b || data[2] !== 0x03 || data[3] !== 0x04) {
    throw new HttpError(422, "that file is not a zip archive");
  }
  const coursesDir = resolve(ctx.catalog.coursesDir);
  mkdirSync(coursesDir, { recursive: true });
  const tmp = join(coursesDir, `.fetch-${newId()}`);
  const label = `zip:${fileName.replace(/^.*[\\/]/, "").replace(/[^\w. -]/g, "").slice(0, 80) || "course.zip"}`;
  try {
    let total = 0;
    let count = 0;
    let entries: Record<string, Uint8Array>;
    try {
      entries = unzipSync(data, {
        filter: (f) => {
          if (zipEntryPath(f.name) === null) return false;
          if (++count > ZIP_LIMITS.files) throw new HttpError(413, `the zip has more than ${ZIP_LIMITS.files} files`);
          if (f.originalSize > ZIP_LIMITS.fileBytes) throw new HttpError(413, `"${f.name.slice(0, 80)}" is larger than 50 MB`);
          total += f.originalSize;
          if (total > ZIP_LIMITS.totalBytes) throw new HttpError(413, "the zip expands to more than 200 MB");
          return true;
        },
      });
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(422, "the zip could not be read (is it damaged?)");
    }

    const root = join(tmp, "pkg");
    let written = 0;
    for (const [name, bytes] of Object.entries(entries)) {
      const rel = zipEntryPath(name);
      if (rel === null) continue;
      written += bytes.length;
      if (written > ZIP_LIMITS.totalBytes) throw new HttpError(413, "the zip expands to more than 200 MB");
      const target = resolve(root, rel);
      if (!insideDir(root, target)) throw new HttpError(422, `the zip contains an unsafe path: "${name.slice(0, 80)}"`);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, bytes);
    }
    if (!existsSync(root)) throw new HttpError(422, "the zip is empty");

    // the package is at the zip root, or inside the single folder a "zip this folder" action creates
    let pkgDir = root;
    if (!existsSync(join(root, "course.yaml"))) {
      const dirs = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory());
      const only = dirs.length === 1 ? join(root, dirs[0]!.name) : null;
      if (!only || !existsSync(join(only, "course.yaml"))) {
        throw new HttpError(422, "no course.yaml found at the top of the zip (or in the single folder inside it)");
      }
      pkgDir = only;
    }
    return { tmp, pkgDir, label, fileCount: Object.keys(entries).length };
  } catch (e) {
    rmSync(tmp, { recursive: true, force: true });
    throw e;
  }
}

/** Adds a course from a zip file: extracted safely, validated, then installed like any other package. */
export function addPackageZip(ctx: Ctx, data: Uint8Array, fileName: string): PackageInfo {
  const x = extractZip(ctx, data, fileName);
  try {
    return installFromDir(ctx, x.pkgDir, { url: x.label, path: "", ref: "upload", sha: "" });
  } finally {
    rmSync(x.tmp, { recursive: true, force: true });
  }
}

/**
 * Dry run of `addPackageZip` for the upload popup: runs every check, reports each step and summarises the
 * chapters, lessons and quizzes, but installs nothing. Failures come back as failed checks, not errors.
 */
export function previewPackageZip(ctx: Ctx, data: Uint8Array, fileName: string): PackagePreview {
  let x: ExtractedZip;
  try {
    x = extractZip(ctx, data, fileName);
  } catch (e) {
    const message = e instanceof HttpError ? e.message : "the zip could not be read";
    return {
      fileName: fileName.replace(/^.*[\\/]/, "").slice(0, 120), sizeBytes: data.length, fileCount: 0, issues: [], conflict: "none", course: null,
      ok: false, checks: [{ label: "Read the archive safely", ok: false, detail: message }],
    };
  }
  try {
    return summarizePackage(ctx, x.pkgDir, {
      fileName: x.label.slice(4),
      sizeBytes: data.length,
      fileCount: x.fileCount,
      url: x.label,
      path: "",
      checks: [{ label: "Read the archive safely", ok: true, detail: `${x.fileCount} files` }, { label: "Find course.yaml", ok: true }],
    });
  } finally {
    rmSync(x.tmp, { recursive: true, force: true });
  }
}

/**
 * The checks and the chapter / lesson / quiz summary behind the add popup, shared by zips and repos so both run
 * exactly the same validation. `checks` already holds the steps that got the folder here.
 */
function summarizePackage(
  ctx: Ctx,
  pkgDir: string,
  src: { fileName: string; sizeBytes: number; fileCount: number; url: string; path: string; checks: PackagePreview["checks"] },
): PackagePreview {
  const base = { fileName: src.fileName, sizeBytes: src.sizeBytes, fileCount: src.fileCount, issues: [], conflict: "none" as const, course: null };
  const checks = [...src.checks];
  {
    const result = validateCoursePackage(pkgDir);
    if (!result.ok || !result.manifest) {
      checks.push({ label: "Validate the package", ok: false, detail: `${result.issues.length} problem${result.issues.length === 1 ? "" : "s"}` });
      return { ...base, ok: false, checks, issues: result.issues.slice(0, 50) };
    }
    const loaded = loadCourse(pkgDir, "/api");
    if (!loaded) {
      checks.push({ label: "Validate the package", ok: false, detail: "the package could not be loaded" });
      return { ...base, ok: false, checks };
    }
    checks.push({ label: "Validate the package", ok: true, detail: "lessons, quizzes, exams and sources" });

    const id = loaded.id;
    const prev = ctx.db.select().from(packages).where(eq(packages.id, id)).get();
    const taken = existsSync(join(resolve(ctx.catalog.coursesDir), id));
    const removed = removedIds(ctx.db).has(id);
    const conflict: PackagePreview["conflict"] = !taken || removed ? "none" : sameSource(prev, src.url, src.path) ? "update" : "clash";
    checks.push(
      conflict === "clash"
        ? { label: "Course id is free", ok: false, detail: `"${id}" is already installed from a different source` }
        : { label: "Course id is free", ok: true, detail: conflict === "update" ? "this replaces the version you have" : removed ? "you removed it earlier; this adds it back, from zero" : id },
    );

    const quizzesByLesson = new Map([...loaded.quizzes.values()].map((q) => [q.lessonId, q.quiz]));
    const chapters = loaded.manifest.chapters.map((ch) => ({
      dir: ch.dir,
      title: ch.title,
      lessons: loaded.lessons
        .filter((l) => l.chapterDir === ch.dir)
        .map((l) => {
          const quiz = quizzesByLesson.get(l.id);
          return { id: l.id, title: l.title, quiz: quiz ? { title: quiz.title, questions: quiz.questions.length, types: [...new Set(quiz.questions.map((q) => q.type))] } : null };
        }),
    }));
    const questionCount = [...loaded.quizzes.values()].reduce((n, q) => n + q.quiz.questions.length, 0);
    return {
      ...base,
      ok: conflict !== "clash",
      checks,
      conflict,
      course: {
        id,
        title: loaded.manifest.title,
        shortIntro: loaded.manifest.short_intro,
        level: loaded.manifest.level,
        lessonCount: loaded.lessons.length,
        quizCount: loaded.quizzes.size,
        questionCount,
        examCount: loaded.exams.length,
        chapters,
        exams: loaded.exams.map((e) => ({ id: e.id, title: e.blueprint.title, minutes: e.blueprint.duration_minutes, questions: e.blueprint.limit_questions })),
      },
    };
  }
}

export const insideDir = (root: string, p: string) => {
  const rel = relative(resolve(root), resolve(p));
  return !!rel && !rel.startsWith("..") && !isAbsolute(rel) && !rel.split(sep).includes("..");
};
