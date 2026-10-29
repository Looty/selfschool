// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { AnswerResult, LearnerQuestion } from "@selfschool/shared";
import { QuestionPanel, type QuestionPanelProps } from "./QuestionPanel";
import { EMPTY_DRAFT, toInput, type Draft } from "./state";

afterEach(cleanup);

const mcq: LearnerQuestion = { id: "q1", type: "mcq", text: "Which line is a type error?", code: "const n = 5;\nn = 6;", options: [{ text: "const n = 5;" }, { text: "n = 6;" }, { text: "None" }] };
const open: LearnerQuestion = { id: "q3", type: "open", text: "Explain structural typing." };

const scoredWrong: AnswerResult = {
  questionId: "q1", type: "mcq", state: "scored", correct: false, marks: { got: 0, max: 1 }, feedback: null, jobId: null,
  options: [
    { text: "const n = 5;", correct: false, selected: true, explanation: "A declaration is fine." },
    { text: "n = 6;", correct: true, selected: false, explanation: "const cannot be reassigned." },
    { text: "None", correct: false, selected: false, explanation: "Line 2 fails." },
  ],
};

const base = (over: Partial<QuestionPanelProps>): QuestionPanelProps => ({
  index: 0, total: 4, question: mcq, draft: EMPTY_DRAFT, result: undefined, stage: "answering", error: null,
  courseId: "ts", lessonId: "l06", aiPaused: false, finishing: false,
  onDraft: () => {}, onCheck: () => {}, onNext: () => {}, onFinish: () => {}, ...over,
});

const renderPanel = (props: QuestionPanelProps) =>
  render(
    <MemoryRouter>
      <QuestionPanel {...props} />
    </MemoryRouter>,
  );

/** Panel driven the way the page drives it: draft state, then a result after Check. */
function Harness({ onCheck, onNext, result }: { onCheck: (input: unknown) => void; onNext: () => void; result: AnswerResult }) {
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [checked, setChecked] = useState(false);
  return (
    <MemoryRouter>
      <QuestionPanel
        {...base({})}
        draft={draft}
        result={checked ? result : undefined}
        stage={checked ? "answered" : "answering"}
        onDraft={setDraft}
        onCheck={() => {
          onCheck(toInput(mcq, draft));
          setChecked(true);
        }}
        onNext={onNext}
      />
    </MemoryRouter>
  );
}

