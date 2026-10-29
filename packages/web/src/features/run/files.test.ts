import { describe, expect, it } from "vitest";
import { commandRuns, formatBytes, languageOf, pickEntry, rustPlaygroundUrl, splitArgs, stdinLines } from "./files";
import { isBlockedUrl } from "./sandbox";
import { appendOutput, hintFor } from "./useRun";
import { editFile, listFiles, needsLessonFile, putFiles, removeFile, resetWorkspaces } from "./workspace";

const bytes = (s: string) => new TextEncoder().encode(s);

describe("languageOf", () => {
  it("knows the runnable extensions, case-insensitively", () => {
    expect(languageOf("lab.py")).toBe("python");
    expect(languageOf("a/b/Main.TS")).toBe("typescript");
    expect(languageOf("x.mjs")).toBe("javascript");
    expect(languageOf("notes.md")).toBeNull();
    expect(languageOf("Makefile")).toBeNull();
  });
});

describe("splitArgs", () => {
  it("splits like a shell: quotes group, backslash escapes, empty quotes count", () => {
    expect(splitArgs('"The capital of France is" 20')).toEqual(["The capital of France is", "20"]);
    expect(splitArgs("  a   b ")).toEqual(["a", "b"]);
    expect(splitArgs(`it\\'s 'single "kept"' ""`)).toEqual(["it's", 'single "kept"', ""]);
    expect(splitArgs("")).toEqual([]);
  });
});

describe("stdinLines", () => {
  it("one input per line; a trailing newline adds no empty input", () => {
    expect(stdinLines("a\r\nb\n")).toEqual(["a", "b"]);
    expect(stdinLines("a\n\nb")).toEqual(["a", "", "b"]);
    expect(stdinLines("")).toEqual([]);
  });
});

describe("pickEntry", () => {
  it("prefers main/index/app among added files, else the first runnable one", () => {
    expect(pickEntry(["util.ts", "main.ts"])).toBe("main.ts");
    expect(pickEntry(["data.csv", "helpers.py", "train.py"])).toBe("helpers.py");
    expect(pickEntry(["data.csv"])).toBeNull();
  });
});

describe("commandRuns", () => {
  const names = ["lab01-gpt2-chat.py", "main.ts", "notes.md"];
  it("finds the lines that run a lesson file, with their arguments", () => {
    const code = [
      "uv venv && uv pip install torch transformers",
      'python lab01-gpt2-chat.py "The capital of France is"',
      "$ python3 ./lab01-gpt2-chat.py   # default prompt",
      "npx tsx main.ts --fast",
      "uv run python lab01-gpt2-chat.py 'hi'",
    ].join("\n");
    expect(commandRuns(code, names)).toEqual([
      { entry: "lab01-gpt2-chat.py", args: '"The capital of France is"', line: 'python lab01-gpt2-chat.py "The capital of France is"' },
      { entry: "lab01-gpt2-chat.py", args: "", line: "$ python3 ./lab01-gpt2-chat.py   # default prompt" },
      { entry: "main.ts", args: "--fast", line: "npx tsx main.ts --fast" },
      { entry: "lab01-gpt2-chat.py", args: "'hi'", line: "uv run python lab01-gpt2-chat.py 'hi'" },
    ]);
  });
  it("ignores files that are not the lesson's, not runnable, or not run", () => {
    expect(commandRuns("python other.py\npython notes.md\ncat lab01-gpt2-chat.py\npython -m venv .venv", names)).toEqual([]);
  });
});

describe("rustPlaygroundUrl", () => {
  it("links a complete program, with the code filled in", () => {
    const url = rustPlaygroundUrl('fn main() {\n    println!("hi & bye");\n}');
    expect(url).toMatch(/^https:\/\/play\.rust-lang\.org\/\?version=stable&mode=debug&edition=2024&code=/);
    expect(decodeURIComponent(url!.split("code=")[1]!)).toContain('println!("hi & bye")');
  });
  it("skips a fragment without main", () => {
    expect(rustPlaygroundUrl("let x = 5;")).toBeNull();
  });
});

describe("formatBytes", () => {
  it("is short and readable", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1300)).toBe("1.3 KB");
    expect(formatBytes(1_115_394)).toBe("1.1 MB");
  });
});

