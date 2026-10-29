import { type CSSProperties, type RefObject, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button, cx } from "../../ui";
import { CodeEditor } from "./CodeEditor";
import { diffLines } from "./diff";
import { languageOf } from "./files";
import { useLab } from "./lab";
import { PlayIcon } from "./PlayIcon";
import { drawerWidth, ResizeHandle, useLabSize } from "./resize";
import { editFile, getFile, resetFile, useWorkspace } from "./workspace";

const MAX_EDITABLE = 512 * 1024;
// keeps a byte-order mark as a character, so saving the text back gives the same bytes
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const NO_DIFF = { changed: new Set<number>(), count: 0 };

/**
 * A file as the editor shows it: its text with "\n" line ends (`crlf` remembers Windows line ends, which are put back
 * when the edit is saved), or null for binary or very large files.
 */
export function editableText(data: Uint8Array): { text: string; crlf: boolean } | null {
  if (data.length > MAX_EDITABLE) return null;
  try {
    const raw = decoder.decode(data);
    if (raw.includes("\u0000")) return null;
    return { text: raw.replace(/\r\n/g, "\n"), crlf: raw.includes("\r\n") };
  } catch {
    return null;
  }
}

/** True below the `lg` breakpoint, where the editor drawer covers the lesson instead of sitting beside it. */
export function useDrawerCovers(): boolean {
  const query = "(max-width: 1023.98px)";
  const [covers, setCovers] = useState(() => typeof matchMedia === "function" && matchMedia(query).matches);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const m = matchMedia(query);
    const on = () => setCovers(m.matches);
    on();
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return covers;
}

/**
 * How far below the top of the window an element starts (0 once it sticks to the top), kept current while the page
 * scrolls or resizes. The sticky drawer sits lower until the page is scrolled past the lesson's header.
 */
function useViewportTop(ref: RefObject<HTMLElement | null>, on: boolean): number {
  const [top, setTop] = useState(0);
  useLayoutEffect(() => {
    if (!on) return;
    const measure = () => {
      const t = Math.max(0, Math.round(ref.current?.getBoundingClientRect().top ?? 0));
      setTop((prev) => (prev === t ? prev : t));
    };
    measure();
    window.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [ref, on]);
  return top;
}

/** The bytes to store for the editor's text, with the file's own line ends; null when it would be too large to edit. */
export function savedBytes(text: string, crlf: boolean): Uint8Array | null {
  const bytes = new TextEncoder().encode(crlf ? text.replace(/\n/g, "\r\n") : text);
  return bytes.length > MAX_EDITABLE ? null : bytes;
}

/**
 * The editor drawer: the active dock tab's file, open to the right of the lesson and above the dock. Edits change the
 * file in the course's working folder (so the next Run uses them); Reset brings back what it held before; the
 * changed lines are marked against that. Edits last for this browser tab.
 */
export function EditorDrawer({ className }: { className?: string }) {
  const lab = useLab();
  const files = useWorkspace(lab?.courseId ?? "");
  const path = lab?.editing ? lab.active : null;
  const file = path ? files.find((f) => f.path === path) : undefined;
  const shown = file ? editableText(file.data) : null;
  const text = shown?.text ?? null;
  const original = file?.original ? (editableText(file.original)?.text ?? null) : null;
  // the marks may trail typing by a frame; the text itself never does
  const diffed = useDeferredValue(text);
  const diff = useMemo(() => (diffed !== null && original !== null ? diffLines(original, diffed) : NO_DIFF), [diffed, original]);
  const count = diff.count;
  const [tooLarge, setTooLarge] = useState(false);
  const aside = useRef<HTMLElement>(null);
  const top = useViewportTop(aside, !!path);
  const size = useLabSize();

  // opening a file puts the cursor in it (on a phone the drawer covers the lesson, so focus must move there)
  useEffect(() => {
    if (path) aside.current?.querySelector("textarea")?.focus({ preventScroll: true });
  }, [path]);

  if (!lab || !path) return null;
  const runnable = !!languageOf(path);
  const lang = languageOf(path) ?? path.split(".").pop();

  const download = () => {
    const f = getFile(lab.courseId, path);
    if (!f) return;
    const url = URL.createObjectURL(new Blob([f.data.slice()]));
    const a = document.createElement("a");
    a.href = url;
    a.download = path.split("/").pop() ?? path;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <aside
      ref={aside}
      data-lab-drawer=""
      aria-label={`Editor: ${path}`}
      className={cx("flex flex-col overflow-hidden border-l border-border2 bg-bg", className)}
      // from where it starts on screen down to the terminal: never behind the bottom stack, scrolled or not. The
      // width applies where the drawer sits beside the lesson (the page's class reads --drawer-w)
      style={{ height: `calc(100dvh - var(--lab-bottom, 0px) - ${top}px)`, "--drawer-w": drawerWidth(size.width) } as CSSProperties}
      onKeyDown={(e) => {
        // Escape closes the editor, except inside the code (there it first releases Tab)
        if (e.key === "Escape" && (e.target as HTMLElement).tagName !== "TEXTAREA") lab.setEditing(false);
      }}
    >
      {/* beside the lesson: drag the left edge to widen (the corner that resizes both is the terminal's) */}
      <ResizeHandle resizes="width" className="inset-y-0 left-0 hidden w-2 lg:block" />
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 border-b border-border bg-surface px-3.5 py-2">
        <span className="min-w-0 truncate font-mono text-[13px] font-medium">{path}</span>
        {count > 0 ? (
          <span className="rounded-full bg-accent-soft px-2 py-px text-[11px] text-accent">
            edited · {count} {count === 1 ? "line" : "lines"}
          </span>
        ) : null}
        <span className="ml-auto flex items-center gap-1.5">
          <Button size="sm" onClick={() => resetFile(lab.courseId, path)} disabled={!file?.original} title="Undo your changes">
            Reset
          </Button>
          <Button size="sm" onClick={download} title="Save your version of this file">
            Download
          </Button>
          {runnable ? (
            <Button variant="primary" size="sm" onClick={() => lab.run(path)} disabled={lab.running && lab.active === path} title="Run (Ctrl/⌘ + Enter)">
              <PlayIcon />
              Run
            </Button>
          ) : null}
          <Button size="sm" onClick={() => lab.setEditing(false)} aria-label="Close the editor" className="px-2!">
            <svg width="12" height="12" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
              <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" />
            </svg>
          </Button>
        </span>
      </div>

      {file === undefined ? (
        <p className="m-0 p-4 text-[13px] text-text3">Loading {path}…</p>
      ) : text === null ? (
        <p className="m-0 p-4 text-[13px] text-text3">This file is not text, or too large to edit here. You can still download it.</p>
      ) : (
        <CodeEditor
          value={text}
          onChange={(t) => {
            // an edit that would make the file too large to edit here is not taken (the editor stays as it was)
            const bytes = savedBytes(t, shown?.crlf ?? false);
            setTooLarge(bytes === null);
            if (bytes) editFile(lab.courseId, path, bytes);
          }}
          lang={lang}
          changed={diff.changed}
          onRun={() => runnable && lab.run(path)}
          label={`Code of ${path}`}
        />
      )}

      <p role={tooLarge ? "alert" : undefined} className={cx("m-0 border-t border-border px-3.5 py-1.5 text-[11.5px]", tooLarge ? "text-bad" : "text-text3")}>
        {tooLarge
          ? "That change would make the file larger than 512 KB, too large to edit here; it was not applied."
          : "Your edits run with the next Run and last until you reload the page."}
      </p>
    </aside>
  );
}
