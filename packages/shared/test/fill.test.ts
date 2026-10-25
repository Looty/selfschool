import { describe, expect, it } from "vitest";
import { questionSchema } from "../src/course.js";

const base = { id: "q1-1", type: "fill", text: "Complete it.", concepts: ["loops"] };
const chip = (text: string, slot?: number) => ({ text, ...(slot ? { slot } : {}), explanation: "Because." });
const parse = (q: object) => questionSchema.safeParse({ ...base, ...q });

describe("fill question schema", () => {
  it("accepts slots with one chip each plus distractors", () => {
    expect(parse({ template: "a {{1}} b {{2}}", chips: [chip("x", 1), chip("y", 2), chip("z")] }).success).toBe(true);
  });

  it("accepts a template of only slots (an ordering question)", () => {
    expect(parse({ template: "{{1}}\n{{2}}\n{{3}}", chips: [chip("one", 1), chip("two", 2), chip("three", 3)] }).success).toBe(true);
  });

  it.each([
    ["no slots", { template: "nothing here", chips: [chip("x")] }],
    ["slots out of order", { template: "{{2}} {{1}}", chips: [chip("x", 1), chip("y", 2)] }],
    ["a slot without a chip", { template: "{{1}} {{2}}", chips: [chip("x", 1)] }],
    ["two chips for one slot", { template: "{{1}}", chips: [chip("x", 1), chip("y", 1)] }],
    ["a chip for a missing slot", { template: "{{1}}", chips: [chip("x", 1), chip("y", 2)] }],
    ["too many slots", { template: Array.from({ length: 9 }, (_, i) => `{{${i + 1}}}`).join(" "), chips: Array.from({ length: 9 }, (_, i) => chip(`c${i}`, i + 1)) }],
  ])("rejects %s", (_name, q) => {
    expect(parse(q).success).toBe(false);
  });

  it("requires an explanation on every chip", () => {
    expect(parse({ template: "{{1}}", chips: [{ text: "x", slot: 1 }] }).success).toBe(false);
  });
});
