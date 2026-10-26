import {
  buildPath,
  courseRemovalSchema,
  packageInfoSchema,
  packageUpdatesSchema,
  packagePreviewSchema,
  removedCoursesSchema,
  routeDef,
  type CourseRemoval,
  type PackagePreview,
  type PackageUpdates,
  type RouteInput,
  type RouteName,
  type RouteResponse,
} from "@selfschool/shared";

import { loadContentLanguage } from "./language";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Anything that can answer a route call; the mock layer implements the same signature. */
export type Transport = (name: RouteName, input: Record<string, unknown>) => Promise<unknown>;

export const MOCK = import.meta.env.VITE_MOCK === "1";

/** Real transport: fetches `/api<path>`; vite (dev) or nginx (prod) strips the prefix. */
export const httpTransport: Transport = async (name, input) => {
  const def = routeDef(name);
  const params = (input.params ?? {}) as Record<string, string>;
  const query = input.query as Record<string, unknown> | undefined;
  const qs = query
    ? "?" + new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString()
    : "";
  const lang = loadContentLanguage();
  const headers: Record<string, string> = {};
  if (def.body) headers["content-type"] = "application/json";
  if (lang) headers["x-selfschool-lang"] = lang;
  const res = await fetch(`/api${buildPath(def.path, params)}${qs}`, {
    method: def.method,
    headers,
    body: def.body ? JSON.stringify(input.body ?? {}) : undefined,
  });
  if (!res.ok) {
    const detail = await res.json().then((j: { error?: string }) => j.error, () => undefined);
    throw new ApiError(res.status, detail ?? `${def.method} ${def.path} -> ${res.status}`);
  }
  return res.json();
};

// ---------- course imports (outside the route table: a raw zip body and upload progress) ----------

/** POSTs a file as the raw body with upload progress (fetch cannot report it); `signal` cancels. */
function postFile<T>(url: string, file: File, schema: { safeParse(v: unknown): { success: true; data: T } | { success: false } }, onProgress?: (fraction: number) => void, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (MOCK) return reject(new ApiError(501, "importing a course is not available in the mock preview"));
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("content-type", "application/zip");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onerror = () => reject(new ApiError(0, "could not reach the server"));
    xhr.onabort = () => reject(new DOMException("aborted", "AbortError"));
    xhr.onload = () => {
      let json: unknown;
      try {
        json = JSON.parse(xhr.responseText);
      } catch {
        json = undefined;
      }
      if (xhr.status < 200 || xhr.status >= 300) return reject(new ApiError(xhr.status, (json as { error?: string } | undefined)?.error ?? `upload failed (${xhr.status})`));
      const parsed = schema.safeParse(json);
      parsed.success ? resolve(parsed.data) : reject(new ApiError(502, "unexpected response from the server"));
    };
    signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(file);
  });
}

const zipUrl = (path: string, file: File) => `/api/packages/${path}?name=${encodeURIComponent(file.name)}`;

/** Dry run: uploads the zip, the server validates it and describes the course; nothing is installed. */
export const previewZip = (file: File, onProgress?: (fraction: number) => void, signal?: AbortSignal) =>
  postFile(zipUrl("upload/preview", file), file, packagePreviewSchema, onProgress, signal);

/** Installs the zip (the server runs the same checks again). */
export const installZip = (file: File, onProgress?: (fraction: number) => void, signal?: AbortSignal) =>
  postFile(zipUrl("upload", file), file, packageInfoSchema, onProgress, signal);

/** Dry run for a repo URL or local folder: clones, validates and describes the course; nothing is installed. */
export async function previewRepo(body: { url: string; path: string; ref: string }, signal?: AbortSignal): Promise<PackagePreview> {
  if (MOCK) throw new ApiError(501, "importing a course is not available in the mock preview");
  const res = await fetch("/api/packages/preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), ...(signal ? { signal } : {}) });
  const json: unknown = await res.json().catch(() => undefined);
  if (!res.ok) throw new ApiError(res.status, (json as { error?: string } | undefined)?.error ?? `preview failed (${res.status})`);
  const parsed = packagePreviewSchema.safeParse(json);
  if (!parsed.success) throw new ApiError(502, "unexpected response from the server");
  return parsed.data;
}

async function plainFetch<T>(url: string, init: RequestInit, schema: { safeParse(v: unknown): { success: true; data: T } | { success: false } }): Promise<T> {
  if (MOCK) throw new ApiError(501, "removing a course is not available in the mock preview");
  const res = await fetch(url, init);
  const json: unknown = await res.json().catch(() => undefined);
  if (!res.ok) throw new ApiError(res.status, (json as { error?: string } | undefined)?.error ?? `request failed (${res.status})`);
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new ApiError(502, "unexpected response from the server");
  return parsed.data;
}

/** What removing this course would delete (counts), for the confirm popup. */
export const getRemoval = (courseId: string): Promise<CourseRemoval> =>
  plainFetch(`/api/packages/${encodeURIComponent(courseId)}/removal`, {}, courseRemovalSchema);

/** Asks GitHub whether the course's ref has news and which branches and tags it could switch to (on demand: see `packageUpdatesSchema`). */
export const getPackageUpdates = (courseId: string): Promise<PackageUpdates> =>
  plainFetch(`/api/packages/${encodeURIComponent(courseId)}/updates`, {}, packageUpdatesSchema);

const flag = <K extends string>(key: K) => ({
  safeParse: (v: unknown): { success: true; data: Record<K, true> } | { success: false } =>
    (v as Record<string, unknown> | null)?.[key] === true ? { success: true, data: { [key]: true } as Record<K, true> } : { success: false },
});

/** Removes the course from the app and deletes all progress on it. No file is touched. */
export const removeCourse = (courseId: string) => plainFetch(`/api/packages/${encodeURIComponent(courseId)}`, { method: "DELETE" }, flag("removed"));

/** Courses removed from the app whose files are still in the courses folder. */
export const getRemoved = () => plainFetch("/api/packages/removed", {}, removedCoursesSchema);

/** Shows a removed course again, from zero. */
export const restoreCourse = (courseId: string) => plainFetch(`/api/packages/${encodeURIComponent(courseId)}/restore`, { method: "POST" }, flag("restored"));

let transport: Promise<Transport> | undefined;
function getTransport(): Promise<Transport> {
  // Dynamic import keeps the mock layer and fixtures out of the production bundle.
  transport ??= MOCK ? import("./mock").then((m) => m.mockTransport) : Promise.resolve(httpTransport);
  return transport;
}

/** Calls a route; the response is always validated against the shared schema (mock included). */
export async function callApi<N extends RouteName>(
  name: N,
  ...rest: {} extends RouteInput<N> ? [input?: RouteInput<N>] : [input: RouteInput<N>]
): Promise<RouteResponse<N>> {
  const input = (rest[0] ?? {}) as Record<string, unknown>;
  const raw = await (await getTransport())(name, input);
  const parsed = routeDef(name).res.safeParse(raw);
  if (!parsed.success) throw new ApiError(502, `bad ${name} response: ${parsed.error.message}`);
  return parsed.data as RouteResponse<N>;
}
