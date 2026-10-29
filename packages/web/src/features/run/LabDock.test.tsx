// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorDrawer } from "./EditorDrawer";
import { LabProvider, useLab } from "./lab";
import { LabDock } from "./LabDock";
import type { RunEvent, RunLanguage, RunRequest } from "./protocol";
import { setLabSize } from "./resize";
import { getFile, resetWorkspaces } from "./workspace";

/** Stands in for a run worker: records requests and lets the test send events back. */
class FakeWorker {
  static all: FakeWorker[] = [];
  requests: RunRequest[] = [];
  terminated = false;
  onmessage: ((e: MessageEvent<RunEvent>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  constructor(readonly language: RunLanguage) {
    FakeWorker.all.push(this);
  }
  postMessage(req: RunRequest) {
    this.requests.push(req);
  }
  terminate() {
    this.terminated = true;
  }
  emit(ev: RunEvent) {
    act(() => this.onmessage?.({ data: ev } as MessageEvent<RunEvent>));
  }
}

const create = (language: RunLanguage) => new FakeWorker(language) as unknown as Worker;
const bytes = (s: string) => new TextEncoder().encode(s);
const text = (b: Uint8Array | undefined) => (b ? new TextDecoder().decode(b) : undefined);
const resources = [
  { name: "lab-corpus.py", url: "/api/courses/c/files/resources/lab-corpus.py" },
  { name: "other.py", url: "/api/courses/c/files/resources/other.py" },
  { name: "notes.md", url: "/api/courses/c/files/resources/notes.md" },
];

/** What the page's Lab card and Run buttons do, as plain buttons. */
function Triggers() {
  const lab = useLab()!;
  return (
    <>
      <button type="button" onClick={() => lab.run("lab-corpus.py", '"a b" 3')}>
        run corpus
      </button>
      <button type="button" onClick={() => lab.run("other.py")}>
        run other
      </button>
      <button type="button" onClick={() => lab.show("lab-corpus.py", true)}>
        edit corpus
      </button>
      <button type="button" onClick={lab.openEmpty}>
        own file
      </button>
    </>
  );
}

const renderLab = () =>
  render(
    <LabProvider courseId="c" resources={resources} createWorker={create}>
      <Triggers />
      <LabDock />
      <EditorDrawer />
    </LabProvider>,
  );

/** The lesson's files are in the working folder. */
const loaded = () => waitFor(() => expect(getFile("c", "notes.md")).toBeTruthy());
const dock = () => within(screen.getByRole("region", { name: "Terminal" }));

beforeEach(() => {
  resetWorkspaces();
  FakeWorker.all = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(`# ${url.split("/").pop()}\nprint("hi")\n`)));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("docked terminal", () => {
  it("stays hidden until something runs, then runs the file with its arguments, input lines and the whole folder", async () => {
    const user = userEvent.setup();
    renderLab();
    await loaded();
    expect(screen.queryByRole("region", { name: "Terminal" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "run corpus" }));
    const w = FakeWorker.all[0]!;
    expect(w.language).toBe("python");
    expect(w.requests[0]).toMatchObject({ entry: "lab-corpus.py", args: ["a b", "3"], stdin: [] });
    expect(w.requests[0]!.files.map((f) => f.path)).toEqual(["lab-corpus.py", "notes.md", "other.py"]);
    // the command line shows what runs, with the arguments in place
    expect(dock().getByText(/\$ python lab-corpus\.py/)).toBeTruthy();
    expect((dock().getByLabelText("Arguments") as HTMLInputElement).value).toBe('"a b" 3');
    expect(dock().getByRole("button", { name: "Stop" })).toBeTruthy();
    expect(dock().getByTitle(/cannot read or change anything on your computer, your Selfschool data or your local network/)).toBeTruthy();

    w.emit({ type: "out", stream: "stdout", text: "wrote input.txt\n" });
    w.emit({ type: "files", files: [{ path: "input.txt", data: bytes("to be or not") }] });
    w.emit({ type: "done", code: 0 });
    expect(dock().getByRole("log").textContent).toMatch(/wrote input.txt/);
    expect(dock().getByRole("status").textContent).toBe("Finished");
    await user.click(dock().getByRole("button", { name: "Files (4)" }));
    expect(dock().getByText(/made by a run/)).toBeTruthy();

    // input lines go to the next run, in the same (kept) Python worker
    await user.click(dock().getByRole("button", { name: "Input lines" }));
    await user.type(dock().getByLabelText(/Input lines, one per input/), "first{enter}second");
    await user.click(dock().getByRole("button", { name: "Run" }));
    expect(FakeWorker.all).toHaveLength(1);
    expect(w.requests[1]).toMatchObject({ entry: "lab-corpus.py", args: ["a b", "3"], stdin: ["first", "second"] });
    expect(w.requests[1]!.files.map((f) => f.path)).toContain("input.txt");
  });

  it("each file keeps its own tab and output; Run elsewhere stops the run in progress and starts the new one", async () => {
    const user = userEvent.setup();
    renderLab();
    await loaded();
    await user.click(screen.getByRole("button", { name: "run corpus" }));
    const first = FakeWorker.all[0]!;
    first.emit({ type: "out", stream: "stdout", text: "corpus says hi\n" });

    // still running: Run on another file stops it (the click means "run this now") and starts the other
    await user.click(screen.getByRole("button", { name: "run other" }));
    expect(first.terminated).toBe(true);
    await waitFor(() => expect(FakeWorker.all).toHaveLength(2));
    const second = FakeWorker.all[1]!;
    expect(second.requests[0]!.entry).toBe("other.py");
    second.emit({ type: "out", stream: "stdout", text: "other says hi\n" });
    second.emit({ type: "done", code: 0 });

    expect(dock().getByRole("log").textContent).toMatch(/other says hi/);
    await user.click(dock().getByRole("button", { name: /^lab-corpus\.py/ }));
    expect(dock().getByRole("log").textContent).toMatch(/corpus says hi/);
    expect(dock().getByRole("log").textContent).toMatch(/Stopped\./);
    expect(dock().getByRole("status").textContent).toBe("Stopped");

    await user.click(dock().getByRole("button", { name: "Close other.py" }));
    expect(dock().queryByRole("button", { name: /^other\.py/ })).toBeNull();
  });

  it("explains a package the browser cannot run", async () => {
    const user = userEvent.setup();
    renderLab();
    await loaded();
    await user.click(screen.getByRole("button", { name: "run corpus" }));
    const w = FakeWorker.all[0]!;
    w.emit({ type: "out", stream: "stderr", text: "ModuleNotFoundError: No module named 'torch'\n" });
    w.emit({ type: "done", code: 1 });
    expect(dock().getByText(/'torch' is not available in the browser runner/)).toBeTruthy();
    expect(dock().getByRole("status").textContent).toBe("Exit code 1");
  });

  it("folds to its title row and closes", async () => {
    const user = userEvent.setup();
    renderLab();
    await loaded();
    await user.click(screen.getByRole("button", { name: "run corpus" }));
    await user.click(dock().getByRole("button", { name: "Fold the terminal" }));
    expect(dock().queryByRole("log")).toBeNull();
    await user.click(dock().getByRole("button", { name: "Show the terminal" }));
    expect(dock().getByRole("log")).toBeTruthy();
    await user.click(dock().getByRole("button", { name: "Close the terminal" }));
    expect(screen.queryByRole("region", { name: "Terminal" })).toBeNull();
    // closing stops what was running
    expect(FakeWorker.all[0]!.terminated).toBe(true);
  });

  it("a finished JavaScript run's worker is ended, and nothing it sends later reaches the dock", async () => {
    const user = userEvent.setup();
    renderLab();
    await loaded();
    await user.click(screen.getByRole("button", { name: "own file" }));
    await user.upload(document.querySelector<HTMLInputElement>('input[type="file"]')!, [new File(["setInterval(() => console.log('tick'), 10)"], "main.js")]);
    await user.click(await dock().findByRole("button", { name: "Run" }));
    const js = FakeWorker.all[0]!;
    js.emit({ type: "done", code: 0 });
    expect(js.terminated).toBe(true);
    // a late timer from that run, and even a late error, change nothing
    js.emit({ type: "out", stream: "stdout", text: "tick\n" });
    act(() => js.onerror?.({ message: "late", preventDefault: () => {} } as ErrorEvent));
    expect(dock().getByRole("log").textContent).not.toMatch(/tick|late/);
    expect(dock().getByRole("status").textContent).toBe("Finished");
  });

  it("closing the tab of a running file stops it; one missing lesson file does not keep the others out", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => (url.endsWith("notes.md") ? new Response("gone", { status: 404 }) : new Response(`print("${url}")`))),
    );
    const user = userEvent.setup();
    renderLab();
    await waitFor(() => expect(getFile("c", "other.py")).toBeTruthy());
    expect(getFile("c", "notes.md")).toBeUndefined();
    await user.click(screen.getByRole("button", { name: "run corpus" }));
    expect(dock().getByRole("alert").textContent).toMatch(/Could not load notes\.md/);
    const w = FakeWorker.all[0]!;
    await user.click(dock().getByRole("button", { name: "Close lab-corpus.py" }));
    expect(w.terminated).toBe(true);
  });

