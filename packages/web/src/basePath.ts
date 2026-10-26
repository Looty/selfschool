/** Vite's base ("/" or "/selfschool/") as a router basename: no trailing slash, "/" at the root. */
export const routerBasename = (base: string): string => base.replace(/\/+$/, "") || "/";

/**
 * Where a link in course text should point. `/api/...` (course files) moves under the base, so a new tab opened on it
 * stays inside the in-browser build's service-worker scope; at the root base nothing changes.
 */
export const apiHref = (href: string, base: string): string => (href.startsWith("/api/") ? `${base}${href.slice(1)}` : href);

/** An app route such as `/courses/x`: handled by the router (which adds the base), not a new tab. */
export const isAppRoute = (href: string): boolean => href.startsWith("/") && !href.startsWith("//") && !href.startsWith("/api/");
