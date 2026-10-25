import { describe, expect, it } from "vitest";
import { extractCitations, linkCitations, parseBlocks, slugify } from "./markdown";

describe("parseBlocks", () => {
  it("splits markdown and directive blocks in order", () => {
    const md = "Intro [3]\n\n:::low-confidence\nCheck the notes. [7]\n:::\n\nMiddle\n\n:::key-takeaways\n- one\n- two\n:::";
    expect(parseBlocks(md)).toEqual([
      { kind: "markdown", text: "Intro [3]" },
      { kind: "low-confidence", text: "Check the notes. [7]" },
      { kind: "markdown", text: "Middle" },
      { kind: "key-takeaways", text: "- one\n- two" },
    ]);
  });

  it("recognises the glossary directive", () => {
    expect(parseBlocks(":::glossary\n- **Drift**: the world changed.\n:::")).toEqual([{ kind: "glossary", text: "- **Drift**: the world changed." }]);
  });

  it("ignores directives inside code fences", () => {
    const md = "```md\n:::low-confidence\nnot a callout\n:::\n```";
    expect(parseBlocks(md)).toEqual([{ kind: "markdown", text: md }]);
  });

  it("keeps a closing marker inside a fence within a directive", () => {
    const md = ":::key-takeaways\n```\n:::\n```\nafter\n:::";
    expect(parseBlocks(md)).toEqual([{ kind: "key-takeaways", text: "```\n:::\n```\nafter" }]);
  });

  it("leaves an unclosed directive as literal markdown", () => {
    const md = ":::low-confidence\nnever closed";
    expect(parseBlocks(md)).toEqual([{ kind: "markdown", text: md }]);
  });

  it("keeps the content of an unknown directive as plain markdown", () => {
    expect(parseBlocks("a\n\n:::note\nbody\n:::\n\nb")).toEqual([{ kind: "markdown", text: "a\n\nbody\n\nb" }]);
  });

  it("handles CRLF and empty input", () => {
    expect(parseBlocks(":::key-takeaways\r\n- x\r\n:::\r\n")).toEqual([{ kind: "key-takeaways", text: "- x" }]);
    expect(parseBlocks("")).toEqual([]);
  });
});

describe("citations", () => {
  it("extracts unique sorted numbers from prose only", () => {
    const md = "A [7] and [3]. Again [3].\n\n```ts\nconst a = b[1];\n```\n\nCode `x[2]` stays. Link [4](http://x) and ![i][5] skipped.";
    expect(extractCitations(md)).toEqual([3, 7]);
  });

  it("links known sources and leaves unknown numbers as text", () => {
    expect(linkCitations("See [3] and [9].", new Set([3]))).toBe("See [\\[3\\]](#source-3) and [9].");
  });

  it("does not rewrite inside code", () => {
    const md = "`a[3]`\n\n```\n[3]\n```";
    expect(linkCitations(md, new Set([3]))).toBe(md);
  });
});

describe("slugify", () => {
  it("builds heading ids", () => {
    expect(slugify("Narrowing with in")).toBe("narrowing-with-in");
    expect(slugify("User-defined guards!")).toBe("user-defined-guards");
  });
});
