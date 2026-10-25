/** Replaced by vite.config.ts with an id that changes on every build; /version.json carries the id of the newest deploy. */
declare const __BUILD_ID__: string;

const CHECK_EVERY_MS = 10 * 60_000;

/**
 * The page is a static site, so a deploy replaces the files under an open tab. Two signals say the open copy is old:
 * /version.json names a newer build (checked on a timer and when the tab comes back to the front), or a lazy chunk of
 * the old build no longer exists (Vite fires `vite:preloadError`). Either shows a small bar; the data is saved first,
 * so reloading is always safe. Does nothing in dev, where the server reloads the page itself.
 */
export function watchForNewVersion(flush: () => Promise<void>) {
  if (import.meta.env.DEV) return;

  let shown = false;
  const show = () => {
    if (shown) return;
    shown = true;
    const bar = document.createElement("div");
    bar.setAttribute("role", "status");
    bar.style.cssText =
      "position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:2147483647;display:flex;gap:12px;align-items:center;" +
      "padding:10px 14px;border-radius:8px;font:13px system-ui,sans-serif;background:var(--surface,#f8f9fb);color:var(--text,#0b1220);" +
      "border:1px solid var(--border2,#cdd3dc);box-shadow:0 4px 16px rgba(0,0,0,.18);max-width:calc(100vw - 32px)";
    const text = document.createElement("span");
    text.textContent = "A new version of Selfschool is available. Your progress is saved.";
    const button = document.createElement("button");
    button.textContent = "Reload";
    button.style.cssText = "font:inherit;padding:4px 10px;border-radius:6px;border:1px solid var(--accent,#4c3fd9);background:var(--accent,#4c3fd9);color:var(--accent-fg,#fff);cursor:pointer";
    button.onclick = () => void flush().finally(() => location.reload());
    bar.append(text, button);
    document.body.append(bar);
  };

  const check = async () => {
    try {
      const res = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
      if (res.ok && ((await res.json()) as { build?: string }).build !== __BUILD_ID__) show();
    } catch {
      /* offline: try again later */
    }
  };

  setInterval(() => void check(), CHECK_EVERY_MS);
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && void check());
  window.addEventListener("vite:preloadError", (e) => {
    e.preventDefault();
    show();
  });
}
