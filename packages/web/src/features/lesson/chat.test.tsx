// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ChatMessage } from "@selfschool/shared";
import { AskBar } from "./AskBar";
import { Thread, splitQuote } from "./Thread";

afterEach(cleanup);

const msg = (over: Partial<ChatMessage>): ChatMessage => ({
  id: 1, role: "assistant", content: "", covered: true, citations: [], status: "done", jobId: null, createdAt: 0, ...over,
});

function thread(messages: ChatMessage[], extra: Partial<Parameters<typeof Thread>[0]> = {}) {
  const onPropose = vi.fn();
  render(
    <MemoryRouter>
      <Thread courseId="c" chapters={[]} messages={messages} aiAvailable sources={new Set([3])} proposeState={() => "idle"} onPropose={onPropose} {...extra} />
    </MemoryRouter>,
  );
  return { onPropose };
}

describe("Thread", () => {
  it("shows the empty state", () => {
    thread([]);
    expect(screen.getByText(/No questions yet/)).toBeTruthy();
  });

  it("renders a covered answer with citation chips linking to sources", () => {
    thread([msg({ id: 2, content: "Because it may be absent. [3]", citations: [{ kind: "source", ref: "3", label: "[3] Handbook" }] })]);
    const chip = screen.getByRole("link", { name: "[3] Handbook" });
    expect(chip.getAttribute("href")).toBe("#source-3");
    expect(screen.getByText(/1 answer$/)).toBeTruthy();
  });

  it("shows a pending answer as it is written, then swaps to the final one with its citations", () => {
    thread([msg({ id: 2, status: "pending", content: "", covered: null, partial: "Because the compiler" })]);
    expect(screen.getByText(/Because the compiler/)).toBeTruthy();
    expect(screen.getByText(/Citations are added when the answer is done/)).toBeTruthy();
    expect(screen.queryByRole("status", { name: "Tutor is answering" })).toBeNull();
    cleanup();
    thread([msg({ id: 2, content: "Because the compiler compares shapes. [3]", citations: [{ kind: "source", ref: "3", label: "[3] Handbook" }] })]);
    expect(screen.queryByText(/Still writing/)).toBeNull();
    expect(screen.getByRole("link", { name: "[3] Handbook" })).toBeTruthy();
  });

  it("labels a covered answer as unverified when its lesson was written by the model", () => {
    const answer = msg({ id: 2, content: "Because of shapes." });
    thread([answer]);
    expect(screen.queryByText(/Unverified/)).toBeNull();
    cleanup();
    thread([answer], { unverified: true });
    expect(screen.getByText(/Unverified · this lesson was written by the model/)).toBeTruthy();
  });

  it("offers Propose as extension on a not-covered answer with the asked question", () => {
    const { onPropose } = thread([
      msg({ id: 1, role: "user", content: "How does Deno treat these?", covered: null }),
      msg({ id: 2, content: "Not covered in this course. Nothing mentions Deno.", covered: false }),
    ]);
    expect(screen.getByText("Not covered in this course.")).toBeTruthy();
    expect(screen.getByText("Nothing mentions Deno.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Propose as extension" }));
    expect(onPropose).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }), "How does Deno treat these?");
  });

  it("disables the button while proposing and confirms when done", () => {
    const m = [msg({ id: 2, content: "Not covered in this course.", covered: false })];
    thread(m, { proposeState: () => "pending" });
    expect((screen.getByRole("button", { name: "Proposing…" }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    thread(m, { proposeState: () => "done" });
    expect(screen.queryByRole("button", { name: /Propose/ })).toBeNull();
    expect(screen.getByRole("status").textContent).toMatch(/Proposed/);
  });

  it("shows a pending answer, with a different line while the runner is down", () => {
    thread([msg({ status: "pending" })]);
    expect(screen.getByRole("status").textContent).toMatch(/Looking through/);
    cleanup();
    thread([msg({ status: "pending" })], { aiAvailable: false });
    expect(screen.getByRole("status").textContent).toMatch(/Waiting for the runner/);
  });

  it("shows a failed answer", () => {
    thread([msg({ status: "failed" })]);
    expect(screen.getByRole("alert").textContent).toMatch(/couldn't answer/);
  });

  it("shows loading and error states", () => {
    thread([], { loading: true });
    expect(screen.getByText(/Loading conversation/)).toBeTruthy();
    cleanup();
    const retry = vi.fn();
    thread([], { error: true, onRetry: retry });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalled();
  });

  it("splits a quoted question", () => {
    expect(splitQuote("“a quote”\n\nWhy?")).toEqual({ quote: "a quote", question: "Why?" });
    expect(splitQuote("Plain")).toEqual({ quote: null, question: "Plain" });
  });
});

function bar(over: Partial<Parameters<typeof AskBar>[0]> = {}) {
  const onSend = vi.fn();
  const onChange = vi.fn();
  render(<AskBar initiallyOpen aiAvailable answerCount={2} value="Why?" onChange={onChange} quote={null} onClearQuote={() => {}} onSend={onSend} sending={false} {...over} />);
  return { onSend, onChange };
}

describe("AskBar", () => {
  it("is collapsed by default: one row, no input or paused notice", () => {
    bar({ initiallyOpen: false, value: "", aiAvailable: false });
    expect(screen.queryByLabelText("Ask about this lesson")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("link", { name: "2 answers ↓" })).toBeTruthy();
  });

  it("expands on click, shows the paused notice, and hides again", () => {
    bar({ initiallyOpen: false, value: "", aiAvailable: false });
    fireEvent.click(screen.getByRole("button", { name: /Ask about this lesson/ }));
    expect(screen.getByRole("status")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Hide ask box" }));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("auto-hides when focus leaves an unused box, but not one with a draft", () => {
    bar({ initiallyOpen: false, value: "" });
    fireEvent.click(screen.getByRole("button", { name: /Ask about this lesson/ }));
    const input = screen.getByLabelText("Ask about this lesson");
    fireEvent.blur(input, { relatedTarget: null });
    expect(screen.queryByLabelText("Ask about this lesson")).toBeNull();
    cleanup();
    bar({ initiallyOpen: false, value: "draft" });
    fireEvent.blur(screen.getByLabelText("Ask about this lesson"), { relatedTarget: null });
    expect(screen.getByLabelText("Ask about this lesson")).toBeTruthy();
  });

  it("sends on Enter and shows the jump chip", () => {
    const { onSend } = bar();
    fireEvent.keyDown(screen.getByLabelText("Ask about this lesson"), { key: "Enter" });
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: "2 answers ↓" }).getAttribute("href")).toBe("#thread");
  });

  it("does not send an empty question", () => {
    const { onSend } = bar({ value: "   " });
    fireEvent.keyDown(screen.getByLabelText("Ask about this lesson"), { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("is disabled with the warning notice while AI is paused", () => {
    const { onSend } = bar({ aiAvailable: false });
    const input = screen.getByLabelText("Ask about this lesson") as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(input.placeholder).toBe("Ask about this lesson (paused)");
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toBe("AI is paused. Chat and grading resume when you start the runner with school up.");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("shows the quoted selection and lets it be removed", () => {
    const clear = vi.fn();
    bar({ quote: "The compiler does not check", onClearQuote: clear });
    expect(screen.getByText(/The compiler does not check/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove quoted selection" }));
    expect(clear).toHaveBeenCalled();
  });

  it("blocks sending while a request is in flight", () => {
    const { onSend } = bar({ sending: true });
    fireEvent.keyDown(screen.getByLabelText("Ask about this lesson"), { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
  });
});