describe("working folder", () => {
  it("a lesson file never replaces the learner's file or a run's output; output keeps 'yours' on the learner's file", () => {
    resetWorkspaces();
    putFiles("c", [{ path: "lab.py", data: bytes("mine") }], "yours");
    putFiles("c", [{ path: "lab.py", data: bytes("lesson") }, { path: "minigpt.py", data: bytes("m") }], "lesson");
    putFiles("c", [{ path: "input.txt", data: bytes("text") }], "output");
    putFiles("c", [{ path: "input.txt", data: bytes("lesson copy") }], "lesson");
    putFiles("c", [{ path: "lab.py", data: bytes("rewritten by the run") }], "output");
    const files = listFiles("c");
    expect(files.map((f) => [f.path, f.origin, new TextDecoder().decode(f.data)])).toEqual([
      ["input.txt", "output", "text"],
      ["lab.py", "yours", "rewritten by the run"],
      ["minigpt.py", "lesson", "m"],
    ]);
    // a same-named file from another lesson is fetched again, unless the learner edited it
    putFiles("c", [{ path: "data.py", url: "/l1/data.py", data: bytes("one") }], "lesson");
    expect(needsLessonFile("c", { name: "data.py", url: "/l1/data.py" })).toBe(false);
    expect(needsLessonFile("c", { name: "data.py", url: "/l2/data.py" })).toBe(true);
    putFiles("c", [{ path: "data.py", url: "/l2/data.py", data: bytes("two") }], "lesson");
    expect(new TextDecoder().decode(listFiles("c").find((f) => f.path === "data.py")!.data)).toBe("two");
    editFile("c", "data.py", bytes("mine"));
    expect(needsLessonFile("c", { name: "data.py", url: "/l1/data.py" })).toBe(false);
    putFiles("c", [{ path: "data.py", url: "/l1/data.py", data: bytes("one") }], "lesson");
    expect(new TextDecoder().decode(listFiles("c").find((f) => f.path === "data.py")!.data)).toBe("mine");
    removeFile("c", "data.py");
    expect(needsLessonFile("c", { name: "lab.py", url: "/x" })).toBe(false); // the learner's own file stays

    removeFile("c", "input.txt");
    expect(listFiles("c").map((f) => f.path)).toEqual(["lab.py", "minigpt.py"]);
    expect(listFiles("other")).toEqual([]);
  });
});

describe("runner network guard", () => {
  const here = "http://localhost:5176/selfschool/assets/python.worker-abc.js";
  it("blocks this app's origin, however the URL is written", () => {
    for (const u of ["/api/backup", "api/backup", "http://localhost:5176/api/x", "//localhost:5176/x", "../../api/packages/x"]) expect(isBlockedUrl(u, here), u).toBe(true);
  });
  it("blocks loopback and private network hosts (the Docker api, other local services)", () => {
    for (const u of [
      "http://localhost:3001/packages",
      "http://127.0.0.1:3001/",
      "http://[::1]:3001/",
      "http://192.168.1.10/",
      "http://10.0.0.5/",
      "http://172.20.0.2/",
      "http://169.254.169.254/latest",
      "http://printer.local/",
      "http://0.0.0.0:3001/",
    ])
      expect(isBlockedUrl(u, here), u).toBe(true);
  });
  it("allows the public internet (Pyodide's CDN, lab downloads) and in-memory URLs", () => {
    for (const u of [
      "https://cdn.jsdelivr.net/pyodide/v0.27.7/full/pyodide.mjs",
      "https://raw.githubusercontent.com/karpathy/char-rnn/master/data/tinyshakespeare/input.txt",
      "http://172.32.0.1/",
      "blob:http://localhost:5176/abc",
    ])
      expect(isBlockedUrl(u, here), u).toBe(false);
  });
  it("a public site counts as blocked when the app itself is served from it", () => {
    expect(isBlockedUrl("https://looty.github.io/selfschool/api/backup", "https://looty.github.io/selfschool/assets/w.js")).toBe(true);
    expect(isBlockedUrl("https://example.com/data.csv", "https://looty.github.io/selfschool/assets/w.js")).toBe(false);
  });
});

describe("output", () => {
  it("merges chunks of the same stream and caps the total", () => {
    let out = appendOutput([], { stream: "stdout", text: "a" });
    out = appendOutput(out, { stream: "stdout", text: "b" });
    out = appendOutput(out, { stream: "stderr", text: "e" });
    expect(out).toEqual([{ stream: "stdout", text: "ab" }, { stream: "stderr", text: "e" }]);
    const big = appendOutput([], { stream: "stdout", text: "x".repeat(250_000) });
    expect(big[0]!.text).toMatch(/output cut here/);
    expect(appendOutput(big, { stream: "stdout", text: "more" })).toBe(big);
  });

  it("explains packages the browser cannot run", () => {
    expect(hintFor("python", [{ stream: "stderr", text: "ModuleNotFoundError: No module named 'torch.nn'" }])).toMatch(/'torch' is not available/);
    expect(hintFor("typescript", [{ stream: "stderr", text: "Error: 'fs' is a Node or npm module; it is not" }])).toMatch(/'fs' needs Node/);
    expect(hintFor("python", [{ stream: "stderr", text: "FileNotFoundError: [Errno 44] No such file or directory: 'input.txt'" }])).toMatch(
      /'input.txt' is not in the working folder yet\. If another script in this lab creates it, run that one first/,
    );
    expect(hintFor("python", [{ stream: "stderr", text: "ZeroDivisionError" }])).toBeNull();
  });
});
