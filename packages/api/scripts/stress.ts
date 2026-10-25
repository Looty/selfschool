/**
 * Stress test for the course catalog: builds N fake courses, times the catalog and the API on them, then removes
 * every fake course again. OFF BY DEFAULT: nothing runs it unless you do.
 *
 *   pnpm --filter @selfschool/api stress                  100 courses in a temp folder (never touches your courses)
 *   pnpm --filter @selfschool/api stress -- --courses 300 a different size
 *   pnpm --filter @selfschool/api stress -- --live         fake courses go into the real courses folder, so the running app shows them
 *   pnpm --filter @selfschool/api stress -- --clean        only remove leftovers, then exit
 *
 * Auto-heal: a fake course is a folder named `zz-stress-NNN` that also contains a `.selfschool-stress` marker file.
 * Only folders with both are ever deleted. Leftovers are swept before every run, after every run (also on error), on
 * Ctrl+C and on exit, so a crashed run is healed by the next one (or by `--clean`).
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, defaultCoursesDir } from "../src/app.js";
import { Catalog, listFiles, listFilesAsync } from "../src/catalog.js";
import { openDb } from "../src/db/client.js";

const PREFIX = "zz-stress-";
const MARKER = ".selfschool-stress";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string, fallback: number) => {
  const i = args.indexOf(`--${name}`);
  const n = i >= 0 ? Number(args[i + 1]) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

const COURSES = value("courses", 100);
const CHAPTERS = value("chapters", 6);
const LESSONS_PER_CHAPTER = value("lessons", 6);
const live = flag("live");

/** Removes fake courses under `root`: folder name prefix AND marker file, nothing else. Returns how many. */
export function sweep(root: string): number {
  if (!existsSync(root)) return 0;
  let removed = 0;
  for (const name of readdirSync(root)) {
    const dir = join(root, name);
    if (name.startsWith(PREFIX) && existsSync(join(dir, MARKER))) {
      rmSync(dir, { recursive: true, force: true });
      removed++;
    }
  }
  return removed;
}

const words = "the model reads a token and predicts the next one from the text it has seen so far".split(" ");
const paragraph = (seed: number, n = 60) => Array.from({ length: n }, (_, i) => words[(seed + i * 7) % words.length]).join(" ");

function makeCourse(root: string, index: number) {
  const id = `${PREFIX}${String(index).padStart(3, "0")}`;
  const dir = join(root, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, MARKER), "created by the stress test; safe to delete\n");
  const chapters = Array.from({ length: CHAPTERS }, (_, c) => `${String(c + 1).padStart(2, "0")}-chapter`);
  writeFileSync(
    join(dir, "course.yaml"),
    `schemaVersion: 1\nid: ${id}\ntitle: Stress course ${index}\nshort_intro: A fake course for load testing.\nlevel: Beginner\nchapters:\n${chapters.map((d, c) => `  - {dir: ${d}, title: Chapter ${c + 1}}`).join("\n")}\nexams: []\n`,
  );
  writeFileSync(join(dir, "sources.md"), "1. [Stress source](https://example.com) · accessed 2026-01-01 · reliability: low\n");
  let n = 0;
  chapters.forEach((ch, c) => {
    mkdirSync(join(dir, ch), { recursive: true });
    for (let l = 1; l <= LESSONS_PER_CHAPTER; l++) {
      n++;
      const lesson = `lesson-${String(l).padStart(2, "0")}.md`;
      const quiz = `quiz-${String(l).padStart(2, "0")}.yaml`;
      writeFileSync(
        join(dir, ch, lesson),
        `---\nid: l${n}\ntitle: Lesson ${n}\nquiz: ${quiz}\nresources: []\nsources: [1]\n---\nAfter this lesson you can read fake text.\n\n## Section\n\n${paragraph(n)}. [1]\n\n${paragraph(n + 3, 120)}.\n\n:::key-takeaways\n- Fake point ${n}.\n:::\n`,
      );
      writeFileSync(
        join(dir, ch, quiz),
        `schemaVersion: 1\nid: q${n}\ntitle: "Check ${n}"\nquestions:\n  - {id: q${n}-1, type: short, text: "Question ${n}?", answers: [answer]}\n`,
      );
    }
  });
  return dir;
}

const ms = (t0: number) => `${Math.round(performance.now() - t0)} ms`;
const row = (label: string, value: string) => console.log(`  ${label.padEnd(52)}${value}`);

