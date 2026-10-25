import { describe, expect, it } from "vitest";
import type { LearnerQuestion } from "@selfschool/shared";
import { assign } from "./SortInput";
import { placePoint } from "./HotspotInput";
import { codeLines } from "./SpotInput";
import { EMPTY_DRAFT, toInput, typeLabel } from "./state";

const sort: Extract<LearnerQuestion, { type: "sort" }> = {
  id: "q", type: "sort", text: "t", buckets: ["A", "B"], items: [{ id: 0, text: "x" }, { id: 1, text: "y" }, { id: 2, text: "z" }],
};
const spot: Extract<LearnerQuestion, { type: "spot" }> = { id: "q", type: "spot", text: "t", code: "a\nb\nc\n" };
const hot = (picks: number): Extract<LearnerQuestion, { type: "hotspot" }> => ({ id: "c:q", type: "hotspot", text: "t", image: "resources/i.svg", alt: "a", picks });

describe("sort answers", () => {
  it("stays empty until every item is in a bucket, then sends the bucket per item id", () => {
    let d = assign(EMPTY_DRAFT, 3, 2, 1);
    d = assign(d, 3, 0, 0);
    expect(toInput(sort, d)).toBeNull();
    d = assign(d, 3, 1, 1);
    expect(toInput(sort, d)).toEqual({ type: "sort", buckets: [0, 1, 1] });
  });
  it("returns an item to the tray", () => {
    const d = assign(assign(EMPTY_DRAFT, 3, 0, 1), 3, 0, null);
    expect(d.assigned?.[0]).toBeNull();
  });
});

describe("spot answers", () => {
  it("needs a selected line and sends them in order", () => {
    expect(toInput(spot, EMPTY_DRAFT)).toBeNull();
    expect(toInput(spot, { ...EMPTY_DRAFT, lines: [3, 1] })).toEqual({ type: "spot", lines: [1, 3] });
  });
  it("splits code into lines without the trailing blank one", () => {
    expect(codeLines("a\nb\nc\n")).toEqual(["a", "b", "c"]);
  });
});

describe("hotspot answers", () => {
  it("needs a marker", () => {
    expect(toInput(hot(1), EMPTY_DRAFT)).toBeNull();
    expect(toInput(hot(1), { ...EMPTY_DRAFT, points: [{ x: 1, y: 2 }] })).toEqual({ type: "hotspot", points: [{ x: 1, y: 2 }] });
  });
  it("moves a single marker, fills several and then moves the last", () => {
    const a = { x: 1, y: 1 }, b = { x: 2, y: 2 }, c = { x: 3, y: 3 };
    expect(placePoint([a], 1, b)).toEqual([b]);
    expect(placePoint([a], 2, b)).toEqual([a, b]);
    expect(placePoint([a, b], 2, c)).toEqual([a, c]);
  });
});

describe("labels", () => {
  it("names each new type", () => {
    expect(typeLabel(sort)).toBe("Sort into groups");
    expect(typeLabel(spot)).toBe("Select the lines");
    expect(typeLabel(hot(1))).toBe("Click the image");
    expect(typeLabel(hot(2))).toBe("Click 2 places");
  });
});
