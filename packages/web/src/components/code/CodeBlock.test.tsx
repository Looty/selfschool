// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CodeBlock } from "./CodeBlock";

afterEach(cleanup);

describe("CodeBlock", () => {
  it("offers the Rust Playground, prefilled, for a complete Rust program", () => {
    render(<CodeBlock lang="rust" code={'fn main() {\n    println!("hi");\n}'} />);
    const link = screen.getByRole("link", { name: /Run in Rust Playground/ });
    expect(link.getAttribute("href")).toContain(encodeURIComponent('println!("hi")'));
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("no playground for a Rust fragment or another language", () => {
    render(<CodeBlock lang="rust" code="let x = 5;" />);
    render(<CodeBlock lang="python" code="def main():\n    pass" />);
    expect(screen.queryByRole("link")).toBeNull();
  });
});