  it("runs the learner's own files: adding them opens main in a tab", async () => {
    const user = userEvent.setup();
    renderLab();
    await loaded();
    await user.click(screen.getByRole("button", { name: "own file" }));
    expect(dock().getByRole("log").textContent).toMatch(/add your own file/);
    const picker = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    await user.upload(picker, [new File(["export const x = 1;"], "util.ts"), new File(['import { x } from "./util";\nconsole.log(x);'], "main.ts")]);
    expect(await dock().findByText(/\$ tsx main\.ts/)).toBeTruthy();
    await user.click(dock().getByRole("button", { name: "Run" }));
    const w = FakeWorker.all[0]!;
    expect(w.language).toBe("typescript");
    expect(w.requests[0]!.entry).toBe("main.ts");
  });
});

describe("resizing", () => {
  it("the terminal's top edge and the editor's left edge resize with the arrow keys, are remembered, and a double click resets them", async () => {
    const user = userEvent.setup();
    setLabSize({ width: null, height: null });
    renderLab();
    await loaded();
    await user.click(screen.getByRole("button", { name: "edit corpus" }));
    const output = dock().getByRole("log", { name: "Output" });
    const drawer = screen.getByRole("complementary", { name: "Editor: lab-corpus.py" });
    expect(output.style.height).toBe("");
    expect(drawer.style.getPropertyValue("--drawer-w")).toBe("min(640px, 46vw)");

    // jsdom lays nothing out, so a resize starts from the default sizes (220 and 640)
    fireEvent.keyDown(screen.getByRole("separator", { name: "Resize the terminal" }), { key: "ArrowUp" });
    expect(output.style.height).toContain("244px");
    fireEvent.keyDown(screen.getByRole("separator", { name: "Resize the editor" }), { key: "ArrowRight" });
    expect(drawer.style.getPropertyValue("--drawer-w")).toContain("616px");
    expect(JSON.parse(localStorage.getItem("selfschool-lab-size")!)).toEqual({ width: 616, height: 244 });

    fireEvent.doubleClick(screen.getByRole("separator", { name: "Resize the terminal" }));
    expect(output.style.height).toBe("");
    expect(drawer.style.getPropertyValue("--drawer-w")).toContain("616px");

    // folded, the terminal has no edge to drag
    await user.click(dock().getByRole("button", { name: "Fold the terminal" }));
    expect(screen.queryByRole("separator", { name: "Resize the terminal" })).toBeNull();
    setLabSize({ width: null, height: null });
  });
});

