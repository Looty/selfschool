// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { routeDef } from "@selfschool/shared";

// Route the typed client to the in-memory mock so the real hooks run end to end.
vi.mock("../../api/client", async (orig) => {
  const actual = await orig<typeof import("../../api/client")>();
  return {
    ...actual,
    callApi: async (name: never, ...rest: unknown[]) => {
      const { mockTransport } = await import("../../api/mock");
      return routeDef(name).res.parse(await mockTransport(name, (rest[0] ?? {}) as Record<string, unknown>));
    },
  };
});

import QuizFeature from "./index";
import { resetMock } from "../../api/mock";

function renderQuiz() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/courses/typescript-fundamentals/quizzes/q06"]}>
        <Routes>
          <Route path="/courses/:courseId/quizzes/:quizId" element={<QuizFeature />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  resetMock();
});
afterEach(cleanup);

describe("quiz page against the mock api", () => {
  it("runs the quiz: check, next, grading, feedback, results", async () => {
    const user = userEvent.setup();
    renderQuiz();

    // Q1: mcq (wrong answer), never shows the key before submit
    expect(await screen.findByText("Which line is a type error?")).toBeTruthy();
    expect(screen.queryByText("Correct answer")).toBeNull();
    await user.click(screen.getByRole("radio", { name: /const n = 5;/ }));
    await user.click(screen.getByRole("button", { name: "Check answer" }));
    expect(await screen.findByText("Correct answer")).toBeTruthy();
    expect(within(screen.getByRole("status")).getAllByText("Incorrect").length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "Next question" }));

    // Q2: short answer, instant result
    await screen.findByLabelText("Your short answer");
    await user.type(screen.getByLabelText("Your short answer"), "object");
    await user.keyboard("{Enter}");
    expect((await screen.findAllByText("Correct")).length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "Next question" }));

    // Q3: open-ended -> Grading… -> the runner finishes -> Feedback (polling)
    await user.type(await screen.findByLabelText("Your answer"), "Same shape means compatible.");
    await user.click(screen.getByRole("button", { name: "Submit answer" }));
    expect((await screen.findAllByText("Grading…")).length).toBeGreaterThan(0);
    expect(screen.getByText(/Queued for the runner/)).toBeTruthy();
    expect(await screen.findByText("AI-graded against the rubric", {}, { timeout: 9000 })).toBeTruthy();
    expect(screen.queryByText(/Queued for the runner/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Next question" }));

    // Q4: open-ended again, left grading
    await user.type(await screen.findByLabelText("Your answer"), "x");
    await user.click(screen.getByRole("button", { name: "Submit answer" }));
    await screen.findAllByText("Grading…");
    await user.click(screen.getByRole("button", { name: "Next question" }));

    // Q5: fill. Pick a chip, then a slot; Check stays off until every slot is filled; one wrong chip is partly correct
    expect(await screen.findByText(/Fill the gaps/)).toBeTruthy();
    const check = screen.getByRole("button", { name: "Check answer" }) as HTMLButtonElement;
    expect(check.disabled).toBe(true);
    for (const [chip, slot] of [["if (test(item))", 1], ["break;", 2], ["return undefined;", 3]] as const) {
      await user.click(screen.getByRole("button", { name: chip }));
      await user.click(screen.getByRole("button", { name: new RegExp(`^Slot ${slot}: empty`) }));
    }
    expect(check.disabled).toBe(false);
    await user.click(check);
    expect((await screen.findAllByText("Partly correct")).length).toBeGreaterThan(0);
    const page = document.body.textContent ?? "";
    expect(page).toMatch(/Slot 2 should be:\s*return item;\.\s*Stops at the first item that passes\./);
    expect(page).toMatch(/Why not\s*break;:\s*Leaves the loop but returns nothing for a match\./);
    await user.click(screen.getByRole("button", { name: "See results" }));

    expect(await screen.findByRole("heading", { name: "Result" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Attempt 1/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retake quiz" })).toBeTruthy();
  }, 30_000);

  it("shows a retryable error when the quiz does not load", async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={["/courses/typescript-fundamentals/quizzes/nope"]}>
          <Routes>
            <Route path="/courses/:courseId/quizzes/:quizId" element={<QuizFeature />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/not found/i));
  });
});
