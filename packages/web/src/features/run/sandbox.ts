/// <reference lib="webworker" />
/**
 * Locks down a run worker before any learner or course code runs in it. A worker shares the page's origin, so without
 * this, code could call the app's own API (download the progress database, delete a course) or open the app's
 * IndexedDB, where the browser build keeps its data. Blocked: requests to this origin and to loopback or private
 * network hosts (the Docker api on localhost, other local services), the origin's storage, and nested workers (a
 * fresh worker would not be locked down). Requests to the public internet stay open: Pyodide loads from its CDN and
 * labs download their data. The originals are replaced on the prototypes and frozen, so they cannot be fetched back.
 */

/** True for a URL the runner must not reach: this app's origin, or a loopback, private or link-local host. */
export function isBlockedUrl(target: string, here: string): boolean {
  let url: URL;
  try {
    url = new URL(target, here);
  } catch {
    return true;
  }
  if (url.protocol === "blob:" || url.protocol === "data:") return false;
  if (url.origin === new URL(here).origin) return true;
  return isPrivateHost(url.hostname);
}

export function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (h === "::" || h === "::1" || /^f[cd][0-9a-f]{2}:/.test(h) || /^fe80:/.test(h) || h.startsWith("::ffff:")) return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!v4) return false;
  const [a, b] = [Number(v4[1]), Number(v4[2])];
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

const blocked = (what: string, url: string) => new TypeError(`${what} ${url}: the code runner cannot reach this app or your local network`);

/** Replaces `name` on `obj` with `value` and freezes it there. */
function pin(obj: object, name: string, value: unknown) {
  Object.defineProperty(obj, name, { value, writable: false, configurable: false, enumerable: false });
}

export function lockDown(scope: DedicatedWorkerGlobalScope) {
  const here = scope.location.href;
  const proto = Object.getPrototypeOf(scope) as object;
  // the methods live on WorkerGlobalScope.prototype (a mixin), not on the worker itself
  const owner = (name: string): object => {
    for (let o: object | null = scope; o; o = Object.getPrototypeOf(o)) if (Object.hasOwn(o, name)) return o;
    return proto;
  };

  // Each guard turns the caller's argument into its final form ONCE, checks that, and passes on only what it checked:
  // an object whose toString or url getter answers differently on a second read cannot slip past.
  const realFetch = scope.fetch.bind(scope);
  // captured now: code that later replaces the global Request cannot change what the guard builds
  const RealRequest = (scope as unknown as { Request: typeof Request }).Request;
  const fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    let req: Request;
    try {
      // a real Request is copied from its internal URL; anything else is read once and resolved against the worker
      req = new RealRequest(input instanceof RealRequest ? input : new URL(String(input), here).href, init);
    } catch (e) {
      return Promise.reject(e);
    }
    return isBlockedUrl(req.url, here) ? Promise.reject(blocked("fetch", req.url)) : realFetch(req);
  };
  pin(owner("fetch"), "fetch", fetch);

  const open = XMLHttpRequest.prototype.open;
  pin(XMLHttpRequest.prototype, "open", function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
    const target = new URL(String(url), here).href;
    if (isBlockedUrl(target, here)) throw blocked("XMLHttpRequest", target);
    return (open as (...a: unknown[]) => void).call(this, method, target, ...rest);
  });

  for (const name of ["WebSocket", "EventSource"] as const) {
    const Real = (scope as unknown as Record<string, (new (url: string | URL, ...a: unknown[]) => object) | undefined>)[name];
    if (!Real) continue;
    const Ctor = Real;
    // a plain function so `new WebSocket(url)` works and hands back the real socket; sharing the real prototype and
    // statics keeps `instanceof WebSocket` and `WebSocket.OPEN` working
    // biome-ignore lint/complexity/useArrowFunction: it must be callable with `new`
    const Guarded = function (url: string | URL, ...rest: unknown[]) {
      const resolved = new URL(String(url), here);
      const asHttp = resolved.protocol === "ws:" ? "http:" : resolved.protocol === "wss:" ? "https:" : resolved.protocol;
      if (isBlockedUrl(`${asHttp}//${resolved.host}${resolved.pathname}`, here)) throw blocked(name, resolved.href);
      return new Ctor(resolved.href, ...rest);
    };
    Guarded.prototype = Ctor.prototype;
    Object.setPrototypeOf(Guarded, Ctor);
    pin(owner(name), name, Guarded);
  }

  // the origin's storage, nested workers and same-origin messaging are not needed by lesson code. (importScripts
  // stays: Pyodide uses it to detect a worker, and in a module worker it can only throw.)
  for (const name of ["indexedDB", "caches", "Worker", "SharedWorker", "BroadcastChannel"]) {
    try {
      pin(owner(name), name, undefined);
    } catch {
      // already gone or not configurable in this browser
    }
  }
  if (scope.navigator && "sendBeacon" in scope.navigator) pin(scope.navigator, "sendBeacon", () => false);
}
