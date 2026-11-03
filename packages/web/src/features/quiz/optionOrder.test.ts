import type { AnswerResult, LearnerQuestion } from "@selfschool/shared";
import { describe, expect, it } from "vitest";
import { optionOrder, optionShuffler } from "./optionOrder";

const mcq = {
  id: "c:q1",
  type: "mcq",
  text: "Which?",
  options: [{ text: "Right" }, { text: "Wrong A" }, { text: "Wrong B" }],
} as LearnerQuestion;

/** What the api reveals after a check: options in authored order, the right one first. */
const revealed = (selected: number[]): AnswerResult =>
  ({
    questionId: "c:q1", type: "mcq", state: "scored", correct: selected.includes(0) && selected.length === 1, marks: null, feedback: null, jobId: null,
    options: ["Right", "Wrong A", "Wrong B"].map((text, i) => ({ text, correct: i === 0, selected: selected.includes(i), explanation: `why ${i}` })),
  }) as AnswerResult;

describe("option order", () => {
  it("is a permutation, the same for the same seed and question", () => {
    const o = optionOrder("seed", "c:q1", 4);
    expect([...o].sort()).toEqual([0, 1, 2, 3]);
    expect(optionOrder("seed", "c:q1", 4)).toEqual(o);
  });

  it("puts the first authored option in every position about equally often", () => {
    const counts = [0, 0, 0];
    for (let s = 0; s < 3000; s++) counts[optionOrder(`run-${s}`, "c:q1", 3).indexOf(0)]! += 1;
    for (const c of counts) expect(c).toBeGreaterThan(850); // 1000 expected each
  });

  it("differs between runs (a retake reshuffles)", () => {
    const orders = new Set(Array.from({ length: 20 }, (_, s) => optionOrder(`run-${s}`, "c:q1", 3).join()));
    expect(orders.size).toBeGreaterThan(3);
  });
});

describe("option shuffler", () => {
  it("shows shuffled options and sends the authored position of the one picked", () => {
    for (let s = 0; s < 30; s++) {
      const sh = optionShuffler(`run-${s}`);
      const shown = sh.question(mcq);
      if (shown.type !== "mcq") throw new Error("not mcq");
      expect(shown.options.map((o) => o.text).sort()).toEqual(["Right", "Wrong A", "Wrong B"]);
      const pos = shown.options.findIndex((o) => o.text === "Right");
      expect(sh.input(mcq, { type: "mcq", selected: [pos] })).toEqual({ type: "mcq", selected: [0] });
    }
  });

  it("maps a multi-select back to sorted authored positions", () => {
    const sh = optionShuffler("multi");
    const shown = sh.question(mcq);
    if (shown.type !== "mcq") throw new Error("not mcq");
    const picks = ["Wrong B", "Right"].map((t) => shown.options.findIndex((o) => o.text === t));
    expect(sh.input(mcq, { type: "mcq", selected: picks })).toEqual({ type: "mcq", selected: [0, 2] });
  });

  it("puts revealed options back in the order they were shown, explanations attached", () => {
    const sh = optionShuffler("reveal");
    const shown = sh.question(mcq);
    if (shown.type !== "mcq") throw new Error("not mcq");
    const back = sh.result(mcq, revealed([0]))!;
    expect(back.options!.map((o) => o.text)).toEqual(shown.options.map((o) => o.text));
    const right = back.options!.find((o) => o.text === "Right")!;
    expect(right).toMatchObject({ correct: true, selected: true, explanation: "why 0" });
  });

  it("leaves other question types, answers and unrevealed results alone", () => {
    const sh = optionShuffler("x");
    const short = { id: "s", type: "short", text: "?" } as LearnerQuestion;
    expect(sh.question(short)).toBe(short);
    expect(sh.input(short, { type: "short", text: "a" })).toEqual({ type: "short", text: "a" });
    const recorded = { questionId: "c:q1", type: "mcq", state: "recorded", correct: null, marks: null, feedback: null, jobId: null } as AnswerResult;
    expect(sh.result(mcq, recorded)).toBe(recorded);
    expect(sh.result(mcq, undefined)).toBeUndefined();
  });
});
