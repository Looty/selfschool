// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Lesson } from "@selfschool/shared";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorDrawer } from "../run/EditorDrawer";
import { LabProvider } from "../run/lab";
import { LabDock } from "../run/LabDock";
import { Article } from "./Article";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

// Only the fields Article reads; the rest of the response does not matter here.
const lesson = {
  course: { id: "c" },
  lesson: { id: "l04", title: "Lab" },
  number: 4,
  minutes: 5,
  revision: 1,
  standfirst: "Intro.",
  markdown: 'Download `lab01.py` from Resources, then run `other.py`.\n\n```sh\nlab01.py\n```\n\n```bash\npip install numpy\npython lab01.py "hi there"\n```',
  sources: [],
  resources: [
    { name: "lab01.py", url: "/api/courses/c/files/resources/lab01.py" },
    { name: "data.csv", url: "/api/courses/c/files/resources/data.csv" },
  ],
  prev: null,
  next: null,
  quiz: null,
  completed: false,
} as unknown as Lesson;

/** The article as the lesson page shows it: inside the lab, with the docked terminal and the editor drawer. */
const renderArticle = (l: Lesson = lesson) =>
  render(
    <MemoryRouter>
      <LabProvider courseId="c" resources={l.resources}>
        <Article lesson={l} fontFamily="serif" onAsk={() => {}} onComplete={() => {}} onNext={() => {}} completing={false} />
        <EditorDrawer />
        <LabDock />
      </LabProvider>
    </MemoryRouter>,
  );

