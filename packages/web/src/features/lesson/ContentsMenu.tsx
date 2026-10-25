import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import type { ExamRow, Lesson } from "@selfschool/shared";
import { cx } from "../../ui";
import { CheckCircle, CurrentDot, HollowCircle, MenuIcon } from "./icons";

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function examTag(exam: ExamRow): { text: string; tone: "warn" | "ok" | "bad" } | null {
  switch (exam.status) {
    case "not_started":
      return null;
    case "passed":
      return { text: "PASSED", tone: "ok" };
    case "failed":
      return { text: `FAILED · ATTEMPT ${exam.attemptCount}`, tone: "bad" };
    default:
      return { text: `ATTEMPT ${Math.max(1, exam.attemptCount)}`, tone: "warn" };
  }
}

const rowBase = "flex items-center gap-2.5 rounded-control px-2.5 py-[7px] text-sm no-underline";
const labelCls = "flex justify-between gap-3 px-2.5 pb-1 pt-2 font-mono text-[11px] uppercase tracking-[0.08em]";

/**
 * Contents button + popover. The popover is portalled to <body> (the band clips overflow), traps Tab,
 * closes on Escape / outside click / navigation and puts focus back on the button.
 */
export function ContentsMenu({ lesson, anchorRef }: { lesson: Lesson; anchorRef: RefObject<HTMLElement | null> }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const courseId = lesson.course.id;

  const close = useCallback((restore = true) => {
    setOpen(false);
    if (restore) button.current?.focus();
  }, []);

  const place = useCallback(() => {
    const r = (anchorRef.current ?? button.current)?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 6, right: Math.max(12, window.innerWidth - r.right) });
  }, [anchorRef]);

  useLayoutEffect(() => {
    if (!open) return;
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, place]);

  useEffect(() => {
    if (!open || !pos) return;
    const target = panel.current?.querySelector<HTMLElement>('[aria-current="page"]') ?? panel.current?.querySelector<HTMLElement>(FOCUSABLE);
    target?.focus();
    // only when the panel first appears
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pos === null]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panel.current?.contains(t) || button.current?.contains(t)) return;
      close(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, close]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
      return;
    }
    if (e.key !== "Tab" || !panel.current) return;
    const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !panel.current.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !panel.current.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  };

  const currentChapter = lesson.chapters.findIndex((c) => c.lessons.some((l) => l.id === lesson.lesson.id));
  const tag = lesson.exam ? examTag(lesson.exam) : null;

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? id : undefined}
        onClick={() => (open ? close() : setOpen(true))}
        className="inline-flex h-[34px] cursor-pointer items-center gap-2 rounded-control border border-border2 bg-bg px-3 font-sans text-sm font-medium text-text"
      >
        <MenuIcon />
        Contents
      </button>
      {open && pos
        ? createPortal(
            <div
              ref={panel}
              id={id}
              role="dialog"
              aria-label="Contents"
              onKeyDown={onKeyDown}
              data-hue={lesson.course.hue}
              style={{ top: pos.top, right: pos.right, boxShadow: "0 12px 32px rgba(11, 18, 32, 0.14)" }}
              className="fixed z-40 flex max-h-[min(70vh,640px)] w-[min(340px,calc(100vw-24px))] flex-col gap-0.5 overflow-y-auto rounded-card border border-border2 bg-bg p-2 font-sans text-text"
            >
              {lesson.chapters.map((ch, i) => (
                <div key={ch.dir} className="flex flex-col gap-0.5">
                  <div className={cx(labelCls, i > 0 && "mt-1 border-t border-border", i === currentChapter ? "text-text" : "text-text3")}>
                    <span>
                      {i + 1} · {ch.title}
                    </span>
                    <span className="text-text3">
                      {ch.done}/{ch.total}
                    </span>
                  </div>
                  {ch.lessons.map((l) => {
                    const current = l.id === lesson.lesson.id;
                    const icon: ReactNode = l.status === "done" ? <CheckCircle /> : current || l.status === "current" ? <CurrentDot /> : <HollowCircle />;
                    return (
                      <Link
                        key={l.id}
                        to={`/courses/${courseId}/lessons/${l.id}`}
                        aria-current={current ? "page" : undefined}
                        onClick={() => close(false)}
                        className={cx(rowBase, current ? "bg-hue-bg font-medium text-hue-ink" : "text-text2")}
                      >
                        <span className={cx("flex", l.status === "done" && !current ? "text-ok" : current ? "" : "text-text3")}>{icon}</span>
                        <span className="min-w-0 grow">{l.title}</span>
                        {l.updated ? <span className="font-mono text-[10px] uppercase text-hue-ink">Rev {l.revision}</span> : null}
                      </Link>
                    );
                  })}
                  {lesson.exam && i === (currentChapter === -1 ? lesson.chapters.length - 1 : currentChapter) ? (
                    <Link to={`/courses/${courseId}/exams/${lesson.exam.id}`} onClick={() => close(false)} className={cx(rowBase, "justify-between text-text2")}>
                      <span>{lesson.exam.title}</span>
                      {tag ? <span className={cx("font-mono text-[11px]", tag.tone === "warn" ? "text-warn" : tag.tone === "ok" ? "text-ok" : "text-bad")}>{tag.text}</span> : null}
                    </Link>
                  ) : null}
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
