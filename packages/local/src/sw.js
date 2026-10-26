// Service worker: the "web server" for requests that bypass fetch(), such as <img src="/api/..."> and download links.
// It cannot read the in-page database or files, so it asks the page that made the request to answer over a MessageChannel.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

// The page's own /api/ requests, plus <base>api/ links opened in a new tab (a navigation only reaches a worker whose scope
// covers it, and on GitHub Pages the scope is /selfschool/). Keep in step with src/apiPath.ts.
const scopedApi = `${new URL(self.registration.scope).pathname}api/`;

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const api = url.pathname.startsWith("/api/") || url.pathname.startsWith(scopedApi);
  if (url.origin !== self.location.origin || !api || event.request.method !== "GET") return;
  event.respondWith(answer(event));
});

async function answer(event) {
  const client = (event.clientId && (await self.clients.get(event.clientId))) || (await self.clients.matchAll({ type: "window" }))[0];
  if (!client) return new Response("no open Selfschool page to answer this request", { status: 503 });
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = ({ data }) => resolve(new Response(data.body, { status: data.status, headers: data.headers }));
    client.postMessage({ type: "selfschool-api", url: event.request.url }, [channel.port2]);
  });
}