async function main() {
  const root = live ? defaultCoursesDir() : mkdtempSync(join(tmpdir(), "selfschool-stress-"));
  const heal = () => {
    try {
      sweep(root);
      if (!live) rmSync(root, { recursive: true, force: true });
    } catch (e) {
      console.error(`could not clean ${root}: ${(e as Error).message}`);
    }
  };
  // Heal on every way out: normal end, error, Ctrl+C, kill, and an exit that skipped the finally.
  process.on("exit", heal);
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(sig, () => process.exit(130));

  if (flag("clean")) {
    console.log(`removed ${sweep(root)} leftover fake course(s) from ${root}`);
    return;
  }

  const leftovers = sweep(root);
  if (leftovers) console.log(`healed: removed ${leftovers} leftover fake course(s) from an earlier run`);
  console.log(`stress test: ${COURSES} fake courses (${CHAPTERS} chapters x ${LESSONS_PER_CHAPTER} lessons each) in ${root}${live ? "  [live: the running app will show them]" : ""}\n`);

  let t0 = performance.now();
  for (let i = 1; i <= COURSES; i++) makeCourse(root, i);
  const files = listFiles(root).length;
  row(`created ${COURSES} courses, ${files} files in the folder`, ms(t0));

  console.log("\nfile walking");
  t0 = performance.now();
  listFiles(root);
  row("sync walk (old way; blocked requests)", ms(t0));
  t0 = performance.now();
  await listFilesAsync(root);
  row("async parallel walk (background check)", ms(t0));

  console.log("\ncatalog");
  // Run with `node --expose-gc` (tsx --expose-gc) for a heap figure without garbage; RSS alone lags behind frees.
  const rss = () => {
    (globalThis as { gc?: () => void }).gc?.();
    const m = process.memoryUsage();
    return `${Math.round(m.rss / 1048576)} MB RSS, ${Math.round(m.heapUsed / 1048576)} MB heap`;
  };
  const cacheDir = mkdtempSync(join(tmpdir(), "selfschool-stress-cache-"));
  process.on("exit", () => rmSync(cacheDir, { recursive: true, force: true }));
  const cat = new Catalog({ coursesDir: root, recheckMs: 3000, cacheDir });
  t0 = performance.now();
  const first = cat.load();
  row(`first load of ${first.courses.length} courses (reads everything)`, ms(t0));
  row("  memory after first load (RSS)", rss());
  await cat.flushCache();
  t0 = performance.now();
  cat.load();
  row("repeat load (cached)", ms(t0));
  t0 = performance.now();
  const listed = first.courses.reduce((n, c) => n + c.light.lessons.length, 0);
  row(`list ${listed} lessons from the light part, no bodies read`, ms(t0));
  t0 = performance.now();
  for (const c of first.courses) c.lessons.length;
  row(`open every course (bodies, LRU keeps ${cat.stats.loaded})`, ms(t0));
  row("  memory after opening all (RSS)", rss());

  console.log("\nrestart with a warm disk cache (new Catalog, same cache folder)");
  const restarted = new Catalog({ coursesDir: root, recheckMs: 3000, cacheDir });
  t0 = performance.now();
  await restarted.warmUp();
  row(`background warm-up, ${restarted.stats.courses} courses from the saved copy`, ms(t0));
  row("  memory (RSS)", rss());
  t0 = performance.now();
  const viaCache = restarted.load();
  row(`first load after restart, changed=${viaCache.changed}, bodies in memory: ${restarted.stats.loaded}`, ms(t0));
  const cold = new Catalog({ coursesDir: root, recheckMs: 3000 });
  t0 = performance.now();
  await cold.warmUp();
  row("background warm-up with NO cache, for comparison", ms(t0));
  console.log("");

  const edited = String(Math.ceil(COURSES / 2)).padStart(3, "0");
  const lessonFile = join(root, `${PREFIX}${edited}`, "01-chapter", "lesson-01.md");
  appendFileSync(lessonFile, "\nAn edit.\n");
  t0 = performance.now();
  await cat.refresh();
  const after = cat.load();
  row(`edit one lesson, background re-check, changed=${after.changed}`, ms(t0));
  t0 = performance.now();
  await cat.refresh();
  row("background re-check with nothing changed", ms(t0));
  row(`  adaptive wait before the next check (recheckMs 3000)`, `${cat.recheckWaitMs} ms (last check ${cat.stats.lastCheckMs} ms)`);

  console.log("\nAPI (in-process)");
  const app = createApp(openDb(":memory:"), { pollIntervalMs: 10, coursesDir: root, catalogRecheckMs: 3000 });
  for (const path of ["/courses", "/courses", "/dashboard", `/courses/${PREFIX}001`, `/courses/${PREFIX}001/lessons/l1`]) {
    t0 = performance.now();
    const res = await app.request(path);
    await res.text();
    row(`GET ${path} -> ${res.status}`, ms(t0));
  }
  console.log(`\nmemory: ${Math.round(process.memoryUsage().rss / 1048576)} MB resident`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => console.log("\ncleaned up: every fake course removed"));
