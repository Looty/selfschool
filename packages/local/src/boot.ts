import initSqlJs from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import { createApp } from "../../api/src/app.js";
import { openDb } from "../../api/src/db/client.js";
import { loadSaved, save } from "./persist.js";
import { configureSqlite } from "./shims/better-sqlite3.js";
import { watchForNewVersion } from "./updates.js";
import { mkdirSync, restore, snapshot } from "./shims/fs.js";

const COURSES = "/courses";
const EXTENSIONS = "/extensions";
const CACHE = "/cache";

/**
 * Starts the real api inside the page: SQLite on WebAssembly, files in memory (saved to IndexedDB),
 * and `fetch("/api/...")` / XMLHttpRequest answered by `app.fetch` instead of the network.
 */
export async function boot() {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const saved = await loadSaved();

  for (const dir of [COURSES, EXTENSIONS, CACHE]) mkdirSync(dir, { recursive: true });
  if (saved) restore(saved.files);
  configureSqlite(SQL, saved?.db);

  const db = openDb(":memory:");
  const app = createApp(db, {
    coursesDir: COURSES,
    extensionsDir: EXTENSIONS,
    catalogCacheDir: CACHE,
    catalogRecheckMs: 2000,
  });

  // Every write is saved before its response goes back to the page: a save started while a tab closes is not reliable,
  // and writes here are rare (a lesson done, an answer, an import). Saves that overlap are coalesced into one more run.
  let saving: Promise<void> | undefined;
  let again = false;
  const flush = (): Promise<void> => {
    if (saving) {
      again = true;
      return saving;
    }
    saving = (async () => {
      do {
        again = false;
        await save({ db: db.$client.serialize(), files: snapshot([COURSES, EXTENSIONS]) });
      } while (again);
    })().finally(() => (saving = undefined));
    return saving;
  };
  const persist = flush;

  installTransport((req) => app.fetch(req), persist);
  watchForNewVersion(flush);
  await installServiceWorker((req) => app.fetch(req));
  if (!saved && new URLSearchParams(location.search).has("sample")) await importSample(app.fetch.bind(app), persist);
}

/** Answers same-origin `/api/*` requests from the in-page app; everything else goes to the network. */
function installTransport(handle: (req: Request) => Response | Promise<Response>, persist: () => Promise<void>) {
  const realFetch = globalThis.fetch.bind(globalThis);

  const local = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response | undefined> => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    if (url.origin !== location.origin || !url.pathname.startsWith("/api/")) return undefined;
    const write = req.method !== "GET" && req.method !== "HEAD";
    const res = await handle(
      new Request(`${url.origin}${url.pathname.slice("/api".length)}${url.search}`, {
        method: req.method,
        headers: req.headers,
        body: write ? await req.arrayBuffer() : null,
        signal: req.signal,
      }),
    );
    if (write) await persist();
    return res;
  };

  globalThis.fetch = async (input, init) => (await local(input, init)) ?? realFetch(input, init);

  // The web app uploads course zips with XMLHttpRequest (for progress); route that through the same path.
  class LocalXhr {
    status = 0;
    responseText = "";
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
    private method = "GET";
    private url = "";
    private headers = new Headers();
    private aborted = false;
    open(method: string, url: string) {
      this.method = method;
      this.url = url;
    }
    setRequestHeader(k: string, v: string) {
      this.headers.set(k, v);
    }
    abort() {
      this.aborted = true;
      this.onabort?.();
    }
    send(body?: Blob | null) {
      const size = body?.size ?? 0;
      this.upload.onprogress?.({ lengthComputable: true, loaded: size, total: size });
      globalThis
        .fetch(this.url, { method: this.method, headers: this.headers, body: body ?? null })
        .then(async (res) => {
          if (this.aborted) return;
          this.status = res.status;
          this.responseText = await res.text();
          this.onload?.();
        })
        .catch(() => !this.aborted && this.onerror?.());
    }
  }
  (globalThis as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest = LocalXhr;
}

/**
 * Images and downloads in lessons are plain `<img src="/api/...">` loads that never touch the fetch() override above.
 * A service worker catches them and relays each one to this page, which answers from the in-page app.
 */
async function installServiceWorker(handle: (req: Request) => Response | Promise<Response>) {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.addEventListener("message", async (e: MessageEvent) => {
    if (e.data?.type !== "selfschool-api") return;
    const url = new URL(e.data.url as string);
    const res = await handle(new Request(`${url.origin}${url.pathname.slice("/api".length)}${url.search}`));
    const body = await res.arrayBuffer();
    e.ports[0]?.postMessage({ status: res.status, headers: [...res.headers], body }, [body]);
  });
  try {
    await navigator.serviceWorker.register("/local-sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;
    // First visit: the worker claims this page right after activating.
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve) => {
        navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true });
        setTimeout(resolve, 1500);
      });
    }
  } catch (e) {
    console.warn("service worker unavailable; lesson images and downloads will not load", e);
  }
}

async function importSample(handle: (req: Request) => Response | Promise<Response>, persist: () => Promise<void>) {
  const zip = await (await fetch("/sample.zip")).arrayBuffer();
  const res = await handle(new Request(`${location.origin}/packages/upload?name=sample.zip`, { method: "POST", body: zip }));
  if (!res.ok) console.warn("sample import failed", await res.text());
  await persist();
}
