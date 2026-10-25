// Browser polyfills first: the api and memfs expect Node's `Buffer` and `process`.
import { Buffer } from "buffer/index.js"; // deep import: a bare "buffer" is stubbed out by Vite

const g = globalThis as unknown as Record<string, unknown>;
g.Buffer ??= Buffer;
g.process ??= { env: {}, cwd: () => "/", pid: 1, platform: "browser", versions: {}, nextTick: (f: () => void) => queueMicrotask(f) };

/** What the page shows when the in-browser api cannot start, instead of a blank screen. Nothing is deleted without a click. */
function showStartupError(e: unknown) {
  const message = e instanceof Error ? e.message : String(e);
  document.body.innerHTML = "";
  const box = document.createElement("div");
  box.style.cssText = "max-width:34rem;margin:15vh auto;padding:0 16px;font:15px/1.5 system-ui,sans-serif;color:var(--text,#0b1220)";
  box.innerHTML = "<h1 style='font-size:20px;margin:0 0 8px'>Selfschool could not start</h1><p style='margin:0 0 12px'></p><p style='margin:0 0 12px;color:var(--text2,#475467)'>Your saved data has not been touched. Reloading may help; if it keeps failing, reset the data stored in this browser (this deletes your progress and imported courses).</p>";
  box.querySelector("p")!.textContent = message;
  const reload = document.createElement("button");
  reload.textContent = "Reload";
  reload.onclick = () => location.reload();
  const reset = document.createElement("button");
  reset.textContent = "Reset local data";
  reset.style.marginLeft = "8px";
  reset.onclick = () => {
    if (!confirm("Delete all progress and imported courses stored in this browser?")) return;
    const req = indexedDB.deleteDatabase("selfschool-local");
    req.onsuccess = req.onerror = req.onblocked = () => location.reload();
  };
  box.append(reload, reset);
  document.body.append(box);
}

// Then start the api inside the page, and only then the (unchanged) web app, which talks to it through fetch("/api/...").
try {
  const { boot } = await import("./boot.js");
  await boot();
} catch (e) {
  showStartupError(e);
  throw e;
}
await import("@web/main");
