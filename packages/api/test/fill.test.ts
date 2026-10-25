import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { miniCourses, setup } from "./helpers.js";

/** The mini course with a fill question (3 slots, 2 distractors) appended to quiz qz2. */
function withFill() {
  const dir = miniCourses();
  appendFileSync(
    join(dir, "mini", "c2", "quiz-02.yaml"),
    `  - id: b-fill
    type: fill
    text: "Complete the loop."
    concepts: [loops]
    template: |
      for (const x of xs) {
        {{1}} {
          {{2}}
        }
      }
      {{3}}
    chips:
      - {text: "if (ok(x))", slot: 1, explanation: "Tests each item."}
      - {text: "return x;", slot: 2, explanation: "Stops at the first match."}
      - {text: "return undefined;", slot: 3, explanation: "Nothing matched."}
      - {text: "break;", explanation: "Leaves the loop without a result."}
      - {text: "if (x)", explanation: "Ignores the test."}
`,
  );
  return setup({ coursesDir: dir });
}

const start = async (h: ReturnType<typeof setup>) => (await h.post("/courses/mini/quizzes/qz2/attempts")).json.attemptId as string;
const chipIds = (q: any, texts: string[]) => texts.map((t) => q.chips.find((c: any) => c.text === t).id as number);

describe("fill questions", () => {
  it("send chips shuffled without the slot key, and keep the shuffle stable", async () => {
    const h = withFill();
    const a = (await h.get("/courses/mini/quizzes/qz2")).json.questions.find((q: any) => q.type === "fill");
    const b = (await h.get("/courses/mini/quizzes/qz2")).json.questions.find((q: any) => q.type === "fill");
    expect(a.chips).toEqual(b.chips);
    expect(a.chips.map((c: any) => c.id).sort()).toEqual([0, 1, 2, 3, 4]);
    const raw = JSON.stringify(a);
    for (const leak of ["slot\"", "explanation", "Tests each item"]) expect(raw).not.toContain(leak);
    expect(a.template).toContain("{{3}}");
  });

  it("scores per slot and explains each one after submit", async () => {
    const h = withFill();
    const id = await start(h);
    const q = (await h.get("/courses/mini/quizzes/qz2")).json.questions.find((x: any) => x.type === "fill");
    // slot 1 right, slot 2 gets the distractor, slot 3 right
    const slots = chipIds(q, ["if (ok(x))", "break;", "return undefined;"]);
    const r = await h.post(`/attempts/${id}/answers/${q.id}`, { type: "fill", slots });
    expect(r.json).toMatchObject({ state: "scored", correct: false });
    expect(r.json.marks.got).toBeCloseTo(2 / 3);
    expect(r.json.slots).toEqual([
      { placed: "if (ok(x))", correct: true, answer: "if (ok(x))", explanation: "Tests each item." },
      { placed: "break;", correct: false, answer: "return x;", explanation: "Stops at the first match.", placedExplanation: "Leaves the loop without a result." },
      { placed: "return undefined;", correct: true, answer: "return undefined;", explanation: "Nothing matched." },
    ]);
  });

  it("is fully correct only when every slot is", async () => {
    const h = withFill();
    const id = await start(h);
    const q = (await h.get("/courses/mini/quizzes/qz2")).json.questions.find((x: any) => x.type === "fill");
    const r = await h.post(`/attempts/${id}/answers/${q.id}`, { type: "fill", slots: chipIds(q, ["if (ok(x))", "return x;", "return undefined;"]) });
    expect(r.json).toMatchObject({ state: "scored", correct: true, marks: { got: 1, max: 1 } });
  });

  it("rejects a wrong number of slots, a reused chip and an unknown chip", async () => {
    const h = withFill();
    const id = await start(h);
    const q = (await h.get("/courses/mini/quizzes/qz2")).json.questions.find((x: any) => x.type === "fill");
    const post = (slots: number[]) => h.post(`/attempts/${id}/answers/${q.id}`, { type: "fill", slots });
    expect((await post([0, 1])).status).toBe(400);
    expect((await post([0, 0, 1])).status).toBe(400);
    expect((await post([0, 1, 9])).status).toBe(400);
  });
});
