import { describe, expect, it } from "vitest";
import { passQuiz1, repoCourses, setup } from "./helpers.js";

describe("dashboard", () => {
  it("fresh install: continue card points at the first lesson, empty activity", async () => {
    const h = setup();
    const { status, json } = await h.get("/dashboard");
    expect(status).toBe(200);
    expect(json.continue).toMatchObject({
      course: { id: "mini" }, lesson: { id: "a1" }, lessonNumber: 1, lessonTotal: 3, chapterTitle: "Chapter One",
      progress: { done: 0, total: 3, percent: 0 }, upNext: { id: "a2" },
    });
    expect(json.activity).toHaveLength(112);
    expect(json.activity.every((c: any) => c.level === 0)).toBe(true);
    expect(json.week).toMatchObject({ streakDays: 0, studiedMinutes: 0, questionsAnswered: 0 });
    expect(json.week.days).toHaveLength(7);
    expect(json.week.days.filter((d: any) => d.today)).toHaveLength(1);
    expect(json.weakSpots).toEqual([]);
    expect(json.pendingGrading).toBe(0);
  });

  it("aggregates streak, week stats, activity, pending grading and weak spots", async () => {
    const h = setup();
    await passQuiz1(h);
    await h.post("/courses/mini/lessons/a1/complete");

    // a weak concept: wrong mcq on "shape", plus an ungraded open answer
    const a = (await h.post("/courses/mini/quizzes/qz1/attempts")).json.attemptId;
    await h.post(`/attempts/${a}/answers/mini:a-mcq`, { type: "mcq", selected: [0] });
    await h.post(`/attempts/${a}/answers/mini:a-open`, { type: "open", text: "pending one" });

    const { json } = await h.get("/dashboard");
    expect(json.continue).toMatchObject({ lesson: { id: "a2" }, lessonNumber: 2, progress: { done: 1 } });
    expect(json.week.streakDays).toBe(1);
    expect(json.week.questionsAnswered).toBe(5);
    expect(json.activity.at(-1).level).toBeGreaterThanOrEqual(3);
    expect(json.pendingGrading).toBe(1);
    expect(json.weakSpots).toEqual([
      { concept: "shape", percent: 67, course: expect.objectContaining({ id: "mini" }), lesson: { id: "a1", title: "First lesson" } },
    ]);
    expect(json.courses[0]).toMatchObject({ id: "mini", started: true, percent: 33 });
  });
});

describe("real sample course", () => {
  it("serves the repo's typescript-fundamentals package end to end", async () => {
    const h = setup({ coursesDir: repoCourses });
    expect((await h.get("/health")).json).toMatchObject({ ok: true, migrated: true });

    const courses = (await h.get("/courses")).json.courses;
    expect(courses.map((c: any) => c.id)).toContain("typescript-fundamentals");
    const c = (await h.get("/courses/typescript-fundamentals")).json;
    expect(c.chapters.map((x: any) => x.total)).toEqual([3, 4, 5, 11]);
    expect(c.chapters.map((x: any) => x.level)).toEqual([1, 1, 1, 2]); // the question-types demo is an extension-level chapter
    expect(c.exams[0]).toMatchObject({ id: "mid", questionCount: 12, durationMinutes: 30, maxAttempts: 3 });

    const l = (await h.get("/courses/typescript-fundamentals/lessons/l06")).json;
    expect(l.quiz).toMatchObject({ id: "q06", questionCount: 4 });
    expect(l.markdown).toContain(":::key-takeaways");
    expect(l.sources.map((s: any) => s.n)).toEqual([3, 7]);

    const q = (await h.get("/courses/typescript-fundamentals/quizzes/q06")).json;
    expect(q.questions).toHaveLength(4);
    expect((await h.post("/courses/typescript-fundamentals/lessons/l06/complete")).status).toBe(409);

    const l04 = (await h.get("/courses/typescript-fundamentals/lessons/l04")).json;
    const file = await h.app.request(l04.resources[0].url.replace("/api", ""));
    expect(file.status).toBe(200);

    const exam = (await h.post("/courses/typescript-fundamentals/exams/mid/instances")).json;
    expect(exam.questions.length).toBeGreaterThan(0);
    expect(exam.questions.length).toBeLessThanOrEqual(12);
    expect((await h.get("/dashboard")).status).toBe(200);
  });
});
