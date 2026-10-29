import { describe, expect, it } from "vitest";
import type { AnswerResult, LearnerQuestion } from "@selfschool/shared";
import {
  EMPTY_DRAFT, answerPill, announcement, initialRunner, mergeResult, pointsLabel, runnerReducer, selectOption, stageOf, toInput, typeLabel,
} from "./state";

const mcq: LearnerQuestion = { id: "q1", type: "mcq", text: "Pick", options: [{ text: "a" }, { text: "b" }, { text: "c" }] };
const multi = { ...mcq, multiple: true } as LearnerQuestion;
const short: LearnerQuestion = { id: "q2", type: "short", text: "Short" };
const open: LearnerQuestion = { id: "q3", type: "open", text: "Open" };

const result = (over: Partial<AnswerResult>): AnswerResult => ({
  questionId: "q1", type: "mcq", state: "scored", correct: true, marks: { got: 1, max: 1 }, feedback: null, jobId: null, ...over,
});

describe("draft to input", () => {
  it("is null while empty so Check stays disabled", () => {
    expect(toInput(mcq, EMPTY_DRAFT)).toBeNull();
    expect(toInput(short, { selected: [], text: "   " })).toBeNull();
    expect(toInput(open, EMPTY_DRAFT)).toBeNull();
  });

  it("builds typed inputs, sorted and trimmed", () => {
    expect(toInput(mcq, { selected: [2, 0], text: "" })).toEqual({ type: "mcq", selected: [0, 2] });
    expect(toInput(short, { selected: [], text: " object " })).toEqual({ type: "short", text: "object" });
    expect(toInput(open, { selected: [], text: "why" })).toEqual({ type: "open", text: "why" });
  });

  it("single choice replaces, multiple toggles", () => {
    expect(selectOption({ selected: [0], text: "" }, 2, false).selected).toEqual([2]);
    expect(selectOption({ selected: [0], text: "" }, 2, true).selected).toEqual([0, 2]);
    expect(selectOption({ selected: [0, 2], text: "" }, 0, true).selected).toEqual([2]);
  });

  it("labels question types", () => {
    expect(typeLabel(mcq)).toBe("Multiple choice");
    expect(typeLabel(multi)).toMatch(/select all/);
    expect(typeLabel(short)).toBe("Short answer");
    expect(typeLabel(open)).toBe("Open-ended");
  });
});

describe("runner state machine", () => {
  it("answering -> checking -> answered, and locks the draft afterwards", () => {
    let s = runnerReducer(initialRunner, { type: "draft", qid: "q1", draft: { selected: [1], text: "" } });
    expect(stageOf(s, "q1")).toBe("answering");
    s = runnerReducer(s, { type: "checking" });
    expect(stageOf(s, "q1")).toBe("checking");
    expect(runnerReducer(s, { type: "draft", qid: "q1", draft: { selected: [2], text: "" } }).drafts.q1!.selected).toEqual([1]);
    s = runnerReducer(s, { type: "checked", qid: "q1", result: result({}) });
    expect(stageOf(s, "q1")).toBe("answered");
    expect(runnerReducer(s, { type: "draft", qid: "q1", draft: { selected: [0], text: "" } }).drafts.q1!.selected).toEqual([1]);
  });

  it("a failed check returns to answering and keeps the draft and an error", () => {
    let s = runnerReducer(initialRunner, { type: "draft", qid: "q1", draft: { selected: [1], text: "" } });
    s = runnerReducer(runnerReducer(s, { type: "checking" }), { type: "failed", message: "offline" });
    expect(stageOf(s, "q1")).toBe("answering");
    expect(s.error).toBe("offline");
    expect(s.drafts.q1!.selected).toEqual([1]);
    expect(runnerReducer(s, { type: "checking" }).error).toBeNull();
  });

  it("next stops at the last question; reset starts over", () => {
    let s = initialRunner;
    for (let i = 0; i < 5; i++) s = runnerReducer(s, { type: "next", total: 3 });
    expect(s.index).toBe(2);
    expect(runnerReducer(s, { type: "reset" })).toEqual(initialRunner);
  });

  it("ignores a second checking while one is in flight", () => {
    const once = runnerReducer(initialRunner, { type: "checking" });
    expect(runnerReducer(once, { type: "checking" })).toBe(once);
  });
});

describe("merging local and polled results", () => {
  const grading = result({ type: "open", state: "grading", correct: null, marks: null });
  const graded = result({ type: "open", state: "graded", correct: false, marks: { got: 2, max: 3 } });
  it("takes the polled result once it is further along, never goes back", () => {
    expect(mergeResult(grading, graded)).toBe(graded);
    expect(mergeResult(graded, grading)).toBe(graded);
    expect(mergeResult(undefined, grading)).toBe(grading);
    expect(mergeResult(grading, undefined)).toBe(grading);
  });

  it("a self-mark beats a stale polled grading; an AI grade beats the self-mark", () => {
    const self = result({ type: "open", state: "self", selfMark: "got", correct: true, marks: { got: 1, max: 1 } });
    expect(mergeResult(self, grading)).toBe(self);
    expect(mergeResult(grading, self)).toBe(self);
    expect(mergeResult(self, graded)).toBe(graded);
  });
});

describe("scoring display", () => {
  it("formats points without float noise", () => {
    expect(pointsLabel({ got: 2, max: 3 })).toBe("2 / 3 POINTS");
    expect(pointsLabel({ got: 0.1 + 0.2, max: 1 })).toBe("0.3 / 1 POINTS");
  });

  it("pills carry text, not only colour", () => {
    expect(answerPill(undefined)).toBeNull();
    expect(answerPill(result({ correct: true }))).toMatchObject({ tone: "ok", label: "Correct" });
    expect(answerPill(result({ correct: false }))).toMatchObject({ tone: "bad", label: "Incorrect" });
    expect(answerPill(result({ state: "recorded", correct: null, marks: null }))).toMatchObject({ tone: "neutral", label: "Answer recorded" });
    expect(answerPill(result({ state: "grading", correct: null, marks: null }))).toMatchObject({ tone: "warn", label: "Grading…" });
    expect(answerPill(result({ state: "failed", correct: null, marks: null }))).toMatchObject({ tone: "bad" });
    expect(answerPill(result({ state: "self", selfMark: "got" }))).toMatchObject({ tone: "ok", label: "Self-marked · got it" });
    expect(answerPill(result({ state: "self", selfMark: "partly" }))).toMatchObject({ tone: "warn", label: "Self-marked · partly" });
    expect(answerPill(result({ state: "self", selfMark: "missed" }))).toMatchObject({ tone: "bad", label: "Self-marked · missed" });
  });

  it("graded tone follows the share of points", () => {
    const g = (got: number) => answerPill(result({ type: "open", state: "graded", feedback: { marks: { got, max: 3 }, points: [] } }))!;
    expect(g(3)).toMatchObject({ tone: "ok", label: "3 / 3 POINTS", mono: true });
    expect(g(2).tone).toBe("ok");
    expect(g(1).tone).toBe("warn");
    expect(g(0).tone).toBe("bad");
  });

  it("announces state changes in words", () => {
    expect(announcement(result({ state: "grading", correct: null, marks: null }))).toMatch(/grading/i);
    expect(announcement(result({ correct: false }))).toBe("Incorrect");
    expect(announcement(undefined)).toBe("");
  });
});