describe("check / next flow", () => {
  it("Check is disabled until an option is chosen, then reveals explanations and offers Next", async () => {
    const user = userEvent.setup();
    const onCheck = vi.fn();
    const onNext = vi.fn();
    render(<Harness onCheck={onCheck} onNext={onNext} result={scoredWrong} />);

    const check = screen.getByRole("button", { name: "Check answer" });
    expect((check as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    // no answer key or explanation before submit
    expect(screen.queryByText("const cannot be reassigned.")).toBeNull();
    expect(screen.queryByText("Correct answer")).toBeNull();

    await user.click(screen.getByRole("radio", { name: /const n = 5;/ }));
    expect((check as HTMLButtonElement).disabled).toBe(false);
    await user.click(check);
    expect(onCheck).toHaveBeenCalledWith({ type: "mcq", selected: [0] });

    // status pill is text in a live region; options carry text tags, not just colour
    expect(within(screen.getByRole("status")).getAllByText("Incorrect").length).toBeGreaterThan(0);
    expect(screen.getByText("Your answer")).toBeTruthy();
    expect(screen.getByText("Correct answer")).toBeTruthy();
    expect(screen.getByText("const cannot be reassigned.")).toBeTruthy();
    expect(screen.queryByRole("radio")).toBeNull();

    const next = screen.getByRole("button", { name: "Next question" });
    expect(document.activeElement).toBe(next);
    await user.keyboard("{Enter}");
    expect(onNext).toHaveBeenCalledOnce();
  });

  it("Enter checks and a number key picks an option", async () => {
    const user = userEvent.setup();
    const onDraft = vi.fn();
    const onCheck = vi.fn();
    renderPanel(base({ draft: { selected: [1], text: "" }, onDraft, onCheck }));
    await user.keyboard("3");
    expect(onDraft).toHaveBeenCalledWith({ selected: [2], text: "" });
    await user.keyboard("{Enter}");
    expect(onCheck).toHaveBeenCalledOnce();
  });

  it("the last question offers See results", async () => {
    const user = userEvent.setup();
    const onFinish = vi.fn();
    renderPanel(base({ index: 3, result: scoredWrong, stage: "answered", onFinish }));
    await user.click(screen.getByRole("button", { name: "See results" }));
    expect(onFinish).toHaveBeenCalledOnce();
  });

  it("a failed submit shows an alert and keeps Check available", () => {
    renderPanel(base({ draft: { selected: [0], text: "" }, error: "offline" }));
    expect(screen.getByRole("alert").textContent).toMatch(/offline/);
    expect((screen.getByRole("button", { name: "Check answer" }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("grading pending -> feedback", () => {
  const grading: AnswerResult = { questionId: "q3", type: "open", state: "grading", correct: null, marks: null, answerText: "same shape", feedback: null, jobId: "j1" };
  const graded: AnswerResult = {
    questionId: "q3", type: "open", state: "graded", correct: false, marks: { got: 2, max: 3 }, answerText: "same shape", jobId: "j1",
    feedback: {
      marks: { got: 2, max: 3 },
      points: [
        { ok: true, text: "Names the core idea." },
        { ok: false, text: "Misses that the compiler does not verify the guard body.", lesson: { id: "l06", title: "Type guards" } },
      ],
    },
  };

  it("shows the queued state with skeleton lines, then the feedback card on the same panel", () => {
    const props = base({ question: open, index: 2, stage: "answered", result: grading });
    const { rerender, container } = renderPanel(props);

    expect(screen.getAllByText("Grading…").length).toBeGreaterThan(0);
    expect(screen.getByText(/Queued for the runner/)).toBeTruthy();
    expect(container.querySelectorAll('[aria-hidden="true"] .shimmer').length).toBe(2);
    expect(container.querySelectorAll(".spinner").length).toBeGreaterThan(0);
    expect(screen.queryByText("AI-graded against the rubric")).toBeNull();
    // the learner can move on while grading
    expect((screen.getByRole("button", { name: "Next question" }) as HTMLButtonElement).disabled).toBe(false);

    rerender(
      <MemoryRouter>
        <QuestionPanel {...props} result={graded} />
      </MemoryRouter>,
    );

    expect(within(screen.getByRole("status")).getAllByText("2 / 3 POINTS").length).toBeGreaterThan(0);
    expect(screen.getByText("Feedback")).toBeTruthy();
    expect(screen.getByText("AI-graded against the rubric")).toBeTruthy();
    expect(screen.getByText(/Met:/)).toBeTruthy();
    expect(screen.getByText(/Missed:/)).toBeTruthy();
    expect(screen.queryByText(/Queued for the runner/)).toBeNull();
    expect(screen.getByRole("link", { name: "Type guards" }).getAttribute("href")).toBe("/courses/ts/lessons/l06");
    expect(screen.getByRole("link", { name: /Ask about this/ }).getAttribute("href")).toBe(`/courses/ts/lessons/l06?ask=${encodeURIComponent(open.text)}`);
  });

  it("paused AI shows an explicit notice before submitting", () => {
    renderPanel(base({ question: open, index: 2, aiPaused: true }));
    expect(screen.getByRole("note").textContent).toMatch(/paused.*against the rubric and mark it yourself.*AI grades it later/);
  });
});

describe("self-check while AI is paused", () => {
  const rubric = "Says types are compared by shape.";
  const pending: AnswerResult = { questionId: "q3", type: "open", state: "grading", correct: null, marks: null, answerText: "same shape", rubric, feedback: null, jobId: "j1" };
  const marked: AnswerResult = { ...pending, state: "self", selfMark: "partly", correct: false, marks: { got: 0.5, max: 1 } };

  it("shows the rubric and three marks instead of the grading spinner, and sends the chosen mark", async () => {
    const user = userEvent.setup();
    const onSelfMark = vi.fn();
    const { container } = renderPanel(base({ question: open, index: 2, stage: "answered", result: pending, aiPaused: true, onSelfMark }));
    expect(screen.getByText(rubric)).toBeTruthy();
    expect(screen.queryByText(/Queued for the runner/)).toBeNull();
    expect(container.querySelectorAll(".spinner")).toHaveLength(0);
    expect(within(screen.getByRole("status")).getAllByText("Mark it yourself").length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "Partly" }));
    expect(onSelfMark).toHaveBeenCalledWith("partly");
    // the quiz keeps moving without a mark
    expect((screen.getByRole("button", { name: "Next question" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("keeps the grading view when AI is running", () => {
    renderPanel(base({ question: open, index: 2, stage: "answered", result: pending, aiPaused: false, onSelfMark: () => {} }));
    expect(screen.getByText(/Queued for the runner/)).toBeTruthy();
    expect(screen.queryByText(rubric)).toBeNull();
  });

  it("shows the chosen mark as pressed, labelled in the status pill, and offers Ask about this", () => {
    renderPanel(base({ question: open, index: 2, stage: "answered", result: marked, aiPaused: true, onSelfMark: () => {} }));
    expect(screen.getByRole("button", { name: "Partly" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Got it" }).getAttribute("aria-pressed")).toBe("false");
    expect(within(screen.getByRole("status")).getAllByText("Self-marked · partly").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /Ask about this/ })).toBeTruthy();
  });
});
