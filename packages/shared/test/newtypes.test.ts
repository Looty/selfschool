import { describe, expect, it } from "vitest";
import { questionSchema } from "../src/course.js";
import { regionAt, regionContains } from "../src/hotspot.js";

const base = { id: "q1-1", text: "Q?", concepts: [] };
const parse = (q: object) => questionSchema.safeParse({ ...base, ...q });
const items = [
  { text: "a", bucket: "One", explanation: "x" },
  { text: "b", bucket: "Two", explanation: "y" },
];
const region = { name: "R", explanation: "e" };

describe("sort schema", () => {
  it("accepts items that name known buckets", () => {
    expect(parse({ type: "sort", buckets: ["One", "Two"], items }).success).toBe(true);
  });
  it.each([
    ["an unknown bucket", { buckets: ["One", "Three"], items }],
    ["duplicate buckets", { buckets: ["One", "One"], items }],
    ["a single bucket", { buckets: ["One"], items }],
    ["too few items", { buckets: ["One", "Two"], items: items.slice(0, 1) }],
  ])("rejects %s", (_n, q) => expect(parse({ type: "sort", ...q }).success).toBe(false));
});

describe("spot schema", () => {
  const code = "a\nb\nc\n";
  it("accepts lines inside the code", () => expect(parse({ type: "spot", code, correct: [2], explanation: "e" }).success).toBe(true));
  it.each([
    ["a line past the end", { code, correct: [4], explanation: "e" }],
    ["duplicate lines", { code, correct: [2, 2], explanation: "e" }],
    ["no code", { correct: [1], explanation: "e" }],
    ["no explanation", { code, correct: [1] }],
  ])("rejects %s", (_n, q) => expect(parse({ type: "spot", ...q }).success).toBe(false));
});

describe("hotspot schema", () => {
  const rect = { ...region, shape: "rect", x: 10, y: 10, w: 20, h: 20, correct: true };
  const ok = { type: "hotspot", image: "resources/x.svg", alt: "alt" };
  it("accepts rect, ellipse and polygon regions", () => {
    const regions = [rect, { ...region, name: "E", shape: "ellipse", x: 50, y: 50, rx: 5, ry: 5 }, { ...region, name: "P", shape: "poly", points: [[1, 1], [9, 1], [5, 9]] }];
    expect(parse({ ...ok, regions }).success).toBe(true);
  });
  it.each([
    ["no correct region", { ...ok, regions: [{ ...rect, correct: false }] }],
    ["an image outside resources/", { ...ok, image: "x.svg", regions: [rect] }],
    ["a coordinate past 100", { ...ok, regions: [{ ...rect, x: 120 }] }],
    ["a polygon with two points", { ...ok, regions: [{ ...region, shape: "poly", points: [[1, 1], [2, 2]], correct: true }] }],
    ["duplicate region names", { ...ok, regions: [rect, rect] }],
    ["no alt text", { type: "hotspot", image: "resources/x.svg", regions: [rect] }],
  ])("rejects %s", (_n, q) => expect(parse(q).success).toBe(false));
});

describe("region hit testing", () => {
  const rect = { ...region, correct: false, shape: "rect" as const, x: 10, y: 10, w: 20, h: 20 };
  const ellipse = { ...region, correct: false, shape: "ellipse" as const, x: 50, y: 50, rx: 10, ry: 5 };
  const poly = { ...region, correct: false, shape: "poly" as const, points: [[0, 0], [10, 0], [5, 10]] as [number, number][] };
  it("tests each shape", () => {
    expect(regionContains(rect, { x: 10, y: 30 })).toBe(true);
    expect(regionContains(rect, { x: 31, y: 20 })).toBe(false);
    expect(regionContains(ellipse, { x: 58, y: 50 })).toBe(true);
    expect(regionContains(ellipse, { x: 58, y: 54 })).toBe(false); // inside the box, outside the ellipse
    expect(regionContains(poly, { x: 5, y: 3 })).toBe(true);
    expect(regionContains(poly, { x: 1, y: 9 })).toBe(false);
  });
  it("prefers a correct region where regions overlap", () => {
    const decoy = { ...rect, name: "decoy" };
    const answer = { ...rect, name: "answer", correct: true };
    expect(regionAt([decoy, answer], { x: 15, y: 15 })?.name).toBe("answer");
    expect(regionAt([decoy], { x: 90, y: 90 })).toBeUndefined();
  });
});
