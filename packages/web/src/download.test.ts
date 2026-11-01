// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadApiFile, fileNameOf } from "./download";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Stubs fetch and the blob url, and records each anchor the download clicks. */
function stubDownload(res: Response) {
  const fetchMock = vi.fn(async (_url: string) => res);
  vi.stubGlobal("fetch", fetchMock);
  const blobs: Blob[] = [];
  URL.createObjectURL = vi.fn((b: Blob) => {
    blobs.push(b);
    return "blob:x";
  });
  URL.revokeObjectURL = vi.fn();
  const clicked: { href: string; download: string }[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    clicked.push({ href: this.href, download: this.download });
  });
  return { fetchMock, blobs, clicked };
}

describe("fileNameOf", () => {
  it("prefers the name the response asks for", () => {
    const res = new Response("", { headers: { "content-disposition": 'attachment; filename="selfschool-backup-2026-11-01.sqlite"' } });
    expect(fileNameOf(res, "/api/backup")).toBe("selfschool-backup-2026-11-01.sqlite");
  });
  it("falls back to the last part of the url", () => {
    expect(fileNameOf(new Response(""), "/api/courses/c/files/resources/my%20lab.py?v=1")).toBe("my lab.py");
  });
});

describe("downloadApiFile", () => {
  // The in-browser build answers fetch() in the page; a plain link download skipped the service worker and got a 404.
  it("fetches the api path and saves the bytes under the given name", async () => {
    const { fetchMock, blobs, clicked } = stubDownload(new Response("print(1)"));
    await downloadApiFile("/api/courses/c/files/resources/lab01.py", "lab01.py");
    expect(fetchMock).toHaveBeenCalledWith("/api/courses/c/files/resources/lab01.py");
    expect(clicked).toEqual([{ href: "blob:x", download: "lab01.py" }]);
    expect(await blobs[0]!.text()).toBe("print(1)");
  });

  it("does not save an error page as the file", async () => {
    const { clicked } = stubDownload(new Response("not found", { status: 404 }));
    await expect(downloadApiFile("/api/courses/c/files/resources/lab01.py", "lab01.py")).rejects.toThrow(/HTTP 404/);
    expect(clicked).toEqual([]);
  });
});
