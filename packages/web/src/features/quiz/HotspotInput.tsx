import { useState, type KeyboardEvent, type MouseEvent } from "react";
import type { AnswerResult, LearnerQuestion } from "@selfschool/shared";
import { cx } from "../../ui";
import { CheckCircle, XCircle } from "./icons";
import { Inline } from "./inline";
import type { Draft } from "./state";

type HotspotQuestion = Extract<LearnerQuestion, { type: "hotspot" }>;
type Point = { x: number; y: number };

/** Question ids are `course:question`; the image is served by the course files endpoint (resources/ only). */
export const imageUrl = (q: HotspotQuestion): string => {
  const course = q.id.includes(":") ? q.id.split(":")[0]! : "";
  return `/api/courses/${encodeURIComponent(course)}/files/${q.image.split("/").map(encodeURIComponent).join("/")}`;
};

/** Where markers go: one marker moves, several fill up and then the last one moves. */
export function placePoint(points: Point[], picks: number, p: Point): Point[] {
  if (picks <= 1) return [p];
  return points.length < picks ? [...points, p] : [...points.slice(0, -1), p];
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const clamp = (n: number) => Math.min(100, Math.max(0, n));

const Marker = ({ p, n, tone }: { p: Point; n: number | null; tone: "plain" | "ok" | "bad" }) => (
  <span
    className="pointer-events-none absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-solid border-white font-mono text-[11px] font-medium text-white shadow-[0_0_0_1px_rgba(0,0,0,0.5)]"
    style={{ left: `${p.x}%`, top: `${p.y}%`, backgroundColor: tone === "ok" ? "var(--ok)" : tone === "bad" ? "var(--bad)" : "var(--accent)" }}
  >
    {n}
  </span>
);

/**
 * Click the image to place a marker. Click a marker again to take it off. The picture is also a keyboard target:
 * arrow keys move a crosshair (Shift for bigger steps) and Enter places a marker.
 */
export function HotspotInput({ question, draft, onChange, disabled, describedBy }: { question: HotspotQuestion; draft: Draft; onChange: (d: Draft) => void; disabled?: boolean; describedBy?: string }) {
  const points = draft.points ?? [];
  const [cursor, setCursor] = useState<Point | null>(null);
  const [loaded, setLoaded] = useState(false);
  const place = (p: Point) => onChange({ ...draft, points: placePoint(points, question.picks, p) });

  const click = (e: MouseEvent<HTMLDivElement>) => {
    if (disabled || !loaded) return;
    const box = e.currentTarget.getBoundingClientRect();
    place({ x: round1(clamp(((e.clientX - box.left) / box.width) * 100)), y: round1(clamp(((e.clientY - box.top) / box.height) * 100)) });
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const step = e.shiftKey ? 10 : 2;
    const at = cursor ?? { x: 50, y: 50 };
    const move: Record<string, Point> = { ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 }, ArrowUp: { x: 0, y: -step }, ArrowDown: { x: 0, y: step } };
    const d = move[e.key];
    if (d) {
      e.preventDefault();
      setCursor({ x: clamp(at.x + d.x), y: clamp(at.y + d.y) });
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      place(at);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div
        role="application"
        tabIndex={disabled ? -1 : 0}
        aria-label={`${question.alt}. Click to place ${question.picks === 1 ? "a marker" : `up to ${question.picks} markers`}, or use the arrow keys and Enter.`}
        aria-describedby={describedBy}
        onClick={click}
        onKeyDown={key}
        onBlur={() => setCursor(null)}
        className={cx("relative block w-full select-none overflow-hidden rounded-lg border border-border bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text", disabled ? "cursor-default" : "cursor-crosshair")}
      >
        <img src={imageUrl(question)} alt="" draggable={false} onLoad={() => setLoaded(true)} className={cx("block h-auto w-full", !loaded && "min-h-[200px]")} />
        {!loaded ? <div className="shimmer absolute inset-0" aria-hidden="true" /> : null}
        {points.map((p, i) => (
          <Marker key={i} p={p} n={question.picks > 1 ? i + 1 : null} tone="plain" />
        ))}
        {cursor ? (
          <span className="pointer-events-none absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-dashed border-accent" style={{ left: `${cursor.x}%`, top: `${cursor.y}%` }} />
        ) : null}
      </div>
      <div className="flex items-center justify-between gap-3 text-xs text-text3">
        <span>
          {question.picks === 1 ? "Click the image to place your marker. Click again to move it." : `Click the image to place up to ${question.picks} markers. ${points.length} of ${question.picks} placed.`}
        </span>
        {points.length > 0 && !disabled ? (
          <button type="button" onClick={() => onChange({ ...draft, points: [] })} className="m-0 cursor-pointer border-0 bg-transparent p-0 text-xs text-text2 underline">
            Clear
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** After checking: the image with every region outlined, your markers marked right or wrong, then why. */
export function HotspotReview({ question, result, draft }: { question: HotspotQuestion; result: AnswerResult; draft: Draft }) {
  const h = result.hotspot;
  const points = h?.points ?? (draft.points ?? []).map((p) => ({ ...p, ok: false, region: null as string | null }));
  return (
    <div className="flex flex-col gap-3">
      <div className="relative block w-full overflow-hidden rounded-lg border border-border bg-surface">
        <img src={imageUrl(question)} alt={question.alt} draggable={false} className="block h-auto w-full" />
        {h ? (
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
            {h.regions.map((r) => {
              const stroke = r.correct ? "var(--ok)" : r.hit ? "var(--bad)" : "transparent";
              const common = { fill: r.correct ? "color-mix(in srgb, var(--ok) 14%, transparent)" : r.hit ? "color-mix(in srgb, var(--bad) 14%, transparent)" : "none", stroke, strokeWidth: 2, strokeDasharray: r.correct && !r.hit ? "6 4" : undefined, vectorEffect: "non-scaling-stroke" as const };
              if (r.shape === "rect") return <rect key={r.name} x={r.x} y={r.y} width={r.w} height={r.h} {...common} />;
              if (r.shape === "ellipse") return <ellipse key={r.name} cx={r.x} cy={r.y} rx={r.rx} ry={r.ry} {...common} />;
              return <polygon key={r.name} points={r.points.map((q) => q.join(",")).join(" ")} {...common} />;
            })}
          </svg>
        ) : null}
        {points.map((p, i) => (
          <Marker key={i} p={p} n={points.length > 1 ? i + 1 : null} tone={h ? (p.ok ? "ok" : "bad") : "plain"} />
        ))}
      </div>
      {h ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0 text-[13px]">
          {h.regions
            .filter((r) => r.correct || r.hit)
            .map((r) => (
              <li key={r.name} className="flex items-start gap-2">
                <span className={cx("flex pt-0.5", r.correct && r.hit ? "text-ok" : r.correct ? "text-ok" : "text-bad")}>{r.correct ? <CheckCircle /> : <XCircle />}</span>
                <span className="text-text2">
                  <span className="font-medium text-text">{r.name}</span>
                  {r.correct ? (r.hit ? " · you found it. " : " · you missed it (dashed outline). ") : " · not this one. "}
                  <Inline text={r.explanation} />
                </span>
              </li>
            ))}
          {points.some((p) => p.region === null) ? <li className="text-text2">A marker outside every region counts as a miss.</li> : null}
        </ul>
      ) : null}
    </div>
  );
}
