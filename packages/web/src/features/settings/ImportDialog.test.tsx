// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { CourseChoice, PackagePreview } from "@selfschool/shared";

const choice = (path: string, title: string): CourseChoice => ({ path, id: path, title, level: "Beginner", lessonCount: 3, ok: null, conflict: "none" });
const preview: PackagePreview = {
  ok: true, fileName: "github.com/o/r", sizeBytes: 0, fileCount: 0, checks: [], issues: [], conflict: "none", course: null,
  choices: [choice("a", "Course A"), choice("b", "Course B")],
};

vi.mock("../../api/client", async (orig) => ({
  ...(await orig<typeof import("../../api/client")>()),
  previewRepo: async () => preview,
}));

import { ImportDialog } from "./ImportDialog";

afterEach(cleanup);

describe("a repository of several courses", () => {
  it("starts with no course ticked, so nothing is imported until the learner picks", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <ImportDialog source={{ kind: "repo", body: { url: "https://github.com/o/r", path: "", ref: "main" } }} onClose={() => {}} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("0 of 2 selected")).toBeTruthy();
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes.map((b) => b.checked)).toEqual([false, false]);
    expect((screen.getByRole("button", { name: "Import 0 courses" }) as HTMLButtonElement).disabled).toBe(true);

    await userEvent.click(boxes[1]!);
    expect(screen.getByText("1 of 2 selected")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Import 1 course" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
