// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BottomStack } from "./BottomStack";

afterEach(cleanup);

describe("bottom stack", () => {
  it("keeps focused page content above it, but drops that padding while focus is inside it (typing there must not scroll the page)", () => {
    render(
      <>
        <button type="button">in the lesson</button>
        <BottomStack>
          <textarea aria-label="Input lines" />
          <input aria-label="Arguments" />
        </BottomStack>
      </>,
    );
    const root = document.documentElement.style;
    expect(root.scrollPaddingBottom).toBe("0px"); // jsdom lays nothing out, so the stack is 0px tall
    (screen.getByLabelText("Input lines") as HTMLTextAreaElement).focus();
    expect(root.scrollPaddingBottom).toBe("");
    (screen.getByLabelText("Arguments") as HTMLInputElement).focus();
    expect(root.scrollPaddingBottom).toBe("");
    screen.getByRole("button", { name: "in the lesson" }).focus();
    expect(root.scrollPaddingBottom).toBe("0px");
  });
});
