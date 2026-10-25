/**
 * `node:fs` for the browser: a small synchronous in-memory filesystem with exactly the calls packages/api and
 * packages/shared make. The page copies it to and from IndexedDB (see boot.ts). Paths are POSIX, rooted at "/".
 */
import { Buffer } from "buffer/index.js";
import path from "path-browserify";

type FileNode = { kind: "file"; data: Uint8Array; mtimeMs: number };
type DirNode = { kind: "dir"; mtimeMs: number };
type FsNode = FileNode | DirNode;

const nodes = new Map<string, FsNode>([["/", { kind: "dir", mtimeMs: Date.now() }]]);

const norm = (p: string | URL) => path.resolve("/", String(p));

function fail(code: string, syscall: string, p: string): never {
  const text = { ENOENT: "no such file or directory", EEXIST: "file already exists", ENOTDIR: "not a directory", EISDIR: "illegal operation on a directory", ENOTEMPTY: "directory not empty" }[code] ?? code;
  throw Object.assign(new Error(`${code}: ${text}, ${syscall} '${p}'`), { code, syscall, path: p, errno: -2 });
}

const need = (p: string, syscall: string): FsNode => nodes.get(p) ?? fail("ENOENT", syscall, p);
const childrenOf = (dir: string) => {
  const prefix = dir === "/" ? "/" : `${dir}/`;
  return [...nodes.keys()].filter((k) => k !== dir && k.startsWith(prefix) && !k.slice(prefix.length).includes("/"));
};
const within = (dir: string) => [...nodes.keys()].filter((k) => k === dir || k.startsWith(dir === "/" ? "/" : `${dir}/`));

class Stats {
  constructor(private readonly n: FsNode) {}
  isFile = () => this.n.kind === "file";
  isDirectory = () => this.n.kind === "dir";
  isSymbolicLink = () => false;
  get size() {
    return this.n.kind === "file" ? this.n.data.length : 0;
  }
  get mtimeMs() {
    return this.n.mtimeMs;
  }
  get ctimeMs() {
    return this.n.mtimeMs;
  }
  get mtime() {
    return new Date(this.n.mtimeMs);
  }
}

class Dirent {
  constructor(
    readonly name: string,
    private readonly n: FsNode,
    readonly parentPath: string,
  ) {}
  get path() {
    return this.parentPath;
  }
  isFile = () => this.n.kind === "file";
  isDirectory = () => this.n.kind === "dir";
  isSymbolicLink = () => false;
}

type Enc = BufferEncoding | { encoding?: BufferEncoding | null } | null | undefined;
const encodingOf = (o: Enc) => (typeof o === "string" ? o : o?.encoding ?? undefined);

export function existsSync(p: string | URL) {
  return nodes.has(norm(p));
}

export function mkdirSync(p: string | URL, opts?: { recursive?: boolean } | number) {
  const target = norm(p);
  const recursive = typeof opts === "object" && opts?.recursive;
  if (nodes.has(target)) {
    if (recursive && nodes.get(target)!.kind === "dir") return undefined;
    fail("EEXIST", "mkdir", target);
  }
  const parent = path.dirname(target);
  if (!nodes.has(parent)) {
    if (!recursive) fail("ENOENT", "mkdir", target);
    mkdirSync(parent, { recursive: true });
  }
  nodes.set(target, { kind: "dir", mtimeMs: Date.now() });
  return target;
}

export function writeFileSync(p: string | URL, data: string | Uint8Array, _opts?: unknown) {
  const target = norm(p);
  const parent = nodes.get(path.dirname(target));
  if (!parent) fail("ENOENT", "open", target);
  if (parent.kind !== "dir") fail("ENOTDIR", "open", target);
  if (nodes.get(target)?.kind === "dir") fail("EISDIR", "open", target);
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  nodes.set(target, { kind: "file", data: bytes, mtimeMs: Date.now() });
}

export function readFileSync(p: string | URL, opts?: Enc): Buffer | string {
  const target = norm(p);
  const n = need(target, "open");
  if (n.kind === "dir") fail("EISDIR", "read", target);
  const buf = Buffer.from(n.data);
  const enc = encodingOf(opts);
  return enc ? buf.toString(enc) : buf;
}

