import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { miniCourses, setup } from "./helpers.js";

/** The mini course with a match, a trace and a diff-mode spot question appended to quiz qz2. */
function withQuestions() {
  const dir = miniCourses();
  appendFileSync(
    join(dir, "mini", "c2", "quiz-02.yaml"),
    `  - id: b-match
    type: match
    text: "Match them."
    concepts: [matching]
    pairs:
      - {left: "one", right: "uno", explanation: "One is uno."}
      - {left: "two", right: "dos", explanation: "Two is dos."}
      - {left: "three", right: "tres", explanation: "Three is tres."}
    distractors: ["cuatro"]
  - id: b-trace
    type: trace
    text: "Trace it."
    concepts: [tracing]
    code: |
      let a = 1;
      a += 2;
    variables: [a, b]
    steps:
      - {label: "line 1", values: {a: 1, b: "unset"}, given: [b]}
      - {label: "line 2", values: {a: [3, "three"], b: "unset"}, given: [b]}
    explanation: "Plus two."
  - id: b-diff
    type: spot
    diff: true
    text: "Which added line is wrong?"
    concepts: [diffs]
    code: |2
       keep
      -old
      +new
    correct: [3]
    explanation: "The new line."
`,
  );
  return setup({ coursesDir: dir });
}

const start = async (h: ReturnType<typeof setup>) => (await h.post("/courses/mini/quizzes/qz2/attempts")).json.attemptId as string;
const find = async (h: ReturnType<typeof setup>, type: string) => (await h.get("/courses/mini/quizzes/qz2")).json.questions.find((q: any) => q.type === type && (type !== "spot" || q.diff));
const answer = (h: ReturnType<typeof setup>, id: string, q: any, body: object) => h.post(`/attempts/${id}/answers/${q.id}`, body);
const rightId = (q: any, text: string) => q.right.find((r: any) => r.text === text).id as number;

describe("match", () => {
  it("sends both columns without saying who pairs with whom", async () => {
    const h = withQuestions();
    const q = await find(h, "match");
    expect(q.left).toEqual([{ id: 0, text: "one" }, { id: 1, text: "two" }, { id: 2, text: "three" }]);
    expect(q.right.map((r: any) => r.id).sort()).toEqual([0, 1, 2, 3]);
    const raw = JSON.stringify(q);
    for (const leak of ["explanation", "One is uno", "pairs", "distractors"]) expect(raw).not.toContain(leak);
  });

  it("scores per pair and says where each wrong one belongs", async () => {
    const h = withQuestions();
    const id = await start(h);
    const q = await find(h, "match");
    // one→uno (ok), two→cuatro (wrong, a distractor), three→dos (wrong)
    const r = await answer(h, id, q, { type: "match", pairs: [rightId(q, "uno"), rightId(q, "cuatro"), rightId(q, "dos")] });
    expect(r.json).toMatchObject({ state: "scored", correct: false });
    expect(r.json.marks.got).toBeCloseTo(1 / 3);
    expect(r.json.matches).toEqual([
      { id: 0, left: "one", placed: "uno", correct: true, answer: "uno", explanation: "One is uno." },
      { id: 1, left: "two", placed: "cuatro", correct: false, answer: "dos", explanation: "Two is dos." },
      { id: 2, left: "three", placed: "dos", correct: false, answer: "tres", explanation: "Three is tres." },
    ]);
  });

  it("is correct when every pair is, and rejects a reused or unknown right item", async () => {
    const h = withQuestions();
    const id = await start(h);
    const q = await find(h, "match");
    expect((await answer(h, id, q, { type: "match", pairs: [0, 0, 1] })).status).toBe(400);
    expect((await answer(h, id, q, { type: "match", pairs: [0, 1, 9] })).status).toBe(400);
    expect((await answer(h, id, q, { type: "match", pairs: [0, 1] })).status).toBe(400);
    const ok = await answer(h, id, q, { type: "match", pairs: [rightId(q, "uno"), rightId(q, "dos"), rightId(q, "tres")] });
    expect(ok.json).toMatchObject({ correct: true, marks: { got: 1, max: 1 } });
  });
});

describe("trace", () => {
  it("sends the code grid with only the given cells filled in", async () => {
    const h = withQuestions();
    const q = await find(h, "trace");
    expect(q.variables).toEqual(["a", "b"]);
    expect(q.steps).toEqual([{ label: "line 1", given: { b: "unset" } }, { label: "line 2", given: { b: "unset" } }]);
    const raw = JSON.stringify(q);
    for (const leak of ["Plus two", "three", "explanation"]) expect(raw).not.toContain(leak);
  });

  it("grades each typed cell, accepts any listed spelling and ignores given cells", async () => {
    const h = withQuestions();
    const id = await start(h);
    const q = await find(h, "trace");
    const r = await answer(h, id, q, { type: "trace", cells: [["2", ""], ["three", "whatever"]] }); // line 1 wrong, line 2 right via alternative
    expect(r.json).toMatchObject({ state: "scored", correct: false, marks: { got: 0.5, max: 1 } });
    expect(r.json.trace.steps[0].cells).toEqual([
      { given: false, placed: "2", correct: false, answer: "1" },
      { given: true, placed: "unset", correct: true, answer: "unset" },
    ]);
    expect(r.json.trace.steps[1].cells[0]).toMatchObject({ placed: "three", correct: true, answer: "3" });
    expect(r.json.trace.explanation).toBe("Plus two.");
  });

  it("is correct when every graded cell is, tolerating spacing and quote style, and rejects a bad grid", async () => {
    const h = withQuestions();
    const id = await start(h);
    const q = await find(h, "trace");
    expect((await answer(h, id, q, { type: "trace", cells: [["1", ""]] })).status).toBe(400);
    const ok = await answer(h, id, q, { type: "trace", cells: [["  1 ", ""], ["3", ""]] });
    expect(ok.json).toMatchObject({ correct: true, marks: { got: 1, max: 1 } });
  });
});

describe("spot in diff mode", () => {
  it("tells the page to draw a diff and grades like any spot question", async () => {
    const h = withQuestions();
    const id = await start(h);
    const q = await find(h, "spot");
    expect(q.diff).toBe(true);
    expect(q.code).toContain("+new");
    expect((await answer(h, id, q, { type: "spot", lines: [3] })).json).toMatchObject({ correct: true });
  });
});
