/** Importing a course from a git URL needs `git`, which a browser tab does not have; zip upload still works. */
export function execFile(_file: string, _args: unknown, _opts: unknown, cb: (err: Error | null, result: { stdout: string; stderr: string }) => void) {
  cb(new Error("importing from a git repository is not available in the browser; upload a zip instead"), { stdout: "", stderr: "" });
}