export function statSync(p: string | URL, opts?: { throwIfNoEntry?: boolean }) {
  const target = norm(p);
  const n = nodes.get(target);
  if (!n) {
    if (opts?.throwIfNoEntry === false) return undefined;
    fail("ENOENT", "stat", target);
  }
  return new Stats(n);
}
export const lstatSync = statSync;

export function realpathSync(p: string | URL) {
  const target = norm(p);
  need(target, "realpath");
  return target;
}

export function readdirSync(p: string | URL, opts: { withFileTypes: true }): Dirent[];
export function readdirSync(p: string | URL, opts?: { withFileTypes?: false } | BufferEncoding): string[];
export function readdirSync(p: string | URL, opts?: { withFileTypes?: boolean } | BufferEncoding): (string | Dirent)[] {
  const dir = norm(p);
  const n = need(dir, "scandir");
  if (n.kind !== "dir") fail("ENOTDIR", "scandir", dir);
  const names = childrenOf(dir).sort();
  if (typeof opts === "object" && opts?.withFileTypes) return names.map((k) => new Dirent(path.basename(k), nodes.get(k)!, dir));
  return names.map((k) => path.basename(k));
}

export function renameSync(from: string | URL, to: string | URL) {
  const a = norm(from);
  const b = norm(to);
  need(a, "rename");
  if (!nodes.has(path.dirname(b))) fail("ENOENT", "rename", b);
  // replace an existing target, as rename(2) does for files and empty directories
  if (nodes.has(b)) rmSync(b, { recursive: true });
  for (const k of within(a)) {
    const moved = nodes.get(k)!;
    nodes.delete(k);
    nodes.set(b + k.slice(a.length), moved);
  }
}

export function rmSync(p: string | URL, opts?: { recursive?: boolean; force?: boolean }) {
  const target = norm(p);
  const n = nodes.get(target);
  if (!n) {
    if (opts?.force) return;
    fail("ENOENT", "rm", target);
  }
  if (n.kind === "dir" && !opts?.recursive && childrenOf(target).length) fail("ENOTEMPTY", "rm", target);
  for (const k of within(target)) nodes.delete(k);
}

export function cpSync(from: string | URL, to: string | URL, opts?: { recursive?: boolean }) {
  const a = norm(from);
  const b = norm(to);
  const root = need(a, "cp");
  if (root.kind === "dir" && !opts?.recursive) fail("EISDIR", "cp", a);
  for (const k of within(a).sort()) {
    const n = nodes.get(k)!;
    const dest = b + k.slice(a.length);
    if (n.kind === "dir") mkdirSync(dest, { recursive: true });
    else {
      mkdirSync(path.dirname(dest), { recursive: true });
      writeFileSync(dest, n.data);
    }
  }
}

/** The async API the api uses; the in-memory calls never block, so these just wrap the sync ones. */
export const promises = {
  lstat: async (p: string | URL) => lstatSync(p)!,
  readdir: async (p: string | URL, opts?: { withFileTypes?: boolean }) =>
    opts?.withFileTypes ? readdirSync(p, { withFileTypes: true }) : readdirSync(p),
  readFile: async (p: string | URL, opts?: Enc) => readFileSync(p, opts),
  rename: async (a: string | URL, b: string | URL) => renameSync(a, b),
  rm: async (p: string | URL, opts?: { recursive?: boolean; force?: boolean }) => rmSync(p, opts),
  writeFile: async (p: string | URL, data: string | Uint8Array, opts?: unknown) => writeFileSync(p, data, opts),
};

/** Files (not directories) under the given roots, for saving to IndexedDB. */
export function snapshot(roots: string[]): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {};
  for (const root of roots) {
    for (const k of within(root)) {
      const n = nodes.get(k)!;
      if (n.kind === "file") out[k] = n.data;
    }
  }
  return out;
}

export function restore(files: Record<string, Uint8Array>) {
  for (const [k, data] of Object.entries(files)) {
    mkdirSync(path.dirname(k), { recursive: true });
    writeFileSync(k, data);
  }
}

export default { existsSync, mkdirSync, writeFileSync, readFileSync, statSync, lstatSync, realpathSync, readdirSync, renameSync, rmSync, cpSync, promises };
