import { describe, expect, it } from "vitest";
import type { LearnerQuestion } from "@selfschool/shared";
import { clearSlot, isFilled, isOrdering, looksLikeCode, parseTemplate, placeChip, slotCount, slotsOf } from "./fill";
import { EMPTY_DRAFT, answerPill, toInput, typeLabel } from "./state";

const fill = (template: string): Extract<LearnerQuestion, { type: "fill" }> => ({
  id: "q", type: "fill", text: "t", template, chips: [{ id: 0, text: "a" }, { id: 1, text: "b" }, { id: 2, text: "c" }],
});

describe("fill template", () => {
  it("splits text and slots in order", () => {
    expect(parseTemplate("if {{1}} then {{2}}!")).toEqual([{ text: "if " }, { slot: 1 }, { text: " then " }, { slot: 2 }, { text: "!" }]);
    expect(slotCount("{{1}}{{2}}{{3}}")).toBe(3);
  });

  it("treats a template of only slots as an ordering question", () => {
    expect(isOrdering("{{1}}\n{{2}}")).toBe(true);
    expect(isOrdering("x = {{1}}")).toBe(false);
    expect(typeLabel(fill("{{1}}\n{{2}}"))).toBe("Put in order");
    expect(typeLabel(fill("x = {{1}}"))).toBe("Fill the gaps");
  });

  it("uses the code font only for templates that look like code", () => {
    expect(looksLikeCode("const x = {{1}};")).toBe(true);
    expect(looksLikeCode("A {{1}} is a kind of {{2}}.")).toBe(false);
  });
});

describe("placing chips", () => {
  it("fills a slot, moves a chip that is already placed, and replaces the occupant", () => {
    let d = placeChip(EMPTY_DRAFT, 3, 0, 0);
    d = placeChip(d, 3, 1, 1);
    expect(slotsOf(d, 3)).toEqual([0, 1, null]);
    d = placeChip(d, 3, 0, 2); // chip 0 leaves slot 1
    expect(slotsOf(d, 3)).toEqual([null, 1, 0]);
    d = placeChip(d, 3, 2, 1); // chip 1 is displaced back to the bank
    expect(slotsOf(d, 3)).toEqual([null, 2, 0]);
  });

  it("clears a slot and knows when every slot is filled", () => {
    let d = placeChip(placeChip(EMPTY_DRAFT, 2, 2, 0), 2, 0, 1);
    expect(isFilled(d, 2)).toBe(true);
    d = clearSlot(d, 2, 0);
    expect(isFilled(d, 2)).toBe(false);
  });
});

describe("fill answers", () => {
  it("stays empty until every slot has a chip, then sends the chip ids in slot order", () => {
    const q = fill("{{1}} and {{2}}");
    expect(toInput(q, placeChip(EMPTY_DRAFT, 2, 2, 0))).toBeNull();
    expect(toInput(q, placeChip(placeChip(EMPTY_DRAFT, 2, 2, 0), 2, 0, 1))).toEqual({ type: "fill", slots: [2, 0] });
  });

  it("shows a partly right answer as such", () => {
    const base = { questionId: "q", type: "fill", state: "scored", feedback: null, jobId: null } as const;
    expect(answerPill({ ...base, correct: false, marks: { got: 0.5, max: 1 } })?.label).toBe("Partly correct");
    expect(answerPill({ ...base, correct: false, marks: { got: 0, max: 1 } })?.label).toBe("Incorrect");
    expect(answerPill({ ...base, correct: true, marks: { got: 1, max: 1 } })?.label).toBe("Correct");
  });
});
