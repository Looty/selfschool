import { describe, expect, it } from "vitest";
import type { LearnerQuestion } from "@selfschool/shared";
import { clearTake, dirtyQuestions, initialTake, inputKey, loadTake, navLabel, saveTake, summarize, takeReducer, type TakeState } from "./takeState";

const qs: LearnerQuestion[] = [
  { id: "b", type: "mcq", text: "B", options: [{ text: "1" }, { text: "2" }] },
  { id: "a", type: "short", text: "A" },
  { id: "c", type: "open", text: "C" },
];

const answer = (s: TakeState, qid: string, draft: { selected?: number[]; text?: string }) =>
  takeReducer(s, { type: "draft", qid, draft: { selected: draft.selected ?? [], text: draft.text ?? "" } });

describe("exam sitting state", () => {
  it("keeps instance (shuffled) order for positions and navigation", () => {
    let s = takeReducer(initialTake, { type: "go", index: 2, total: qs.length });
    expect(qs[s.index]!.id).toBe("c");
    s = takeReducer(s, { type: "go", index: 99, total: qs.length });
    expect(s.index).toBe(2);
    expect(takeReducer(s, { type: "go", index: -4, total: qs.length }).index).toBe(0);
  });

  it("flag toggles", () => {
    let s = takeReducer(initialTake, { type: "flag", qid: "a" });
    expect(s.flagged).toEqual(["a"]);
    s = takeReducer(s, { type: "flag", qid: "a" });
    expect(s.flagged).toEqual([]);
  });

  it("summarizes answered, unanswered and flagged; blank text is unanswered", () => {
    let s = answer(initialTake, "b", { selected: [1] });
    s = answer(s, "a", { text: "  " });
    s = takeReducer(s, { type: "flag", qid: "c" });
    expect(summarize(qs, s)).toEqual({ answered: 1, unanswered: 2, flagged: 1, unansweredAt: [1, 2] });
  });

  it("only unsaved or changed answers are dirty", () => {
    let s = answer(initialTake, "b", { selected: [1] });
    expect(dirtyQuestions(qs, s).map((q) => q.id)).toEqual(["b"]);
    s = takeReducer(s, { type: "saved", qid: "b", key: inputKey(qs[0]!, { selected: [1], text: "" }) });
    expect(dirtyQuestions(qs, s)).toEqual([]);
    s = answer(s, "b", { selected: [0] });
    expect(dirtyQuestions(qs, s).map((q) => q.id)).toEqual(["b"]);
  });

  it("navigator labels state in words", () => {
    let s = answer(initialTake, "b", { selected: [0] });
    s = takeReducer(s, { type: "flag", qid: "b" });
    expect(navLabel(0, qs[0]!, s)).toBe("Question 1, answered, flagged for review");
    expect(navLabel(1, qs[1]!, s)).toBe("Question 2, not answered");
  });
});

describe("local persistence", () => {
  const mem = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
  };

  it("round-trips a sitting and clears it", () => {
    const store = mem();
    const s = takeReducer(answer(initialTake, "b", { selected: [1] }), { type: "flag", qid: "a" });
    saveTake("inst-1", s, store);
    expect(loadTake("inst-1", store)).toEqual(s);
    expect(loadTake("other", store)).toEqual(initialTake);
    clearTake("inst-1", store);
    expect(loadTake("inst-1", store)).toEqual(initialTake);
  });

  it("survives corrupt data and a throwing store", () => {
    expect(loadTake("x", { getItem: () => "{nope" })).toEqual(initialTake);
    expect(loadTake("x", { getItem: () => { throw new Error("blocked"); } })).toEqual(initialTake);
    expect(() => saveTake("x", initialTake, { setItem: () => { throw new Error("full"); } })).not.toThrow();
  });
});
