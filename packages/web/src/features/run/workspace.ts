import { useSyncExternalStore } from "react";
import type { RunFile } from "./protocol";

/** Where a file in the working folder came from. */
export type FileOrigin = "lesson" | "yours" | "output";

export interface WorkFile extends RunFile {
  origin: FileOrigin;
  /** The learner edited this file (in the editor drawer): what it held before, for Reset and the changed-line marks. */
  original?: Uint8Array;
  /** A lesson file: where it came from, so a same-named file of another lesson is told apart. */
  url?: string;
}

/**
 * One working folder per course, kept for this browser tab: lesson resources, files the learner adds, and what runs
 * write (lab-corpus.py writes input.txt, which later labs read). It lives in memory, so a reload starts it fresh.
 */
const folders = new Map<string, Map<string, WorkFile>>();
const listeners = new Set<() => void>();
const snapshots = new Map<string, WorkFile[]>();

function changed(courseId: string) {
  snapshots.delete(courseId);
  for (const l of listeners) l();
}

const folder = (courseId: string) => {
  let f = folders.get(courseId);
  if (!f) {
    f = new Map();
    folders.set(courseId, f);
  }
  return f;
};

/**
 * Adds or replaces files. A lesson resource never overwrites the learner's own file, a run's output of the same name,
 * or a lesson file the learner has edited.
 */
export function putFiles(courseId: string, files: (RunFile & { url?: string })[], origin: FileOrigin) {
  const f = folder(courseId);
  for (const file of files) {
    const prev = f.get(file.path);
    if (origin === "lesson" && prev && (prev.origin !== "lesson" || prev.original)) continue;
    f.set(file.path, { ...file, origin: origin === "output" && prev?.origin === "yours" ? "yours" : origin });
  }
  changed(courseId);
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

/** The learner's edit of a file. The first edit keeps what the file held, so Reset can bring it back. */
export function editFile(courseId: string, path: string, data: Uint8Array) {
  const f = folder(courseId);
  const prev = f.get(path);
  if (!prev) return;
  const original = prev.original ?? prev.data;
  // typing a file back to how it was makes it unedited again
  const { original: _drop, ...rest } = prev;
  f.set(path, sameBytes(original, data) ? { ...rest, data: original } : { ...rest, data, original });
  changed(courseId);
}

/** Undoes the learner's edits of a file. */
export function resetFile(courseId: string, path: string) {
  const f = folder(courseId);
  const prev = f.get(path);
  if (!prev?.original) return;
  const { original, ...rest } = prev;
  f.set(path, { ...rest, data: original });
  changed(courseId);
}

export function getFile(courseId: string, path: string): WorkFile | undefined {
  return folder(courseId).get(path);
}

export function removeFile(courseId: string, path: string) {
  if (folder(courseId).delete(path)) changed(courseId);
}

export function hasFile(courseId: string, path: string) {
  return folder(courseId).has(path);
}

/**
 * Whether a lesson resource still has to be fetched into the folder: it is not there, or the file there is an
 * untouched copy of a same-named file from another lesson. The learner's own files and edits are never replaced.
 */
export function needsLessonFile(courseId: string, r: { name: string; url: string }) {
  const f = folder(courseId).get(r.name);
  return !f || (f.origin === "lesson" && !f.original && f.url !== undefined && f.url !== r.url);
}

export function listFiles(courseId: string): WorkFile[] {
  let s = snapshots.get(courseId);
  if (!s) {
    s = [...folder(courseId).values()].sort((a, b) => a.path.localeCompare(b.path));
    snapshots.set(courseId, s);
  }
  return s;
}

export function useWorkspace(courseId: string): WorkFile[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => listFiles(courseId),
  );
}

/** Test helper. */
export function resetWorkspaces() {
  folders.clear();
  snapshots.clear();
}
