// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SavedToaster, notifySaved } from "./Toast";

describe("SavedToaster", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("shows the message when something is saved, then hides it", () => {
    render(<SavedToaster />);
    expect(screen.queryByText("Saved")).toBeNull();
    act(() => notifySaved());
    expect(screen.getByText("Saved")).toBeTruthy();
    act(() => void vi.advanceTimersByTime(2100));
    expect(screen.queryByText("Saved")).toBeNull();
  });

  it("restarts the timer when saved again and can show a custom message", () => {
    render(<SavedToaster />);
    act(() => notifySaved());
    act(() => void vi.advanceTimersByTime(1500));
    act(() => notifySaved("Theme saved"));
    act(() => void vi.advanceTimersByTime(1500));
    expect(screen.getByText("Theme saved")).toBeTruthy();
  });
});
