// Service worker: the "web server" for requests that bypass fetch(), such as <img src="/api/..."> and download links.
// It cannot read the in-page database or files, so it asks the page that made the request to answer over a MessageChannel.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith("/api/") || event.request.method !== "GET") return;
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
