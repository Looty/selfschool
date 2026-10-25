import { describe, expect, it } from "vitest";
import { newCourseId } from "../src/course";

describe("newCourseId", () => {
  it("slugs the title and appends a 6 character suffix", () => {
    expect(newCourseId("Python Basics!")).toMatch(/^python-basics-[a-z0-9]{6}$/);
    expect(newCourseId("  Ünïcode — & symbols ")).toMatch(/^[a-z0-9][a-z0-9-]*-[a-z0-9]{6}$/);
  });
  it("falls back when the title has no usable characters", () => {
    expect(newCourseId("???")).toMatch(/^course-[a-z0-9]{6}$/);
  });
  it("is different every time", () => {
    expect(new Set(Array.from({ length: 50 }, () => newCourseId("x"))).size).toBe(50);
  });
});
