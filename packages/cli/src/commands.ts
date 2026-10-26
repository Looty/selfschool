import { existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { LANGUAGE_CODE, newCourseId } from "@selfschool/shared";
import { validateCoursePackage, validateExtensionOverlay } from "@selfschool/shared/node";
import { createAdapter, loadConfig, runLoop } from "@selfschool/runner";
import { estimate, languageName, translateCourse, unitsOf } from "./translate.js";
import { runDoctor, fetchHealth } from "./doctor.js";
import { apiUrl, clearPid, compose, findRoot, readRunnerPid, writePid } from "./root.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** `docker compose up -d`, then the runner in the foreground. Ctrl+C stops the runner and runs `compose down`. */
export async function up(): Promise<number> {
  const root = findRoot();
  if (readRunnerPid(root)) {
    console.error("a runner is already running; use `school down` first");
    return 1;
  }
  if (compose(root, ["up", "-d"]) !== 0) return 1;

  const cfg = loadConfig();
  process.stdout.write(`waiting for api at ${cfg.apiUrl} `);
  for (let i = 0; ; i++) {
    try {
      if ((await fetchHealth(cfg.apiUrl)).ok) break;
    } catch {
      /* not up yet */
    }
    if (i >= 60) {
      console.error("\napi did not become healthy in 60s (see `docker compose logs api`)");
      return 1;
    }
    process.stdout.write(".");
    await sleep(1000);
  }
  console.log(" ok");
  // 127.0.0.1, not localhost: Docker publishes IPv4 only and some clients wait on IPv6 first
  console.log("web: http://127.0.0.1:" + (process.env.WEB_PORT || 5174));

  writePid(root);
  const ac = new AbortController();
  for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => ac.abort());
  try {
    await runLoop({ cfg, adapter: createAdapter(cfg), signal: ac.signal, log: (m) => console.log(`[runner] ${m}`) });
  } finally {
    clearPid(root);
    console.log("stopping containers...");
    compose(root, ["down"]);
  }
  return 0;
}

/** Stops a running `school up` (if any) and runs `compose down`. */
export function down(): number {
  const root = findRoot();
  const pid = readRunnerPid(root);
  if (pid) {
    try {
      process.kill(pid);
      console.log(`stopped runner (pid ${pid})`);
    } catch (e) {
      console.error(`could not stop runner pid ${pid}: ${(e as Error).message}`);
    }
    clearPid(root);
  }
  return compose(root, ["down"]);
}

export async function doctor(argv: string[]): Promise<number> {
  const checks = await runDoctor({ ai: argv.includes("--ai"), apiUrl: apiUrl() });
  for (const c of checks) console.log(`${c.ok ? "ok  " : "FAIL"} ${c.name.padEnd(17)} ${c.detail}`);
  if (!argv.includes("--ai")) console.log("(skipped: live claude call; pass --ai to run one cheap haiku call)");
  return checks.every((c) => c.ok) ? 0 : 1;
}

/** `school new-id <title>`: prints a unique course id such as `python-basics-k3x9f2`. */
export function newId(argv: string[]): number {
  const title = argv.join(" ").trim();
  if (!title) {
    console.log("usage: school new-id <course title>");
    return 1;
  }
  console.log(newCourseId(title));
  return 0;
}

const flagValue = (argv: string[], name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i !== -1 ? argv[i + 1] : undefined;
};

/** A course folder given as a path, or as an id looked up in the courses folder. */
export function findCourseDir(arg: string, env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): string | null {
  if (existsSync(join(arg, "course.yaml"))) return resolve(arg);
  const roots: string[] = [];
  if (env.SELFSCHOOL_COURSES_DIR) roots.push(resolve(env.SELFSCHOOL_COURSES_DIR));
  try {
    roots.push(join(findRoot(cwd, env), "courses"), join(findRoot(cwd, env), "..", "selfschool-courses"));
  } catch {
    /* not inside the repo: only the env var and the path itself count */
  }
  for (const r of roots) if (existsSync(join(r, arg, "course.yaml"))) return join(r, arg);
  return null;
}

/** Where `school translate` writes: the app's extensions folder (`extensions/<id>/i18n/<lang>`), or the package itself. */
export function translationOutDir(courseDir: string, courseId: string, lang: string, o: { intoPackage: boolean; extensions?: string | undefined }, env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): string {
  if (o.intoPackage) return join(courseDir, "i18n", lang);
  let base = o.extensions ?? env.SELFSCHOOL_EXTENSIONS_DIR;
  if (!base) {
    try {
      base = join(findRoot(cwd, env), "extensions");
    } catch {
      base = join(cwd, "extensions");
    }
  }
  return join(resolve(base), courseId, "i18n", lang);
}

/**
 * `school translate <course> --lang <code>`: translates a course with the Claude CLI into `extensions/<id>/i18n/<lang>/`
 * (yours, never touching the package), or `--into-package` for an author's own `i18n/<lang>/`. Resumes where it stopped
 * (`--force` starts over); `--dry-run` only sizes the job.
 */
