// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { routeDef, type Dashboard } from "@selfschool/shared";

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

import { DashboardView } from "./index";

const empty: Dashboard = {
  courses: [],
  continue: null,
  pendingGrading: 0,
  weakSpots: [],
  week: { studiedMinutes: 0, questionsAnswered: 0, streakDays: 0, days: [] },
  activity: [],
} as unknown as Dashboard;

afterEach(cleanup);

describe("first run", () => {
  it("shows the welcome card instead of an empty dashboard when no course is installed", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <DashboardView data={empty} paused={false} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByRole("heading", { name: "Welcome to Selfschool" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /Import from a GitHub link or zip/ }));
    expect(screen.getByRole("dialog", { name: "Import a course" })).toBeTruthy();
    expect((screen.getByLabelText("Repository URL") as HTMLInputElement).value).toBe("https://github.com/Looty/selfschool-courses");
    expect(screen.queryByText("Dashboard")).toBeNull();
  });
});
