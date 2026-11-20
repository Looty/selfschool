import { describe, expect, it } from "vitest";
import { splitCode } from "./autocode";

const codeOf = (s: string) => splitCode(s).filter((x) => x.code).map((x) => x.text);

describe("splitCode", () => {
  it("finds an assignment and a call in a question", () => {
    const q = 'pairs = [("a", 2), ("b", 2), ("c", 3)]. What does sorted(pairs, key=lambda p: (p[1], p[0]), reverse=True) return? Hint: reverse flips it.';
    expect(codeOf(q)).toEqual(['pairs = [("a", 2), ("b", 2), ("c", 3)]', "sorted(pairs, key=lambda p: (p[1], p[0]), reverse=True)"]);
    expect(splitCode(q).map((x) => x.text).join("")).toBe(q);
  });

  it("treats a whole literal option as code", () => {
    expect(splitCode("[('c', 3), ('b', 2), ('a', 2)]")).toEqual([{ code: true, text: "[('c', 3), ('b', 2), ('a', 2)]" }]);
    expect(codeOf("{'k': 1}")).toEqual(["{'k': 1}"]);
    expect(codeOf("('a', 2)")).toEqual(["('a', 2)"]);
  });

  it("finds chained calls, indexes and keyword assignments in explanations", () => {
    expect(codeOf("Call d.get('k').strip() first.")).toEqual(["d.get('k').strip()"]);
    expect(codeOf("Then p[1] is 2.")).toEqual(["p[1]"]);
    expect(codeOf("Use tags=None and create the list inside.")).toEqual(["tags=None"]);
    expect(codeOf("first = second = None")).toEqual(["first = second = None"]);
    expect(codeOf("x = 5.")).toEqual(["x = 5"]);
  });

  it("keeps a declaration keyword and a closing semicolon with the statement", () => {
    expect(splitCode("const n = 5;")).toEqual([{ code: true, text: "const n = 5;" }]);
    expect(splitCode("console.log(n);")).toEqual([{ code: true, text: "console.log(n);" }]);
    expect(codeOf("Why is let x = 1 allowed?")).toEqual(["let x = 1"]);
  });

  it("leaves prose alone", () => {
    for (const s of [
      "Check the result (see above) before you continue.",
      "Pick the file(s) that changed.",
      "It's 3 (three), e.g. a small number.",
      "Does a == b hold?",
      "[see the note in the lesson]",
      "Plain sentence with no code at all.",
    ])
      expect(codeOf(s)).toEqual([]);
  });

  it("does not treat an unbalanced bracket as code", () => {
    expect(codeOf("f(x is cut off")).toEqual([]);
  });
});