export async function translate(argv: string[]): Promise<number> {
  const valueFlags = new Set(["--lang", "--model", "--extensions", "--concurrency", "--chapter"]);
  const course = argv.find((a, i) => !a.startsWith("-") && !(i > 0 && valueFlags.has(argv[i - 1]!)));
  const lang = flagValue(argv, "--lang");
  if (!course || !lang) {
    console.log("usage: school translate <course folder or id> --lang <code> [--chapter <folder[,folder]>] [--into-package] [--extensions <dir>] [--model <name>] [--concurrency <n>] [--force] [--dry-run]");
    return 1;
  }
  if (!LANGUAGE_CODE.test(lang)) {
    console.error(`"${lang}" is not a language code (use he, ar, pt-BR, ...)`);
    return 1;
  }
  const courseDir = findCourseDir(course);
  if (!courseDir) {
    console.error(`no course "${course}": give its folder, or its id with SELFSCHOOL_COURSES_DIR set`);
    return 1;
  }
  const check = validateCoursePackage(courseDir);
  if (!check.ok || !check.manifest) {
    console.error(`the course does not validate (run \`school validate\`): ${check.issues[0]?.file}: ${check.issues[0]?.message}`);
    return 1;
  }
  if (lang === check.manifest.language) {
    console.error(`the course is already written in ${lang}`);
    return 1;
  }
  const outDir = translationOutDir(courseDir, check.manifest.id, lang, { intoPackage: argv.includes("--into-package"), extensions: flagValue(argv, "--extensions") });

  const chapters = flagValue(argv, "--chapter")?.split(",").map((c) => c.trim()).filter(Boolean);
  const unknown = chapters?.filter((c) => !check.manifest!.chapters.some((x) => x.dir === c));
  if (unknown?.length) {
    console.error(`no chapter folder ${unknown.join(", ")} in this course; folders are: ${check.manifest.chapters.map((c) => c.dir).join(", ")}`);
    return 1;
  }
  const units = unitsOf(courseDir).filter((u) => !chapters?.length || chapters.includes(u.file.split("/")[0]!));
  const est = estimate(units);
  console.log(`${check.manifest.title}: ${est.files} files (${units.filter((u) => u.kind === "lesson").length} lessons, ${units.filter((u) => u.kind === "quiz").length} quizzes) into ${languageName(lang)}`);
  console.log(`rough size: ${(est.inputTokens / 1000).toFixed(0)}K tokens in, ${(est.outputTokens / 1000).toFixed(0)}K out, about $${est.usd.toFixed(2)} at Claude Sonnet 5.5 API prices (plus ~30% for retries and review)`);
  console.log(`writing to ${outDir}`);
  if (argv.includes("--dry-run")) return 0;

  const cfg = loadConfig();
  const report = await translateCourse({
    courseDir,
    outDir,
    lang,
    adapter: createAdapter(cfg),
    model: flagValue(argv, "--model") ?? cfg.modelStrong,
    force: argv.includes("--force"),
    concurrency: Number(flagValue(argv, "--concurrency")) || 3,
    ...(chapters?.length ? { chapters } : {}),
    log: (m) => console.log(m),
  });
  console.log(`done: ${report.translated.length} written, ${report.kept.length} already translated, ${report.failed.length} failed${report.costUsd ? `, reported cost $${report.costUsd.toFixed(2)}` : ""}`);
  for (const f of report.failed) console.log(`  FAILED ${f.file}: ${f.reason}`);
  if (report.failed.length) console.log("run the same command again to retry only the failed files (they fall back to the original language until then)");
  return report.failed.length ? 1 : 0;
}

/**
 * `school validate [dir] [--package <course dir>]`. A folder with `extension.yaml` and no `course.yaml` is an
 * extensions folder (`extensions/<course-id>/`); it is also checked against the course package for collisions,
 * found at `courses/<same name>` beside `extensions/` unless `--package` says otherwise.
 */
export function validate(argv: string[]): number {
  const flag = argv.indexOf("--package");
  const packageArg = flag !== -1 ? argv[flag + 1] : undefined;
  const dir = argv.find((a, i) => !a.startsWith("-") && (flag === -1 || i !== flag + 1)) ?? ".";

  if (existsSync(join(dir, "extension.yaml")) && !existsSync(join(dir, "course.yaml"))) {
    const guess = join(dirname(dirname(resolve(dir))), "courses", basename(resolve(dir)));
    const pkg = packageArg ?? (existsSync(join(guess, "course.yaml")) ? guess : undefined);
    const r = validateExtensionOverlay(dir, pkg);
    for (const i of r.issues) console.log(`${i.file}: ${i.message}`);
    console.log(r.ok ? `ok: extensions for ${basename(resolve(dir))}${pkg ? "" : " (course package not found: collisions not checked)"}` : `${r.issues.length} issue(s)`);
    return r.ok ? 0 : 1;
  }

  const r = validateCoursePackage(dir);
  for (const i of r.issues) console.log(`${i.file}: ${i.message}`);
  for (const w of r.warnings ?? []) console.log(`warning: ${w.file}: ${w.message}`);
  console.log(r.ok ? `ok: ${r.manifest?.id}${r.warnings?.length ? ` (${r.warnings.length} warning(s))` : ""}` : `${r.issues.length} issue(s)`);
  return r.ok ? 0 : 1;
}
