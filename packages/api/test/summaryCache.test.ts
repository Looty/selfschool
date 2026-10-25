import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { summaryStats } from "../src/summaryCache.js";
import { miniCourses, passQuiz1, setup } from "./helpers.js";

const titleIn = (json: any) => json.courses.find((c: any) => c.id === "mini").title as string;

describe("summary cache", () => {
  it("answers a repeat request from the cache without recomputing", async () => {
    const h = setup();
    const first = await h.get("/courses");
    const afterFirst = summaryStats(h.db);
    expect(afterFirst.misses).toBeGreaterThan(0);

    const second = await h.get("/courses");
    const afterSecond = summaryStats(h.db);
    expect(second.json).toEqual(first.json);
    expect(afterSecond.misses).toBe(afterFirst.misses);
    expect(afterSecond.hits).toBeGreaterThan(afterFirst.hits);

    await h.get("/dashboard");
    const dash = summaryStats(h.db);
    await h.get("/dashboard");
    expect(summaryStats(h.db).misses).toBe(dash.misses);
  });

  it("a progress write refreshes the dashboard, the course list and the course page", async () => {
    const h = setup();
    expect((await h.get("/dashboard")).json.courses[0]).toMatchObject({ percent: 0, started: false });
    expect((await h.get("/courses")).json.courses[0]).toMatchObject({ percent: 0, started: false });
    expect((await h.get("/courses/mini")).json.progress.done).toBe(0);

    await passQuiz1(h);
    expect((await h.post("/courses/mini/lessons/a1/complete")).status).toBe(200);

    const dash = (await h.get("/dashboard")).json;
    expect(dash.continue).toMatchObject({ lesson: { id: "a2" }, progress: { done: 1 } });
    expect(dash.courses[0]).toMatchObject({ percent: 33, started: true });
    expect((await h.get("/courses")).json.courses[0]).toMatchObject({ percent: 33, started: true });
    const detail = (await h.get("/courses/mini")).json;
    expect(detail.progress.done).toBe(1);
    expect(detail.resume).toMatchObject({ id: "a2" });
    expect(detail.chapters[0].lessons[0].status).toBe("done");
  });

  it("any write on the connection, even one that bypasses the app code, invalidates", async () => {
    const h = setup();
    await h.get("/courses");
    const before = summaryStats(h.db).misses;
    h.db.$client.prepare("insert into xp_event (at, amount, reason, ref) values (1, 1, 'test', 'x')").run();
    await h.get("/courses");
    expect(summaryStats(h.db).misses).toBeGreaterThan(before);
  });

  it("a catalog change refreshes the summaries", async () => {
    const dir = miniCourses();
    const h = setup({ coursesDir: dir });
    expect(titleIn((await h.get("/courses")).json)).not.toBe("Renamed");
    expect(titleIn((await h.get("/dashboard")).json)).not.toBe("Renamed");

    const file = join(dir, "mini", "course.yaml");
    writeFileSync(file, readFileSync(file, "utf8").replace(/^title: .*/m, "title: Renamed"));

    expect(titleIn((await h.get("/courses")).json)).toBe("Renamed");
    expect(titleIn((await h.get("/dashboard")).json)).toBe("Renamed");
    expect((await h.get("/courses/mini")).json.title).toBe("Renamed");
  });
});
