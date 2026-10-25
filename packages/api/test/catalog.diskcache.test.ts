import { appendFileSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { Catalog } from "../src/catalog.js";
import { miniCourses } from "./helpers.js";

const cacheDir = () => mkdtempSync(join(tmpdir(), "selfschool-cache-"));

async function start(coursesDir: string, dir: string) {
  const cat = new Catalog({ coursesDir, cacheDir: dir });
  const courses = cat.load().courses;
  await cat.flushCache();
  return { cat, courses };
}

describe("catalog disk cache", () => {
  it("writes nothing unless a cache folder is given", async () => {
    const cat = new Catalog({ coursesDir: miniCourses() });
    cat.load();
    await cat.flushCache();
  });

  it("restarts from the saved copy without reading lesson files, and gets the same data", async () => {
    const courses = miniCourses();
    const dir = cacheDir();
    const first = (await start(courses, dir)).courses[0]!;
    expect(readdirSync(dir).filter((n) => n.endsWith(".json"))).toHaveLength(1);

    const second = new Catalog({ coursesDir: courses, cacheDir: dir });
    const adopted = second.load().courses[0]!;
    expect(adopted).not.toBe(first);
    expect(adopted.contentHash).toBe(first.contentHash);
    expect(adopted.manifest).toEqual(first.manifest);
    expect(adopted.exams).toEqual(first.exams);
    expect(adopted.light.sourceCount).toBe(first.light.sourceCount);
    expect(adopted.light.lessons).toEqual(first.light.lessons);
    expect(adopted.light.quizQuestions).toEqual(first.light.quizQuestions);
    expect(second.stats.loaded).toBe(0); // nothing read besides the fingerprints
    // bodies still load on demand, identical to the original
    expect(adopted.lessons).toEqual(first.lessons);
    expect(adopted.sourcesMd).toBe(first.sourcesMd);
  });

  it("re-reads a course whose files changed since the copy was saved", async () => {
    const courses = miniCourses();
    const dir = cacheDir();
    const { courses: [first] } = await start(courses, dir);
    appendFileSync(join(courses, "mini", "c1", "lesson-01.md"), "\nNew text after restart.\n");
    const again = new Catalog({ coursesDir: courses, cacheDir: dir }).load().courses[0]!;
    expect(again.contentHash).not.toBe(first!.contentHash);
    expect(again.lessons[0]!.body).toContain("New text after restart.");
  });

  it.each([
    ["garbage", () => "{ not json"],
    ["an old version", (t: string) => t.replace('"v":1', '"v":0')],
    ["partial", (t: string) => t.slice(0, t.length / 2)],
    ["mismatching counts", (t: string) => t.replace(/"counts":\{"lessons":\d+/, '"counts":{"lessons":99')],
  ])("ignores a cache file that is %s and rebuilds it", async (_name, damage) => {
    const courses = miniCourses();
    const dir = cacheDir();
    const { courses: [first] } = await start(courses, dir);
    const file = join(dir, readdirSync(dir).find((n) => n.endsWith(".json"))!);
    writeFileSync(file, damage(readFileSync(file, "utf8")));
    const cat = new Catalog({ coursesDir: courses, cacheDir: dir });
    const c = cat.load().courses[0]!;
    expect(cat.stats.loaded).toBe(1); // rebuilt from the files, not adopted
    expect(c.contentHash).toBe(first!.contentHash);
    await cat.flushCache();
    expect(JSON.parse(readFileSync(file, "utf8")).v).toBe(1);
  });

  it("does not warn again for a valid cached course, and drops the saved copy of a removed course", async () => {
    const courses = miniCourses();
    const dir = cacheDir();
    await start(courses, dir);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cat = new Catalog({ coursesDir: courses, cacheDir: dir });
    cat.load();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
    const empty = mkdtempSync(join(tmpdir(), "selfschool-empty-"));
    const gone = new Catalog({ coursesDir: empty, cacheDir: dir });
    gone.load();
    await gone.flushCache();
    expect(readdirSync(dir).filter((n) => n.endsWith(".json"))).toHaveLength(0);
  });

  it("the background refresh adopts the saved copy too", async () => {
    const courses = miniCourses();
    const dir = cacheDir();
    await start(courses, dir);
    const cat = new Catalog({ coursesDir: courses, cacheDir: dir, recheckMs: 600 });
    await cat.refresh();
    expect(cat.stats.courses).toBe(1);
    expect(cat.stats.loaded).toBe(0);
    expect(cat.load().courses[0]!.lessons).toHaveLength(3);
  });
});
