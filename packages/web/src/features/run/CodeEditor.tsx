import "../../components/code/code.css";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { highlight } from "../../components/code/highlight";

const LINE = 22;
const PAD = 12;

/**
 * Replaces `[from, to)` of a textarea with `text` as a native edit, so Ctrl+Z undoes it like typing; the text is then
 * selected, or the caret put at `caret`. Falls back to setting the value through `onChange` where the browser has no
 * insertText command.
 */
function replaceRange(el: HTMLTextAreaElement, from: number, to: number, text: string, onChange: (t: string) => void, caret?: number) {
  const select = () => (caret !== undefined ? el.setSelectionRange(caret, caret) : el.setSelectionRange(from, from + text.length));
  el.setSelectionRange(from, to);
  const native = typeof document.execCommand === "function" && document.execCommand("insertText", false, text);
  if (native) {
    select();
    return;
  }
  onChange(el.value.slice(0, from) + text + el.value.slice(to));
  requestAnimationFrame(select);
}

/**
 * A small code editor: a plain textarea (so typing, selection, undo and screen readers behave natively) laid over the
 * same text highlighted by shiki, plus a line-number gutter. Lines in `changed` (0-based) are marked. Tab indents;
 * Escape releases focus so Tab can leave; Ctrl/Cmd+Enter calls `onRun`.
 */
export function CodeEditor({
  value,
  onChange,
  lang,
  changed,
  onRun,
  label,
}: {
  value: string;
  onChange: (text: string) => void;
  lang: string | undefined;
  changed: ReadonlySet<number>;
  onRun: () => void;
  label: string;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const gutter = useRef<HTMLDivElement>(null);
  const marks = useRef<HTMLDivElement>(null);
  const hintId = useId();
  // the highlighted HTML and the exact text it was made from; shown only while it matches what is typed
  const [lit, setLit] = useState<{ code: string; html: string } | null>(null);
  const [trapTab, setTrapTab] = useState(true);

  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      highlight(value, lang)
        // the layer is decoration (aria-hidden): drop shiki's tabindex so nothing in it takes focus
        .then((html) => live && html && setLit({ code: value, html: html.replace(/ tabindex="0"/g, "") }))
        .catch(() => {});
    }, 120);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [value, lang]);

  const sync = () => {
    const el = input.current;
    if (!el) return;
    const shift = `translate(${-el.scrollLeft}px, ${-el.scrollTop}px)`;
    if (layer.current) layer.current.style.transform = shift;
    if (marks.current) marks.current.style.transform = `translateY(${-el.scrollTop}px)`;
    if (gutter.current) gutter.current.style.transform = `translateY(${-el.scrollTop}px)`;
  };
  useEffect(sync);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      onRun();
      return;
    }
    if (e.key === "Escape") {
      setTrapTab(false);
      return;
    }
    if (e.key === "Tab" && trapTab && !e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      const el = e.currentTarget;
      // the textarea's own text: the prop can lag a keystroke behind
      const v = el.value;
      const { selectionStart: s, selectionEnd: end } = el;
      if (s === end && !e.shiftKey) {
        replaceRange(el, s, end, "    ", onChange, s + 4);
        return;
      }
      // a selection, or Shift+Tab: indent or outdent every line it touches, and keep those lines selected
      const from = v.lastIndexOf("\n", s - 1) + 1;
      const lastBreak = end > s && v[end - 1] === "\n" ? end - 1 : v.indexOf("\n", end);
      const to = lastBreak === -1 ? v.length : lastBreak;
      const block = v.slice(from, to);
      const next = e.shiftKey ? block.replace(/^ {1,4}/gm, "") : block.replace(/^/gm, "    ");
      if (next === block) return;
      replaceRange(el, from, to, next, onChange, s === end ? Math.max(from, s - (block.length - next.length)) : undefined);
    }
  };

  const lines = value.split("\n").length;
  const html = lit && lit.code === value ? lit.html : null;

  return (
    <div className="relative flex min-h-0 flex-1 overflow-hidden bg-bg font-mono">
      {/* gutter: line numbers, with a bar on changed lines */}
      <div aria-hidden="true" className="relative w-12 shrink-0 overflow-hidden border-r border-border bg-surface text-right text-[12px] text-text3">
        <div ref={gutter} style={{ paddingTop: PAD, paddingBottom: PAD }}>
          {Array.from({ length: lines }, (_, i) => (
            <div key={i} style={{ height: LINE, lineHeight: `${LINE}px` }} className={changed.has(i) ? "border-r-[3px] border-accent pr-[7px] text-accent" : "pr-2.5"}>
              {i + 1}
            </div>
          ))}
        </div>
      </div>

      <div className="relative min-w-0 flex-1 overflow-hidden">
        {/* changed-line bands, behind the text */}
        <div ref={marks} aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0" style={{ paddingTop: PAD }}>
          {Array.from({ length: lines }, (_, i) => (
            <div key={i} style={{ height: LINE }} className={changed.has(i) ? "bg-accent-soft" : undefined} />
          ))}
        </div>
        <div ref={layer} aria-hidden="true" className="code-editor-layer pointer-events-none absolute left-0 top-0 text-text">
          {html ? (
            // biome-ignore lint/security/noDangerouslySetInnerHtml: shiki builds this from escaped tokens (see highlight.ts)
            <div dangerouslySetInnerHTML={{ __html: html }} />
          ) : (
            <pre className="m-0 font-[inherit]">{`${value}\n`}</pre>
          )}
        </div>
        <textarea
          ref={input}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => setTrapTab(true)}
          onScroll={sync}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          wrap="off"
          aria-label={label}
          aria-describedby={hintId}
          className="code-editor-input absolute inset-0 h-full w-full resize-none overflow-auto border-0 outline-none"
        />
        <span id={hintId} className="sr-only">
          Tab indents. Press Escape, then Tab, to leave the editor. Ctrl or Command plus Enter runs the file.
        </span>
      </div>
    </div>
  );
}