describe("lesson resources", () => {
  // A download link only reaches a service worker whose scope covers it, so under a sub-path it must point inside it.
  it("points the download under the base path", () => {
    vi.stubEnv("BASE_URL", "/selfschool/");
    renderArticle();
    const links = screen.getAllByRole("link", { name: /lab01\.py/ });
    expect(links).toHaveLength(2); // the mention in the text and the Resources list
    for (const a of links) expect(a.getAttribute("href")).toBe("/selfschool/api/courses/c/files/resources/lab01.py");
  });

  it("keeps the plain api path at the root base", () => {
    renderArticle();
    for (const a of screen.getAllByRole("link", { name: /lab01\.py/ })) expect(a.getAttribute("href")).toBe("/api/courses/c/files/resources/lab01.py");
  });

  // The browser's own download request skips the in-browser build's service worker, so a click downloads through fetch().
  it("a click on a resource link downloads it through fetch, not by following the link", async () => {
    vi.stubEnv("BASE_URL", "/selfschool/");
    const fetchMock = vi.fn(async (_url: string) => new Response("print(1)"));
    vi.stubGlobal("fetch", fetchMock);
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    const saved: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      saved.push(`${this.href} ${this.download}`);
    });
    renderArticle();
    for (const link of screen.getAllByRole("link", { name: /lab01\.py/ })) {
      expect(fireEvent.click(link)).toBe(false); // the native download was prevented
    }
    await waitFor(() => expect(saved).toEqual(["blob:x lab01.py", "blob:x lab01.py"]));
    expect(fetchMock.mock.calls.filter(([u]) => u === "/api/courses/c/files/resources/lab01.py").length).toBeGreaterThanOrEqual(2);
    click.mockRestore();
    vi.unstubAllGlobals();
  });

  /** Records what the runner starts, in place of a real worker. */
  const started: { entry: string; args: string[] }[] = [];
  const stubRunner = () => {
    started.length = 0;
    vi.stubGlobal("fetch", vi.fn(async () => new Response("print(1)")));
    vi.stubGlobal(
      "Worker",
      class {
        onmessage = null;
        onerror = null;
        postMessage(req: { entry: string; args: string[] }) {
          started.push({ entry: req.entry, args: req.args });
        }
        terminate() {}
      },
    );
    Element.prototype.scrollIntoView = () => {};
  };

  /** The lab card's Run for a file, once the browser check has read it. */
  const labRun = async (name: string) => {
    const button = (await screen.findByRole("button", { name: `Run ${name} in the browser` })) as HTMLButtonElement;
    await waitFor(() => expect(button.disabled).toBe(false));
    return button;
  };

  it("puts a lab card near the top whose Run starts the script in the docked terminal", async () => {
    stubRunner();
    renderArticle();
    const card = screen.getByRole("region", { name: "Lab" });
    expect(card.textContent).toMatch(/runs in your browser/);
    // the command shown is the lesson's own, with its arguments
    expect(card.textContent).toContain('$ python lab01.py "hi there"');
    expect(screen.queryByRole("button", { name: "Run data.csv in the browser" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Terminal" })).toBeNull();
    fireEvent.click(await labRun("lab01.py"));
    // the terminal is docked at the bottom of the page, not inside the card
    const terminal = screen.getByRole("region", { name: "Terminal" });
    expect(card.contains(terminal)).toBe(false);
    expect(within(terminal).getByText(/\$ python lab01\.py/)).toBeTruthy();
    await waitFor(() => expect(started).toEqual([{ entry: "lab01.py", args: ["hi there"] }]));
    vi.unstubAllGlobals();
  });

  it("the lab card's Edit opens the script in the editor drawer", async () => {
    stubRunner();
    renderArticle();
    const edit = (await screen.findByRole("button", { name: "Edit lab01.py" })) as HTMLButtonElement;
    await waitFor(() => expect(edit.disabled).toBe(false));
    fireEvent.click(edit);
    expect(((await screen.findByLabelText("Code of lab01.py")) as HTMLTextAreaElement).value).toBe("print(1)");
    expect(started).toEqual([]);
    vi.unstubAllGlobals();
  });

  it("a script that needs torch says so up front: download, and no Run anywhere", async () => {
    started.length = 0;
    vi.stubGlobal("fetch", vi.fn(async () => new Response("import torch\nprint(torch.ones(2))")));
    const torchLesson = {
      ...lesson,
      markdown: "Download `lab09.py`, then:\n\n```bash\npython lab09.py\n```",
      resources: [{ name: "lab09.py", url: "/api/courses/c/files/resources/lab09.py" }],
    } as unknown as Lesson;
    renderArticle(torchLesson);
    const card = screen.getByRole("region", { name: "Lab" });
    expect(await within(card).findByText(/needs torch, which cannot run in a browser/)).toBeTruthy();
    expect(card.textContent).toMatch(/Run this lab on your computer/);
    expect(within(card).getByRole("button", { name: "Download lab09.py" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Run lab09\.py/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /python lab09\.py/ })).toBeNull();
    vi.unstubAllGlobals();
  });

  it("the Lab card is the one place to run a script: the lesson text has no Run buttons of its own", async () => {
    stubRunner();
    const { container } = renderArticle();
    await labRun("lab01.py");
    // the file mention and the command block that runs it stay a download link and a plain command
    expect(container.querySelectorAll(".lesson-prose button")).toHaveLength(0);
    expect(screen.getAllByRole("button", { name: /^Run lab01\.py/ })).toHaveLength(1);
    vi.unstubAllGlobals();
  });

  it("links inline code naming a resource, not other code or code blocks", () => {
    const { container } = renderArticle();
    const inline = container.querySelector(".lesson-prose a[download] code");
    expect(inline?.textContent).toBe("lab01.py");
    expect(container.querySelectorAll(".lesson-prose a[download]")).toHaveLength(1);
    expect(screen.getByText("other.py").closest("a")).toBeNull();
  });
});

describe("lesson quiz gate", () => {
  const withQuiz = (quiz: { attempted: boolean; passed: boolean; bestPercent: number | null }, completed = false) =>
    ({ ...lesson, resources: [], next: { id: "l05", title: "Next one" }, quiz: { id: "q04", title: "Quiz", questionCount: 3, ...quiz }, completed }) as unknown as Lesson;

  it("locks the next lesson until the quiz is taken once", () => {
    renderArticle(withQuiz({ attempted: false, passed: false, bestPercent: null }));
    expect(screen.getByText("Take it to unlock the next lesson")).toBeTruthy();
    expect(screen.getByText("Next · locked")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Take the quiz" })).toBeTruthy();
  });

  it("after a failed attempt, says so and lets the reader move on", () => {
    const onNext = vi.fn();
    render(
      <MemoryRouter>
        <LabProvider courseId="c" resources={[]}>
          <Article lesson={withQuiz({ attempted: true, passed: false, bestPercent: 54.5 })} fontFamily="serif" onAsk={() => {}} onComplete={() => {}} onNext={onNext} completing={false} />
        </LabProvider>
      </MemoryRouter>,
    );
    expect(screen.getByText("Not passed yet (best 55%): retake it now or later")).toBeTruthy();
    expect(screen.queryByText("Next · locked")).toBeNull();
    expect(screen.getByRole("link", { name: "Retake quiz" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Next one/ }));
    expect(onNext).toHaveBeenCalledOnce();
  });

  it("a lesson completed past a failed quiz keeps showing it was not passed", () => {
    renderArticle(withQuiz({ attempted: true, passed: false, bestPercent: 40 }, true));
    expect(screen.getByText("Not passed yet (best 40%): retake it now or later")).toBeTruthy();
    expect(screen.queryByText(/^Passed/)).toBeNull();
  });
});
