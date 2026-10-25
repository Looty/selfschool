import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { miniCourses, passQuiz1, setup } from "./helpers.js";

const xpEvents = (h: ReturnType<typeof setup>) => (h.db.$client.prepare("SELECT COALESCE(SUM(amount), 0) AS n FROM xp_event").get() as { n: number }).n;

describe("removing a course", () => {
  it("summarises what goes, then removes the course and all its progress, and touches no file", async () => {
    const dir = miniCourses();
    const h = setup({ coursesDir: dir });
    await passQuiz1(h);
    const xpBefore = xpEvents(h);
    expect(xpBefore).toBeGreaterThan(0);

    const summary = (await h.get("/packages/mini/removal")).json;
    expect(summary.id).toBe("mini");
    expect(summary.attempts).toBe(1);
    expect(summary.bankQuestions).toBeGreaterThan(0);
    expect(summary.xp).toBeGreaterThan(0);

    expect((await h.call("DELETE", "/packages/mini")).status).toBe(200);

    expect((await h.get("/courses")).json.courses.map((c: any) => c.id)).not.toContain("mini");
    expect((await h.get("/packages/mini/removal")).status).toBe(404);
    expect((await h.get("/packages")).json.packages).toHaveLength(0);
    expect(xpEvents(h)).toBeLessThan(xpBefore);
    expect(xpEvents(h)).toBe(0);
    // the folder is exactly where it was
    expect(existsSync(join(dir, "mini", "course.yaml"))).toBe(true);
    expect(existsSync(join(dir, ".trash"))).toBe(false);
  });

  it("stays removed on later loads, is listed as removed, and restores from zero", async () => {
    const dir = miniCourses();
    const h = setup({ coursesDir: dir });
    await passQuiz1(h);
    await h.call("DELETE", "/packages/mini");
    await h.get("/courses");
    expect((await h.get("/courses")).json.courses).toHaveLength(0);
    expect((await h.get("/packages/removed")).json.courses).toEqual([{ id: "mini", title: expect.any(String), folder: "mini" }]);

    expect((await h.post("/packages/mini/restore")).status).toBe(200);
    expect((await h.get("/courses")).json.courses.map((c: any) => c.id)).toEqual(["mini"]);
    expect((await h.get("/packages/removed")).json.courses).toEqual([]);
    expect((await h.get("/packages/mini/removal")).json.attempts).toBe(0); // progress did not come back
    expect((await h.post("/packages/mini/restore")).status).toBe(404);
  });

  it("answers 404 for a course that is not installed", async () => {
    const h = setup();
    expect((await h.call("DELETE", "/packages/nope")).status).toBe(404);
  });

  it("lets a removed course be imported again, from a local folder", async () => {
    const dir = miniCourses();
    const h = setup({ coursesDir: dir });
    await h.get("/courses");
    await h.call("DELETE", "/packages/mini");
    const src = join(dir, "mini");
    const preview = (await h.post("/packages/preview", { url: src, path: "", ref: "main" })).json;
    expect(preview.conflict).toBe("none");
    expect(preview.checks.at(-1).detail).toMatch(/removed it earlier/);
  });
});
