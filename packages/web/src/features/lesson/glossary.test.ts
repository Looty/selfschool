import { describe, expect, it } from "vitest";
import { glossaryEntries, glossaryRegex, meaningFor, parseGlossary, remarkGlossary, unmatchedLines } from "./glossary";

const block = `- **Language model**: a program that estimates how likely each possible next piece of text is.
- **LLM (large language model)**: a language model with a very large number of adjustable numbers.
- **Example / label / feature**: one row of data / its known right answer / the facts the program looks at in it.
- **Token**: a small chunk of text turned into an integer.`;

describe("parseGlossary", () => {
  it("reads '- **Term**: meaning' lines", () => {
    const lines = parseGlossary(block);
    expect(lines).toHaveLength(4);
    expect(lines[0]).toEqual({ term: "Language model", meaning: "a program that estimates how likely each possible next piece of text is." });
  });
});

describe("glossaryEntries", () => {
  const entries = glossaryEntries(parseGlossary(block));
  const phrases = entries.map((e) => e.phrase);
  it("splits a parenthesised term into its short and long forms", () => {
    expect(phrases).toContain("LLM");
    expect(phrases).toContain("large language model");
  });
  it("splits 'a / b / c' terms pairwise when the meaning has the same number of parts", () => {
    expect(meaningFor(entries, "label")).toBe("its known right answer");
    expect(meaningFor(entries, "feature")).toBe("the facts the program looks at in it.");
  });
  it("matches case-insensitively and with a plural", () => {
    expect(meaningFor(entries, "Tokens")).toBe("a small chunk of text turned into an integer.");
  });
  it("matches whole words only", () => {
    const re = glossaryRegex(entries)!;
    expect("labelled data".match(re)).toBeNull();
    expect("a label here".match(re)?.[0]).toBe("label");
  });
});

describe("remarkGlossary", () => {
  const entries = glossaryEntries(parseGlossary(block));
  const run = (tree: unknown) => remarkGlossary(entries)()(tree as never);
  it("wraps only the first use of a term in an abbr with the meaning", () => {
    const tree = { type: "root", children: [{ type: "paragraph", children: [{ type: "text", value: "A token is small. Each token is an integer." }] }] };
    run(tree);
    const kids = (tree.children[0] as { children: Array<{ type: string; data?: { hProperties: { dataDef: string } } }> }).children;
    expect(kids.filter((k) => k.type === "gloss")).toHaveLength(1);
    expect(kids.find((k) => k.type === "gloss")!.data!.hProperties.dataDef).toContain("small chunk of text");
  });
  it("leaves inline code, links and headings alone", () => {
    const tree = {
      type: "root",
      children: [
        { type: "heading", children: [{ type: "text", value: "Token basics" }] },
        { type: "paragraph", children: [{ type: "inlineCode", value: "token" }, { type: "link", children: [{ type: "text", value: "token" }] }] },
      ],
    };
    run(tree);
    expect(JSON.stringify(tree)).not.toContain('"gloss"');
  });
});

describe("unmatchedLines", () => {
  it("lists glossary lines whose words never appear in the prose", () => {
    const lines = parseGlossary(block);
    const left = unmatchedLines(lines, "A language model reads a token.");
    expect(left.map((l) => l.term)).toEqual(["LLM (large language model)", "Example / label / feature"]);
  });
});
