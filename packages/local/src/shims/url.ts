/** In the browser `import.meta.url` is an http URL; its pathname is what the api's fileURLToPath callers expect to resolve against. */
export function fileURLToPath(u: string | URL): string {
  return decodeURIComponent(new URL(u).pathname);
}
export function pathToFileURL(p: string): URL {
  return new URL(`file://${p}`);
}
const BrowserURL = URL;
export { BrowserURL as URL };
