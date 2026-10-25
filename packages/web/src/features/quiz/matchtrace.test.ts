import { describe, expect, it } from "vitest";
import type { LearnerQuestion } from "@selfschool/shared";
import { connect } from "./MatchInput";
import { diffKind } from "./SpotInput";
import { setCell } from "./TraceInput";
import { EMPTY_DRAFT, toInput, typeLabel } from "./state";

const match: Extract<LearnerQuestion, { type: "match" }> = {
  id: "q", type: "match", text: "t",
  left: [{ id: 0, text: "a" }, { id: 1, text: "b" }, { id: 2, text: "c" }],
  right: [{ id: 2, text: "C" }, { id: 0, text: "A" }, { id: 3, text: "D" }, { id: 1, text: "B" }],
};
const trace: Extract<LearnerQuestion, { type: "trace" }> = {
  id: "q", type: "trace", text: "t", code: "x", variables: ["a", "b"],
  steps: [{ label: "line 1", given: { b: "unset" } }, { label: "line 2", given: {} }],
};

describe("match answers", () => {
  it("connects, replaces and frees", () => {
    let d = connect(EMPTY_DRAFT, 3, 0, 1);
    d = connect(d, 3, 1, 0);
    expect(d.pairs).toEqual([1, 0, null]);
    d = connect(d, 3, 2, 1); // right item 1 moves from left 0 to left 2
    expect(d.pairs).toEqual([null, 0, 1]);
    d = connect(d, 3, 1, null);
    expect(d.pairs).toEqual([null, null, 1]);
  });
  it("stays empty until every left item is connected, then sends the right id per left id", () => {
    let d = connect(connect(EMPTY_DRAFT, 3, 0, 0), 3, 1, 3);
    expect(toInput(match, d)).toBeNull();
    d = connect(d, 3, 2, 2);
    expect(toInput(match, d)).toEqual({ type: "match", pairs: [0, 3, 2] });
  });
});

describe("trace answers", () => {
  it("needs every cell except the given ones, and sends given cells empty", () => {
    expect(toInput(trace, EMPTY_DRAFT)).toBeNull();
    let d = setCell(EMPTY_DRAFT, trace, 0, 0, "1");
    d = setCell(d, trace, 1, 0, "3");
    expect(toInput(trace, d)).toBeNull(); // line 2, b still empty
    d = setCell(d, trace, 1, 1, " 2 ");
    expect(toInput(trace, d)).toEqual({ type: "trace", cells: [["1", ""], ["3", "2"]] });
  });
});

describe("diff lines and labels", () => {
  it("reads added and removed lines", () => {
    expect(diffKind("+new")).toBe("add");
    expect(diffKind("-old")).toBe("del");
    expect(diffKind(" same")).toBeNull();
  });
  it("names the new types", () => {
    expect(typeLabel(match)).toBe("Match the pairs");
    expect(typeLabel(trace)).toBe("Trace the code");
  });
});
