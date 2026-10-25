import { describe, expect, it } from "vitest";
import { readingProgress } from "./ReadingProgress";

// Article starts 200px down the page, is 2000px tall, viewport 800px: the scroll range is 1400px.
describe("readingProgress", () => {
  it("starts at 0 at the top of the page", () => {
    expect(readingProgress(0, 200, 2000, 800)).toBe(0);
  });

  it("grows with scroll", () => {
    expect(readingProgress(700, 200, 2000, 800)).toBe(50);
  });

  it("reaches 100 once the end of the article is on screen and stays there", () => {
    expect(readingProgress(1400, 200, 2000, 800)).toBe(100);
    expect(readingProgress(5000, 200, 2000, 800)).toBe(100);
  });

  it("is 0 for an empty article or one that fits the viewport", () => {
    expect(readingProgress(0, 0, 0, 800)).toBe(0);
    expect(readingProgress(0, 100, 500, 800)).toBe(0);
  });
});
