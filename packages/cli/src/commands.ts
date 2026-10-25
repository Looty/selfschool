import { existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { newCourseId } from "@selfschool/shared";
import { validateCoursePackage, validateExtensionOverlay } from "@selfschool/shared/node";
import { createAdapter, loadConfig, runLoop } from "@selfschool/runner";
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
