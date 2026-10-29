/**
 * Messages between the page and a run worker. Code runs only inside the worker (Python in WebAssembly, or
 * JavaScript in the worker's own scope), so it cannot reach the learner's files, terminal or other programs.
 */

export type RunLanguage = "python" | "javascript" | "typescript";

export interface RunFile {
  path: string;
  data: Uint8Array;
}

export interface RunRequest {
  type: "run";
  language: RunLanguage;
  /** The working folder: every file the run can open (lesson resources, the learner's files, earlier output). */
  files: RunFile[];
  /** Path of the file to run, inside `files`. */
  entry: string;
  /** Command-line arguments (`sys.argv[1:]`, `process.argv.slice(2)`). */
  args: string[];
  /** Lines handed to `input()` / `prompt()` in order; when they run out the program stops with a note. */
  stdin: string[];
}

export type RunEvent =
  | { type: "status"; text: string }
  | { type: "out"; stream: "stdout" | "stderr"; text: string }
  /** Files the run created or changed in the working folder. */
  | { type: "files"; files: RunFile[] }
  | { type: "done"; code: number };

/** What the stdin shim prints when the provided input lines run out. */
export const NO_MORE_INPUT = "(no more input lines: add lines under Input and run again)";