describe("editor drawer", () => {
  it("opens the file beside the lesson; edits run with the next Run, are marked, and Reset brings the original back", async () => {
    const user = userEvent.setup();
    renderLab();
    await loaded();
    await user.click(screen.getByRole("button", { name: "edit corpus" }));
    const drawer = within(screen.getByRole("complementary", { name: "Editor: lab-corpus.py" }));
    const editor = drawer.getByLabelText("Code of lab-corpus.py") as HTMLTextAreaElement;
    expect(editor.value).toBe('# lab-corpus.py\nprint("hi")\n');
    expect((drawer.getByRole("button", { name: "Reset" }) as HTMLButtonElement).disabled).toBe(true);
    // the dock opened on the file too, without running it
    expect(dock().getByRole("button", { name: "Editing" }).getAttribute("aria-pressed")).toBe("true");
    expect(FakeWorker.all).toHaveLength(0);

    fireEvent.change(editor, { target: { value: '# lab-corpus.py\nprint("changed")\n' } });
    expect(text(getFile("c", "lab-corpus.py")!.data)).toBe('# lab-corpus.py\nprint("changed")\n');
    expect(drawer.getByText("edited · 1 line")).toBeTruthy();

    // Ctrl+Enter runs the edited file
    fireEvent.keyDown(editor, { key: "Enter", ctrlKey: true });
    const w = FakeWorker.all[0]!;
    expect(text(w.requests[0]!.files.find((f) => f.path === "lab-corpus.py")!.data)).toContain("changed");

    await user.click(drawer.getByRole("button", { name: "Reset" }));
    expect(text(getFile("c", "lab-corpus.py")!.data)).toBe('# lab-corpus.py\nprint("hi")\n');
    expect(drawer.queryByText(/edited ·/)).toBeNull();

    await user.click(drawer.getByRole("button", { name: "Close the editor" }));
    expect(screen.queryByRole("complementary", { name: /Editor/ })).toBeNull();
  });

  it("typing a file back to how it was makes it unedited; Tab indents", async () => {
    const user = userEvent.setup();
    renderLab();
    await loaded();
    await user.click(screen.getByRole("button", { name: "edit corpus" }));
    const editor = screen.getByLabelText("Code of lab-corpus.py") as HTMLTextAreaElement;
    const original = editor.value;
    fireEvent.change(editor, { target: { value: `${original}x` } });
    expect(getFile("c", "lab-corpus.py")!.original).toBeTruthy();
    fireEvent.change(editor, { target: { value: original } });
    expect(getFile("c", "lab-corpus.py")!.original).toBeUndefined();

    editor.setSelectionRange(0, 0);
    fireEvent.keyDown(editor, { key: "Tab" });
    expect(text(getFile("c", "lab-corpus.py")!.data)?.startsWith("    # lab-corpus.py")).toBe(true);
  });

  it("Tab on a selection indents every line it touches (instead of replacing it); Shift+Tab outdents them", async () => {
    const user = userEvent.setup();
    renderLab();
    await loaded();
    await user.click(screen.getByRole("button", { name: "edit corpus" }));
    const editor = screen.getByLabelText("Code of lab-corpus.py") as HTMLTextAreaElement;
    const original = editor.value; // '# lab-corpus.py\nprint("hi")\n'
    editor.setSelectionRange(2, 20); // from inside line 1 into line 2
    fireEvent.keyDown(editor, { key: "Tab" });
    expect(text(getFile("c", "lab-corpus.py")!.data)).toBe('    # lab-corpus.py\n    print("hi")\n');
    editor.setSelectionRange(0, editor.value.length - 1);
    fireEvent.keyDown(editor, { key: "Tab", shiftKey: true });
    expect(text(getFile("c", "lab-corpus.py")!.data)).toBe(original);
  });
});
