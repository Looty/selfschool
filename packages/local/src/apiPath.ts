/**
 * The in-page api's path for a request path, or undefined when it is not an api request.
 * The web app calls root-absolute `/api/...`; links opened in a new tab use `<base>api/...` so the service worker
 * (scoped to the base) still answers them. Both map to the same api path.
 */
export function apiPath(pathname: string, base: string): string | undefined {
  for (const prefix of base === "/" ? ["/api/"] : ["/api/", `${base}api/`]) {
    if (pathname.startsWith(prefix)) return pathname.slice(prefix.length - 1);
  }
  return undefined;
}
