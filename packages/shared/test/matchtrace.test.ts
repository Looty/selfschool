import { describe, expect, it } from "vitest";
import { questionSchema } from "../src/course.js";
import { normalizeTrace, traceMatches } from "../src/trace.js";

const base = { id: "q1-1", text: "Q?", concepts: [] };
const parse = (q: object) => questionSchema.safeParse({ ...base, ...q });
const pairs = [
  { left: "a", right: "A", explanation: "x" },
  { left: "b", right: "B", explanation: "y" },
];

describe("match schema", () => {
  it("accepts pairs with distractors", () => expect(parse({ type: "match", pairs, distractors: ["C"] }).success).toBe(true));
  it.each([
    ["a single pair", { pairs: pairs.slice(0, 1) }],
    ["a repeated left item", { pairs: [pairs[0], { ...pairs[1], left: "a" }] }],
    ["a distractor that repeats a partner", { pairs, distractors: ["A"] }],
    ["a pair without an explanation", { pairs: [pairs[0], { left: "b", right: "B" }] }],
  ])("rejects %s", (_n, q) => expect(parse({ type: "match", ...q }).success).toBe(false));
});

describe("trace schema", () => {
  const ok = { type: "trace", code: "let a = 1;", variables: ["a", "b"], explanation: "e" };
  const step = { label: "line 1", values: { a: 1, b: "x" }, given: ["b"] };
  it("accepts numbers and lists of accepted spellings, reading numbers as text", () => {
    const r = parse({ ...ok, steps: [{ ...step, values: { a: [1, "one"], b: "x" } }] });
    expect(r.success).toBe(true);
    if (r.success && r.data.type === "trace") expect(r.data.steps[0]!.values.a).toEqual(["1", "one"]);
  });
  it.each([
    ["a missing variable", { ...ok, steps: [{ ...step, values: { a: 1 } }] }],
    ["an unknown variable", { ...ok, steps: [{ ...step, values: { a: 1, b: 2, c: 3 } }] }],
    ["a given cell for an unknown variable", { ...ok, steps: [{ ...step, given: ["z"] }] }],
    ["every cell given", { ...ok, variables: ["a"], steps: [{ label: "l", values: { a: 1 }, given: ["a"] }] }],
    ["no explanation", { type: "trace", code: "x", variables: ["a"], steps: [{ label: "l", values: { a: 1 } }] }],
  ])("rejects %s", (_n, q) => expect(parse(q).success).toBe(false));
});

describe("trace matching", () => {
  it("normalizes spacing and quote style but not case", () => {
    expect(normalizeTrace("  'a   b' ")).toBe('"a b"');
    expect(traceMatches(" 3 ", "3")).toBe(true);
    expect(traceMatches("'hi'", '"hi"')).toBe(true);
    expect(traceMatches("three", ["3", "three"])).toBe(true);
    expect(traceMatches("True", "true")).toBe(false);
    expect(traceMatches("", "3")).toBe(false);
  });
});

describe("spot diff flag", () => {
  it("defaults to off and accepts on", () => {
    const code = "a\n+b\n";
    const off = parse({ type: "spot", code, correct: [2], explanation: "e" });
    const on = parse({ type: "spot", code, correct: [2], explanation: "e", diff: true });
    expect(off.success && off.data.type === "spot" && off.data.diff).toBe(false);
    expect(on.success && on.data.type === "spot" && on.data.diff).toBe(true);
  });
});
