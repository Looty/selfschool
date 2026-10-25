import { describe, expect, it } from "vitest";
import type { ChapterOutline } from "@selfschool/shared";
import { citationHref, quotePreview, selectionToQuote } from "./selection";

describe("selectionToQuote", () => {
  it("collapses whitespace and trims", () => {
    expect(selectionToQuote("  The compiler\n  does not   check  ")).toBe("The compiler does not check");
  });

  it("ignores empty or tiny selections", () => {
    expect(selectionToQuote("   ")).toBeNull();
    expect(selectionToQuote("a ")).toBeNull();
  });

  it("cuts long selections at a word boundary with an ellipsis", () => {
    const q = selectionToQuote("word ".repeat(200), 50)!;
    expect(q.endsWith("…")).toBe(true);
    expect(q.length).toBeLessThanOrEqual(51);
    expect(q).not.toMatch(/wor…$/);
  });

  it("keeps text at the limit untouched", () => {
    expect(selectionToQuote("abcdef", 6)).toBe("abcdef");
  });
});

describe("quotePreview", () => {
  it("shortens only for display", () => {
    expect(quotePreview("short")).toBe("short");
    expect(quotePreview("x".repeat(200)).length).toBe(90);
  });
});

describe("citationHref", () => {
  const chapters = [{ dir: "a", title: "A", done: 0, total: 1, lessons: [{ id: "l04", title: "t", minutes: 1, status: "todo", revision: 1, updated: false }] }] as ChapterOutline[];

  it("points sources at the Sources list", () => {
    expect(citationHref({ kind: "source", ref: "3", label: "[3] x" }, "c", chapters)).toBe("#source-3");
  });

  it("routes lesson ids and falls back to a section anchor", () => {
    expect(citationHref({ kind: "lesson", ref: "l04", label: "x" }, "c", chapters)).toBe("/courses/c/lessons/l04");
    expect(citationHref({ kind: "lesson", ref: "narrowing-with-in", label: "x" }, "c", chapters)).toBe("#narrowing-with-in");
  });
});
