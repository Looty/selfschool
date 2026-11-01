import type { MouseEvent } from "react";

/** Saves a blob to the user's downloads under `name`. */
export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The file name a response asks for (`content-disposition`), else the last part of its url. */
export function fileNameOf(res: Response, url: string): string {
  const named = /filename="?([^";]+)"?/.exec(res.headers.get("content-disposition") ?? "")?.[1];
  return named ?? decodeURIComponent(url.split("?")[0]!.split("/").pop() || "download");
}

/**
 * Downloads an api file (`/api/...`) with fetch() instead of letting the browser follow a link. In the in-browser build
 * fetch() is answered by the api inside the page, while the browser's own download request skips the service worker
 * and reaches the static host, which has no such file (a 404 on GitHub Pages).
 */
export async function downloadApiFile(url: string, name?: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not download the file (HTTP ${res.status}).`);
  saveBlob(await res.blob(), name ?? fileNameOf(res, url));
}

/** downloadApiFile for a button: a failure is shown to the user, `done` runs once the file is saved. */
export function startDownload(url: string, name?: string, done?: () => void): void {
  downloadApiFile(url, name).then(done, (err: unknown) => {
    console.error(err);
    window.alert(err instanceof Error ? err.message : "Could not download the file.");
  });
}

/**
 * onClick for an `<a href download>` to an api file: the link keeps its href (copy link, open in a new tab), a plain click
 * downloads through startDownload.
 */
export function downloadOnClick(url: string, name?: string, done?: () => void) {
  return (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    startDownload(url, name, done);
  };
}
