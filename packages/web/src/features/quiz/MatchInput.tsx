import { useLayoutEffect, useRef, useState } from "react";
import type { AnswerResult, LearnerQuestion } from "@selfschool/shared";
import { cx } from "../../ui";
import { chipColor, chipHue } from "./FillInput";
import { CheckCircle, XCircle } from "./icons";
import type { Draft } from "./state";

type MatchQuestion = Extract<LearnerQuestion, { type: "match" }>;
type Line = { x1: number; y1: number; x2: number; y2: number; hue: number; tone?: "ok" | "bad" | "missed" };

const pairsOf = (d: Draft, n: number): (number | null)[] => Array.from({ length: n }, (_, i) => d.pairs?.[i] ?? null);

/** Connects left item `l` to right item `r`, freeing whatever either was connected to. */
export function connect(d: Draft, n: number, l: number, r: number | null): Draft {
  const pairs = pairsOf(d, n).map((x) => (r !== null && x === r ? null : x));
  pairs[l] = r;
  return { ...d, pairs };
}

/** Measures where each connection runs, in the coordinates of the container, and re-measures when it resizes. */
function useLines(wrap: React.RefObject<HTMLDivElement | null>, ends: () => { from: string; to: string; hue: number; tone?: Line["tone"] }[], refs: React.RefObject<Map<string, HTMLElement>>, deps: unknown[]) {
  const [lines, setLines] = useState<Line[]>([]);
  useLayoutEffect(() => {
    const measure = () => {
      const box = wrap.current?.getBoundingClientRect();
      if (!box) return;
      const next: Line[] = [];
      for (const e of ends()) {
        const a = refs.current.get(e.from)?.getBoundingClientRect();
        const b = refs.current.get(e.to)?.getBoundingClientRect();
        if (a && b) next.push({ x1: a.right - box.left, y1: a.top + a.height / 2 - box.top, x2: b.left - box.left, y2: b.top + b.height / 2 - box.top, hue: e.hue, tone: e.tone });
      }
      setLines(next);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (wrap.current) ro.observe(wrap.current);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return lines;
}

const stroke = (l: Line) => (l.tone === "ok" ? "var(--ok)" : l.tone === "bad" ? "var(--bad)" : l.tone === "missed" ? "var(--ok)" : `hsl(${l.hue} 65% 55%)`);

/** An arrow being dragged out of an item: it starts at the item's edge and stretches to the pointer (or snaps to a target). */
type Pull = { x1: number; y1: number; x2: number; y2: number; dir: 1 | -1; snapped: boolean };

function LineLayer({ lines, pull }: { lines: Line[]; pull?: Pull | null }) {
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
      {lines.map((l, i) => (
        <path key={i} d={`M${l.x1} ${l.y1} C ${l.x1 + 40} ${l.y1}, ${l.x2 - 40} ${l.y2}, ${l.x2} ${l.y2}`} fill="none" stroke={stroke(l)} strokeWidth={2} strokeLinecap="round" />
      ))}
      {pull && (
        <g stroke="var(--accent)" fill="var(--accent)">
          <path
            d={`M${pull.x1} ${pull.y1} C ${pull.x1 + 40 * pull.dir} ${pull.y1}, ${pull.x2 - 40 * pull.dir} ${pull.y2}, ${pull.x2} ${pull.y2}`}
            fill="none"
            strokeWidth={pull.snapped ? 2.5 : 2}
            strokeLinecap="round"
            strokeDasharray={pull.snapped ? undefined : "6 5"}
          />
          <circle cx={pull.x1} cy={pull.y1} r={3.5} stroke="none" />
          <polygon points={`${pull.x2},${pull.y2} ${pull.x2 - 10 * pull.dir},${pull.y2 - 5.5} ${pull.x2 - 10 * pull.dir},${pull.y2 + 5.5}`} stroke="none" />
        </g>
      )}
    </svg>
  );
}

/**
 * Connect each left item to its partner. Pull an arrow from an item to its partner (it stretches with the pointer
 * and snaps to a target), or pick an item on one side and then one on the other; pressing a connected item cuts
 * its line. Connected pairs share a colour and a line.
 */
export function MatchInput({ question, draft, onChange, disabled, describedBy }: { question: MatchQuestion; draft: Draft; onChange: (d: Draft) => void; disabled?: boolean; describedBy?: string }) {
  const n = question.left.length;
  const pairs = pairsOf(draft, n);
  const [sel, setSel] = useState<{ side: "l" | "r"; id: number } | null>(null);
  const [drag, setDrag] = useState<{ from: "l" | "r"; id: number; x: number; y: number; over: number | null } | null>(null);
  const [retract, setRetract] = useState<{ from: "l" | "r"; id: number; x: number; y: number; t: number } | null>(null);
  const swallowClick = useRef(false);
  const wrap = useRef<HTMLDivElement>(null);
  const refs = useRef(new Map<string, HTMLElement>());
  const reg = (key: string) => (el: HTMLElement | null) => void (el ? refs.current.set(key, el) : refs.current.delete(key));
  const carrying = !disabled && (sel?.side === "l" || drag?.from === "l");
  const carryingRight = !disabled && (sel?.side === "r" || drag?.from === "r");

  const lines = useLines(
    wrap,
    () => pairs.flatMap((r, l) => (r === null ? [] : [{ from: `l${l}`, to: `r${r}`, hue: chipHue(l) }])),
    refs,
    [JSON.stringify(pairs), question.id],
  );

  const link = (l: number, r: number) => {
    onChange(connect(draft, n, l, r));
    setSel(null);
  };
  const leftOf = (r: number) => pairs.indexOf(r);

  const pickLeft = (l: number) => {
    if (disabled) return;
    if (sel?.side === "r") return link(l, sel.id);
    if (sel?.side === "l" && sel.id === l) return setSel(null);
    if (pairs[l] !== null && sel === null) return onChange(connect(draft, n, l, null)); // cut the line
    setSel({ side: "l", id: l });
  };
  const pickRight = (r: number) => {
    if (disabled) return;
    if (sel?.side === "l") return link(sel.id, r);
    if (sel?.side === "r" && sel.id === r) return setSel(null);
    const l = leftOf(r);
    if (l !== -1 && sel === null) return onChange(connect(draft, n, l, null));
    setSel({ side: "r", id: r });
  };

  /** The item (and side) under a screen point, if it belongs to this question. */
  const hitTest = (cx_: number, cy_: number) => {
    const el = document.elementFromPoint(cx_, cy_)?.closest<HTMLElement>("[data-match]");
    if (!el || !wrap.current?.contains(el)) return null;
    const key = el.dataset.match!;
    return { side: key[0] as "l" | "r", id: Number(key.slice(1)) };
  };

  /** Press on an item and pull: an arrow stretches from it to the pointer; letting go on a partner connects them. */
  const startPull = (e: React.PointerEvent, kind: "l" | "r", id: number) => {
    if (disabled || e.button !== 0) return;
    const sx = e.clientX;
    const sy = e.clientY;
    let moved = false;
    let last = { x: 0, y: 0 };
    const local = (ev: PointerEvent) => {
      const box = wrap.current!.getBoundingClientRect();
      return { x: ev.clientX - box.left, y: ev.clientY - box.top };
    };
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return;
      moved = true;
      last = local(ev);
      const hit = hitTest(ev.clientX, ev.clientY);
      setSel(null);
      setRetract(null);
      setDrag({ from: kind, id, ...last, over: hit && hit.side !== kind ? hit.id : null });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (!moved) return;
      swallowClick.current = true; // the click that follows a drag must not also select
      setTimeout(() => (swallowClick.current = false), 0);
      const hit = ev.type === "pointerup" ? hitTest(ev.clientX, ev.clientY) : null;
      setDrag(null);
      if (hit && hit.side !== kind) return kind === "l" ? link(id, hit.id) : link(hit.id, id);
      // no partner under the pointer: the arrow springs back into its item
      const t0 = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - t0) / 160);
        setRetract(t >= 1 ? null : { from: kind, id, ...last, t });
        if (t < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  /** Where the stretching arrow runs right now, in the wrapper's coordinates. */
  const pull = (): Pull | null => {
    const src = drag ?? retract;
    const box = wrap.current?.getBoundingClientRect();
    const a = src ? refs.current.get(`${src.from}${src.id}`)?.getBoundingClientRect() : undefined;
    if (!src || !box || !a) return null;
    const dir = src.from === "l" ? 1 : -1;
    const x1 = (dir === 1 ? a.right : a.left) - box.left;
    const y1 = a.top + a.height / 2 - box.top;
    if (drag && drag.over !== null) {
      const t = refs.current.get(`${drag.from === "l" ? "r" : "l"}${drag.over}`)?.getBoundingClientRect();
      if (t) return { x1, y1, x2: (dir === 1 ? t.left : t.right) - box.left, y2: t.top + t.height / 2 - box.top, dir, snapped: true };
    }
    if (retract && !drag) return { x1, y1, x2: retract.x + (x1 - retract.x) * retract.t, y2: retract.y + (y1 - retract.y) * retract.t, dir, snapped: false };
    return { x1, y1, x2: src.x, y2: src.y, dir, snapped: false };
  };

  const side = (kind: "l" | "r", id: number, text: string) => {
    const linked = kind === "l" ? pairs[id] !== null : leftOf(id) !== -1;
    const hue = kind === "l" ? id : leftOf(id);
    const picked = (sel?.side === kind && sel.id === id) || (drag?.from === kind && drag.id === id);
    const target = (kind === "r" && carrying) || (kind === "l" && carryingRight);
    const hovered = drag !== null && drag.from !== kind && drag.over === id;
    return (
      <button
        key={`${kind}${id}`}
        ref={reg(`${kind}${id}`)}
        data-match={`${kind}${id}`}
        type="button"
        disabled={disabled}
        aria-pressed={picked}
        aria-label={`${text}${linked ? ". Connected. Press to disconnect" : ""}`}
        style={linked && hue >= 0 ? chipColor(hue) : undefined}
        onPointerDown={(e) => startPull(e, kind, id)}
        onClick={() => {
          if (swallowClick.current) return;
          kind === "l" ? pickLeft(id) : pickRight(id);
        }}
        className={cx(
          "m-0 w-full touch-none select-none rounded-lg border px-3 py-2 text-left text-[13px] leading-snug text-text transition-colors",
          kind === "l" && "font-mono",
          !disabled && "cursor-pointer",
          !linked && "border-border2 bg-bg",
          target && !linked && "border-2 border-accent bg-accent-soft",
          picked && "ring-2 ring-accent",
          hovered && "ring-2 ring-accent",
        )}
      >
        {text}
      </button>
    );
  };

  return (
    <div className="flex flex-col gap-2" role="group" aria-describedby={describedBy}>
      <div ref={wrap} className="relative grid grid-cols-[minmax(0,1fr)_64px_minmax(0,1fr)] items-start">
        <div className="flex flex-col gap-2.5">{question.left.map((it) => side("l", it.id, it.text))}</div>
        <div aria-hidden="true" />
        <div className="flex flex-col gap-2.5">{question.right.map((it) => side("r", it.id, it.text))}</div>
        <LineLayer lines={lines} pull={pull()} />
      </div>
      <div className="text-xs text-text3">
        {sel ? "Now pick the item it belongs with, or pick it again to cancel." : "Pull an arrow from an item to its partner, or pick one and then the other. Press a connected item to cut its line."}
      </div>
    </div>
  );
}

/** After checking: your connections drawn right or wrong (a wrong item also shows its true partner dashed), then why. */
export function MatchReview({ question, result, draft }: { question: MatchQuestion; result: AnswerResult; draft: Draft }) {
  const n = question.left.length;
  const rows = result.matches;
  const placed = pairsOf(draft, n);
  const textOf = (id: number | null) => question.right.find((r) => r.id === id)?.text ?? null;
  const rightByText = new Map(question.right.map((r) => [r.text, r.id]));
  const wrap = useRef<HTMLDivElement>(null);
  const refs = useRef(new Map<string, HTMLElement>());
  const reg = (key: string) => (el: HTMLElement | null) => void (el ? refs.current.set(key, el) : refs.current.delete(key));

  // One item is open at a time (the first one you got wrong, until you pick another); only its lines are drawn.
  const [picked, setPicked] = useState<number | null>(null);
  const active = picked ?? rows?.find((m) => !m.correct)?.id ?? 0;
  // A one-time nudge on a wrong item other than the open one, until anything is clicked.
  const nudge = picked === null ? rows?.find((m) => !m.correct && m.id !== active)?.id ?? null : null;
  const lines = useLines(
    wrap,
    () => {
      const m = rows?.find((x) => x.id === active);
      if (!m) return [];
      const to = rightByText.get(m.answer);
      const mine = placed[active];
      const ends: { from: string; to: string; hue: number; tone: Line["tone"] }[] = [];
      if (!m.correct && mine !== null && mine !== undefined) ends.push({ from: `l${active}`, to: `r${mine}`, hue: chipHue(active), tone: "bad" });
      if (to !== undefined) ends.push({ from: `l${active}`, to: `r${to}`, hue: chipHue(active), tone: "ok" });
      return ends;
    },
    refs,
    [active, JSON.stringify(placed), JSON.stringify(rows), question.id],
  );

  // quiz with show_answers off (state "recorded"): echo what was connected, reveal nothing
  if (!rows) {
    return (
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {question.left.map((it) => (
          <li key={it.id} className="flex flex-wrap items-center gap-x-2 rounded-[10px] border border-border2 bg-surface px-3.5 py-2.5 text-[13px]">
            <code className="font-mono text-text">{it.text}</code>
            <span className="text-text3" aria-hidden="true">↔</span>
            <span className="text-text2">{textOf(placed[it.id] ?? null) ?? "nothing"}</span>
          </li>
        ))}
      </ul>
    );
  }

  const current = rows.find((m) => m.id === active)!;
  const right = rows.filter((r) => r.correct).length;
  const chosen = placed[active] ?? null;
  const truth = rightByText.get(current.answer);
  // Only the open item's relevant right-hand items stay: where it belongs (green) and, if you were wrong, what you chose (red).
  const shown: { id: number; text: string; ok: boolean }[] = [
    ...(!current.correct && chosen !== null ? [{ id: chosen, text: textOf(chosen) ?? "", ok: false }] : []),
    ...(truth !== undefined ? [{ id: truth, text: current.answer, ok: true }] : []),
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="text-xs text-text3">{right} of {rows.length} pairs right. Select an item to see where it belongs.</div>
      <div ref={wrap} className="relative grid grid-cols-[minmax(0,1fr)_64px_minmax(0,1fr)] items-start">
        <div className="flex flex-col gap-2.5">
          {question.left.map((it) => {
            const v = rows.find((m) => m.id === it.id);
            return (
              <div key={it.id} className="relative">
                {it.id === nudge && (
                  <span aria-hidden="true" className="pointer-events-none absolute -top-3.5 right-2 z-10 animate-pulse rounded-md border border-dotted border-black bg-[#fde68a] px-2 py-0.5 font-sans text-[11px] font-semibold text-black shadow">
                    Click me
                    <span className="absolute -bottom-[5px] right-3 h-2 w-2 rotate-45 border-b border-r border-dotted border-black bg-[#fde68a]" />
                  </span>
                )}
                <button
                  ref={reg(`l${it.id}`)}
                  type="button"
                  aria-pressed={it.id === active}
                  onClick={() => setPicked(it.id)}
                  className={cx(
                    "m-0 flex w-full cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-left font-mono text-[13px] leading-snug",
                    v?.correct ? "border-ok bg-ok-bg text-ok" : "border-bad bg-bad-bg text-bad",
                    it.id === active && "ring-2 ring-accent",
                  )}
                >
                  {v?.correct ? <CheckCircle /> : <XCircle />}
                  <span className="sr-only">{v?.correct ? "Correct: " : "Wrong: "}</span>
                  {it.text}
                </button>
              </div>
            );
          })}
        </div>
        <div aria-hidden="true" />
        <div className="flex flex-col gap-2.5" aria-live="polite">
          {shown.map((s) => (
            <span
              key={s.id}
              ref={reg(`r${s.id}`)}
              className={cx("flex items-center gap-2 rounded-lg border px-3 py-2 text-[13px] leading-snug", s.ok ? "border-ok bg-ok-bg text-ok" : "border-bad bg-bad-bg text-bad")}
            >
              {s.ok ? <CheckCircle /> : <XCircle />}
              <span className="sr-only">{s.ok ? "Where it belongs: " : "You chose: "}</span>
              {s.text}
            </span>
          ))}
        </div>
        <LineLayer lines={lines} />
      </div>
      <p className="m-0 text-[13px] text-text2">
        <code className="font-mono text-[12px] text-text">{current.left}</code> <span aria-hidden="true">→</span> <span className="font-medium text-text">{current.answer}</span>. {current.explanation}
      </p>
    </div>
  );
}
