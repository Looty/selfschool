// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { glossaryEntries, parseGlossary } from "./glossary";
import { Markdown } from "./MarkdownView";

afterEach(cleanup);

describe("glossary terms in rendered lesson text", () => {
  const entries = glossaryEntries(parseGlossary("- **Language model**: a program that estimates how likely each possible next piece of text is.\n- **Token**: a small chunk of text."));

  it("renders the first use of each term as <abbr data-def=meaning>, once", () => {
    const { container } = render(<Markdown text={"A language model reads a token. Every token counts, and a language model is big."} sources={new Set()} glossary={entries} />);
    const abbrs = [...container.querySelectorAll("abbr.gloss")];
    expect(abbrs.map((a) => a.textContent)).toEqual(["language model", "token"]);
    expect(abbrs[0]!.getAttribute("data-def")).toContain("estimates how likely");
  });

  it("does not touch code spans or blocks", () => {
    const { container } = render(<Markdown text={"Use `token` here.\n\n```py\ntoken = 1\n```"} sources={new Set()} glossary={entries} />);
    expect(container.querySelectorAll("abbr")).toHaveLength(0);
  });

  it("renders plain markdown when there is no glossary", () => {
    const { container } = render(<Markdown text="A token." sources={new Set()} />);
    expect(container.querySelectorAll("abbr")).toHaveLength(0);
  });
});
