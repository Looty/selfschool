import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { miniCourses, setup } from "./helpers.js";

/** The mini course with a sort, a spot and a hotspot question appended to quiz qz2. */
function withNewTypes() {
  const dir = miniCourses();
  appendFileSync(
    join(dir, "mini", "c2", "quiz-02.yaml"),
    `  - id: b-sort
    type: sort
    text: "Sort them."
    concepts: [sorting]
    buckets: ["Fails early", "Fails late", "Fine"]
    items:
      - {text: "alpha", bucket: "Fails early", explanation: "Alpha fails early."}
      - {text: "beta", bucket: "Fails late", explanation: "Beta fails late."}
      - {text: "gamma", bucket: "Fine", explanation: "Gamma is fine."}
      - {text: "delta", bucket: "Fine", explanation: "Delta is fine."}
  - id: b-spot
    type: spot
    text: "Which lines are wrong?"
    concepts: [spotting]
    code: |
      one
      two
      three
      four
    correct: [2, 3]
    explanation: "Two and three are the problem."
  - id: b-hot
    type: hotspot
    text: "Click the target."
    concepts: [pictures]
    image: resources/pic.svg
    alt: "A picture."
    regions:
      - {name: "Target", correct: true, shape: rect, x: 10, y: 10, w: 20, h: 20, explanation: "This is it."}
      - {name: "Second", correct: true, shape: ellipse, x: 70, y: 70, rx: 10, ry: 10, explanation: "This too."}
      - {name: "Decoy", shape: poly, points: [[40, 40], [60, 40], [50, 60]], explanation: "Not this one."}
`,
  );
  return setup({ coursesDir: dir });
}

const start = async (h: ReturnType<typeof setup>) => (await h.post("/courses/mini/quizzes/qz2/attempts")).json.attemptId as string;
const find = async (h: ReturnType<typeof setup>, type: string) => (await h.get("/courses/mini/quizzes/qz2")).json.questions.find((q: any) => q.type === type);
const answer = (h: ReturnType<typeof setup>, id: string, q: any, body: object) => h.post(`/attempts/${id}/answers/${q.id}`, body);

describe("what the learner is sent", () => {
  it("never includes the answer keys", async () => {
    const h = withNewTypes();
    const qs = (await h.get("/courses/mini/quizzes/qz2")).json.questions.filter((q: any) => ["sort", "spot", "hotspot"].includes(q.type));
    const raw = JSON.stringify(qs);
    for (const leak of ["Fails early\",\"explanation", "explanation", "Alpha fails early", "Two and three", "\"correct\"", "\"regions\"", "This is it", "Decoy"]) expect(raw).not.toContain(leak);
    const sort = qs.find((q: any) => q.type === "sort");
    expect(sort.buckets).toEqual(["Fails early", "Fails late", "Fine"]);
    expect(sort.items.map((i: any) => i.id).sort()).toEqual([0, 1, 2, 3]);
    expect(qs.find((q: any) => q.type === "hotspot")).toMatchObject({ image: "resources/pic.svg", picks: 2 });
  });
});

describe("sort", () => {
  it("scores per item and explains each", async () => {
    const h = withNewTypes();
    const id = await start(h);
    const q = await find(h, "sort");
    // alpha→Fails early (ok), beta→Fine (wrong), gamma→Fine (ok), delta→Fails late (wrong)
    const r = await answer(h, id, q, { type: "sort", buckets: [0, 2, 2, 1] });
    expect(r.json).toMatchObject({ state: "scored", correct: false, marks: { got: 0.5, max: 1 } });
    expect(r.json.sorted).toEqual([
      { id: 0, text: "alpha", placed: "Fails early", correct: true, answer: "Fails early", explanation: "Alpha fails early." },
      { id: 1, text: "beta", placed: "Fine", correct: false, answer: "Fails late", explanation: "Beta fails late." },
      { id: 2, text: "gamma", placed: "Fine", correct: true, answer: "Fine", explanation: "Gamma is fine." },
      { id: 3, text: "delta", placed: "Fails late", correct: false, answer: "Fine", explanation: "Delta is fine." },
    ]);
  });

  it("is correct only when every item is, and rejects a wrong count or bucket", async () => {
    const h = withNewTypes();
    const id = await start(h);
    const q = await find(h, "sort");
    expect((await answer(h, id, q, { type: "sort", buckets: [0, 1] })).status).toBe(400);
    expect((await answer(h, id, q, { type: "sort", buckets: [0, 1, 2, 9] })).status).toBe(400);
    const ok = await answer(h, id, q, { type: "sort", buckets: [0, 1, 2, 2] });
    expect(ok.json).toMatchObject({ correct: true, marks: { got: 1, max: 1 } });
  });
});

describe("spot", () => {
  it("scores right lines over everything picked or needed", async () => {
    const h = withNewTypes();
    const id = await start(h);
    const q = await find(h, "spot");
    const r = await answer(h, id, q, { type: "spot", lines: [2, 4] }); // one right, one extra, one missed
    expect(r.json).toMatchObject({ state: "scored", correct: false });
    expect(r.json.marks.got).toBeCloseTo(1 / 3);
    expect(r.json.spot).toEqual({ picked: [2, 4], correct: [2, 3], explanation: "Two and three are the problem." });
  });

  it("needs exactly the right lines to be correct, and rejects bad selections", async () => {
    const h = withNewTypes();
    const id = await start(h);
    const q = await find(h, "spot");
    expect((await answer(h, id, q, { type: "spot", lines: [2, 2] })).status).toBe(400);
    expect((await answer(h, id, q, { type: "spot", lines: [9] })).status).toBe(400);
    expect((await answer(h, id, q, { type: "spot", lines: [3, 2] })).json).toMatchObject({ correct: true, marks: { got: 1, max: 1 } });
  });
});

describe("hotspot", () => {
  it("grades markers against the regions and reveals them afterwards", async () => {
    const h = withNewTypes();
    const id = await start(h);
    const q = await find(h, "hotspot");
    // one marker in "Target" (rect), one in the decoy triangle
    const r = await answer(h, id, q, { type: "hotspot", points: [{ x: 20, y: 20 }, { x: 50, y: 48 }] });
    expect(r.json).toMatchObject({ state: "scored", correct: false, marks: { got: 0.5, max: 1 } });
    expect(r.json.hotspot.points).toEqual([
      { x: 20, y: 20, ok: true, region: "Target" },
      { x: 50, y: 48, ok: false, region: "Decoy" },
    ]);
    expect(r.json.hotspot.regions.map((x: any) => [x.name, x.hit])).toEqual([["Target", true], ["Second", false], ["Decoy", true]]);
  });

  it("is correct when every correct region has a marker, and limits the markers", async () => {
    const h = withNewTypes();
    const id = await start(h);
    const q = await find(h, "hotspot");
    expect((await answer(h, id, q, { type: "hotspot", points: [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }] })).status).toBe(400);
    const r = await answer(h, id, q, { type: "hotspot", points: [{ x: 15, y: 15 }, { x: 72, y: 68 }] }); // rect, then ellipse
    expect(r.json).toMatchObject({ correct: true, marks: { got: 1, max: 1 } });
  });

  it("counts two markers in the same region once", async () => {
    const h = withNewTypes();
    const id = await start(h);
    const q = await find(h, "hotspot");
    const r = await answer(h, id, q, { type: "hotspot", points: [{ x: 12, y: 12 }, { x: 25, y: 25 }] });
    expect(r.json).toMatchObject({ correct: false, marks: { got: 0.5, max: 1 } });
  });
});
