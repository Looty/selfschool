import { type CSSProperties, type KeyboardEvent, type PointerEvent, useSyncExternalStore } from "react";
import { cx } from "../../ui";

/**
 * The learner's sizes for the lab: the editor drawer's width and the terminal output's height, in pixels (null means
 * the default). Dragged with the handles below, kept in localStorage, and clamped by CSS to what the window allows.
 */
export type LabSize = { width: number | null; height: number | null };

const KEY = "selfschool-lab-size";
export const DRAWER_MIN = 320;
export const OUTPUT_MIN = 60;
/** Room the drawer leaves for the lesson, and the terminal leaves for the page above it. */
const LESSON_ROOM = 360;
const PAGE_ROOM = 240;
const STEP = 24;

function load(): LabSize {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<LabSize> | null;
    return { width: typeof v?.width === "number" ? v.width : null, height: typeof v?.height === "number" ? v.height : null };
  } catch {
    // no storage (private mode) or a broken value: use the defaults
    return { width: null, height: null };
  }
}

let size: LabSize = load();
const listeners = new Set<() => void>();

export function setLabSize(next: Partial<LabSize>, save = true) {
  size = { ...size, ...next };
  for (const l of listeners) l();
  if (!save) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(size));
  } catch {
    // not saved: the size still holds for this page
  }
}

export function useLabSize(): LabSize {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => size,
    () => size,
  );
}

/** The drawer's CSS width: the learner's, kept between a usable minimum and what leaves room for the lesson. */
export const drawerWidth = (w: number | null) => (w === null ? "min(640px, 46vw)" : `clamp(${DRAWER_MIN}px, ${w}px, calc(100vw - ${LESSON_ROOM}px))`);
/** The output's CSS height, or undefined for the default (set by class). */
export const outputHeight = (h: number | null) => (h === null ? undefined : `clamp(${OUTPUT_MIN}px, ${h}px, calc(100dvh - ${PAGE_ROOM}px))`);

const clampWidth = (w: number) => Math.round(Math.max(DRAWER_MIN, Math.min(w, window.innerWidth - LESSON_ROOM)));
const clampHeight = (h: number) => Math.round(Math.max(OUTPUT_MIN, Math.min(h, window.innerHeight - PAGE_ROOM)));
/** What is on screen now (the CSS may have clamped the stored value), so a drag starts from what the learner sees. */
const shownWidth = () => document.querySelector("[data-lab-drawer]")?.getBoundingClientRect().width || 640;
const shownHeight = () => document.querySelector("[data-lab-output]")?.getBoundingClientRect().height || 220;

/**
 * A drag handle. `width` sits on the drawer's left edge (drag left to widen), `height` on the terminal's top edge
 * (drag up to heighten), `both` in the corner where they meet. Arrow keys resize too; a double click resets.
 */
export function ResizeHandle({ resizes, className, style }: { resizes: "width" | "height" | "both"; className?: string; style?: CSSProperties }) {
  const current = useLabSize();
  const x = resizes !== "height";
  const y = resizes !== "width";

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget;
    const [x0, y0, w0, h0] = [e.clientX, e.clientY, shownWidth(), shownHeight()];
    el.setPointerCapture?.(e.pointerId);
    const root = document.documentElement;
    root.dataset.labResizing = resizes;
    const move = (ev: globalThis.PointerEvent) =>
      setLabSize({ ...(x && { width: clampWidth(w0 + x0 - ev.clientX) }), ...(y && { height: clampHeight(h0 + y0 - ev.clientY) }) }, false);
    const end = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", end);
      el.removeEventListener("pointercancel", end);
      delete root.dataset.labResizing;
      setLabSize({});
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const grow = x ? { ArrowLeft: 1, ArrowRight: -1 } : { ArrowUp: 1, ArrowDown: -1 };
    const dir = grow[e.key as keyof typeof grow];
    if (!dir) return;
    e.preventDefault();
    if (x) setLabSize({ width: clampWidth(shownWidth() + dir * STEP) });
    else setLabSize({ height: clampHeight(shownHeight() + dir * STEP) });
  }

  const reset = () => setLabSize({ ...(x && { width: null }), ...(y && { height: null }) });
  const cursor = resizes === "width" ? "cursor-ew-resize" : resizes === "height" ? "cursor-ns-resize" : "cursor-move";
  const look = cx("absolute z-10 touch-none select-none", cursor, className);

  // the corner is a shortcut for the two edges, which keyboards and screen readers already have
  if (resizes === "both")
    return (
      <div
        aria-hidden="true"
        title="Drag to resize the editor and the terminal"
        onPointerDown={onPointerDown}
        onDoubleClick={reset}
        className={cx(look, "lab-resize-corner")}
        style={style}
      />
    );

  return (
    // biome-ignore lint/a11y/useSemanticElements: a focusable, draggable separator (an <hr> is a static rule)
    <div
      role="separator"
      aria-orientation={x ? "vertical" : "horizontal"}
      aria-label={x ? "Resize the editor" : "Resize the terminal"}
      aria-valuenow={Math.round((x ? current.width : current.height) ?? (x ? 640 : 220))}
      aria-valuemin={x ? DRAWER_MIN : OUTPUT_MIN}
      title="Drag to resize; double-click for the default size"
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={reset}
      className={cx(look, "lab-resize-edge", x ? "lab-resize-x" : "lab-resize-y")}
    />
  );
}
