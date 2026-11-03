// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BackToTop, showBackToTop } from "./BackToTop";

afterEach(cleanup);

describe("showBackToTop", () => {
  it("stays hidden within the first screen and shows past it", () => {
    expect(showBackToTop(0, 800)).toBe(false);
    expect(showBackToTop(800, 800)).toBe(false);
    expect(showBackToTop(801, 800)).toBe(true);
  });
});

describe("BackToTop", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
    Object.defineProperty(window, "scrollY", { configurable: true, writable: true, value: 0 });
  });
  afterEach(() => vi.unstubAllGlobals());

  const scrollTo = (y: number) =>
    act(() => {
      (window as { scrollY: number }).scrollY = y;
      window.dispatchEvent(new Event("scroll"));
    });

  it("appears once scrolled down and scrolls back to the top on click", () => {
    const spy = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    render(<BackToTop />);
    expect(screen.queryByRole("button", { name: "Back to top" })).toBeNull();
    scrollTo(2000);
    fireEvent.click(screen.getByRole("button", { name: "Back to top" }));
    expect(spy).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
    scrollTo(100);
    expect(screen.queryByRole("button", { name: "Back to top" })).toBeNull();
  });

  it("stays out of the way while hidden", () => {
    render(<BackToTop hidden />);
    scrollTo(2000);
    expect(screen.queryByRole("button", { name: "Back to top" })).toBeNull();
  });
});
