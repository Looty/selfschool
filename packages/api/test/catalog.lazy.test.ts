import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Catalog } from "../src/catalog.js";
import { fixtureDir, miniCourses } from "./helpers.js";

/** A courses folder with `n` copies of the mini fixture under different ids. */
function manyCourses(n: number): string {
  const dir = mkdtempSync(join(tmpdir(), "selfschool-lazy-"));
  for (let i = 1; i <= n; i++) {
    const d = join(dir, `m${i}`);
    cpSync(fixtureDir("mini"), d, { recursive: true });
    const f = join(d, "course.yaml");
    writeFileSync(f, readFileSync(f, "utf8").replace(/^id: .*/m, `id: m${i}`));
  }
  return dir;
}

describe("catalog lazy loading", () => {
  it("has the light part without bodies and fills the heavy part on first access", () => {
    const cat = new Catalog({ coursesDir: miniCourses() });
    const [course] = cat.load().courses;
    expect(course!.light.lessons.length).toBe(3);
    expect(course!.light.sourceCount).toBeGreaterThan(0);
    expect(course!.light.lessons[0]).not.toHaveProperty("body");
    expect(course!.light.sourceCount).toBe(course!.sources.length);
    expect(course!.lessons[0]!.body.length).toBeGreaterThan(0);
    expect(course!.lessonById.get(course!.lessons[0]!.id)).toBe(course!.lessons[0]);
    expect(course!.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("keeps only the most recently opened courses in memory and reloads dropped ones transparently", () => {
    const cat = new Catalog({ coursesDir: manyCourses(5), maxLoadedCourses: 2 });
    const { courses } = cat.load();
    expect(courses).toHaveLength(5);
    expect(cat.stats.loaded).toBeLessThanOrEqual(2);
    for (const c of courses) expect(c.lessons.length).toBe(3);
    expect(cat.stats.loaded).toBe(2);
    // the first one was dropped, and comes back with the same content
    const first = courses[0]!;
    expect(first.quizzes.size).toBe(2);
    expect(cat.stats.loaded).toBe(2);
  });

  it("an unchanged course keeps its identity between loads; an edited one gets new content", () => {
    const dir = miniCourses();
    const cat = new Catalog({ coursesDir: dir });
    const a = cat.load().courses[0]!;
    expect(cat.load().courses[0]).toBe(a);
    const file = join(dir, "mini", "c1", "lesson-01.md");
    writeFileSync(file, readFileSync(file, "utf8") + "\nEdited line.\n");
    const b = cat.load();
    expect(b.changed).toBe(true);
    expect(b.courses[0]!.lessons[0]!.body).toContain("Edited line.");
    expect(b.courses[0]!.contentHash).not.toBe(a.contentHash);
  });

  it("skips an invalid course with a warning", () => {
    const dir = miniCourses();
    writeFileSync(join(dir, "mini", "sources.md"), "x");
    rmSyncSafe(join(dir, "mini", "exams", "final.yaml"));
    const cat = new Catalog({ coursesDir: dir });
    expect(cat.load().courses).toHaveLength(0);
  });
});

function rmSyncSafe(p: string) {
  writeFileSync(p, ": : not yaml [");
}

describe("adaptive re-check", () => {
  it("waits at least five times the last check, and longer when idle", () => {
    const cat = new Catalog({ coursesDir: miniCourses(), recheckMs: 100, idleAfterMs: 1_000_000, idleRecheckMs: 5000 });
    expect(cat.recheckWaitMs).toBe(100);
    (cat as unknown as { checkMs: number }).checkMs = 400;
    expect(cat.recheckWaitMs).toBe(2000);
    (cat as unknown as { requestGap: number }).requestGap = 2_000_000;
    expect(cat.recheckWaitMs).toBe(5000);
  });

  it("is 0 when the interval is 0 (check on every call)", () => {
    const cat = new Catalog({ coursesDir: miniCourses(), recheckMs: 0 });
    (cat as unknown as { checkMs: number }).checkMs = 400;
    expect(cat.recheckWaitMs).toBe(0);
  });
});
