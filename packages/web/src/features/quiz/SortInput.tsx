import { useState } from "react";
import type { AnswerResult, LearnerQuestion } from "@selfschool/shared";
import { cx } from "../../ui";
import { chipColor } from "./FillInput";
import { CheckCircle, XCircle } from "./icons";
import type { Draft } from "./state";

type SortQuestion = Extract<LearnerQuestion, { type: "sort" }>;

const assignedOf = (d: Draft, n: number): (number | null)[] => Array.from({ length: n }, (_, i) => d.assigned?.[i] ?? null);

/** Puts an item in a bucket; passing null returns it to the tray. */
export function assign(d: Draft, n: number, item: number, bucket: number | null): Draft {
  const assigned = assignedOf(d, n);
  assigned[item] = bucket;
  return { ...d, assigned };
}

/**
 * Sort items into buckets. Drag an item onto a bucket, or pick it (click/Enter) and then press the bucket.
 * Pressing a placed item, or dragging it back to the tray, returns it.
 */
export function SortInput({ question, draft, onChange, disabled, describedBy }: { question: SortQuestion; draft: Draft; onChange: (d: Draft) => void; disabled?: boolean; describedBy?: string }) {
  const n = question.items.length;
  const assigned = assignedOf(draft, n);
  const [picked, setPicked] = useState<number | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | "tray" | null>(null);
  const carrying = !disabled && (picked !== null || dragging !== null);
  const placedItem = dragging !== null && assigned[dragging] !== null;
  const text = (id: number) => question.items.find((i) => i.id === id)?.text ?? "";

  const put = (item: number, bucket: number | null) => {
    onChange(assign(draft, n, item, bucket));
    setPicked(null);
  };
  const dropped = (e: React.DragEvent): number | null => {
    const id = Number(e.dataTransfer.getData("text/plain"));
    return Number.isInteger(id) && id >= 0 && id < n ? id : null;
  };

  const itemButton = (id: number) => (
    <button
      key={id}
      type="button"
      disabled={disabled}
      draggable={!disabled}
      style={chipColor(id)}
      aria-pressed={picked === id}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", String(id));
        setDragging(id);
      }}
      onDragEnd={() => setDragging(null)}
      onClick={(e) => {
        if (assigned[id] !== null) {
          // a placed item: with one in hand the click falls through to the bucket, otherwise it returns to the tray
          if (picked === null) {
            e.stopPropagation();
            put(id, null);
          }
          return;
        }
        setPicked((p) => (p === id ? null : id));
      }}
      className={cx("m-0 cursor-grab rounded-md border px-2.5 py-1 text-left font-mono text-[12px] leading-snug text-text", picked === id && "ring-2 ring-accent")}
    >
      {text(id)}
    </button>
  );

  return (
    <div className="flex flex-col gap-3" role="group" aria-describedby={describedBy}>
      <div className="grid gap-2.5" style={{ gridTemplateColumns: `repeat(${Math.min(question.buckets.length, 3)}, minmax(0, 1fr))` }}>
        {question.buckets.map((name, b) => {
          const inside = question.items.filter((it) => assigned[it.id] === b);
          return (
            <div
              key={b}
              onDragOver={(e) => {
                if (disabled) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setOver(b);
              }}
              onDragLeave={() => setOver((o) => (o === b ? null : o))}
              onClick={() => !disabled && picked !== null && put(picked, b)}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                setDragging(null);
                const id = dropped(e);
                if (!disabled && id !== null) put(id, b);
              }}
              className={cx(
                "flex min-h-[110px] flex-col gap-1.5 rounded-lg border p-2 transition-colors",
                carrying ? "border-2 border-solid border-accent bg-accent-soft" : "border-dashed border-border2",
                over === b && "ring-2 ring-accent",
              )}
            >
              <button
                type="button"
                disabled={disabled || picked === null}
                aria-label={`${name}${picked !== null ? `. Press to put "${text(picked)}" here` : ""}`}
                className="m-0 cursor-default border-0 bg-transparent p-0 text-left text-xs font-medium text-text2 disabled:cursor-default enabled:cursor-pointer enabled:text-accent"
              >
                {name}
                {carrying && inside.length === 0 ? <span className="ml-1.5 font-normal text-accent">· Drop here</span> : null}
              </button>
              {inside.map((it) => itemButton(it.id))}
            </div>
          );
        })}
      </div>

      <div
        onDragOver={(e) => {
          if (!placedItem) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          setOver("tray");
        }}
        onDragLeave={() => setOver((o) => (o === "tray" ? null : o))}
        onDrop={(e) => {
          if (!placedItem) return;
          e.preventDefault();
          setOver(null);
          setDragging(null);
          const id = dropped(e);
          if (id !== null) put(id, null);
        }}
        className={cx("-m-2 rounded-lg border border-transparent p-2 transition-colors", placedItem && "border-dashed border-accent bg-accent-soft")}
      >
        <div className="mb-1.5 text-xs text-text3">
          {placedItem ? "Drop here to take the item back." : picked !== null ? "Now press a group, or pick the item again to cancel." : "Drag each item into a group, or pick an item and then a group."}
        </div>
        <div className="flex flex-wrap gap-2">{question.items.filter((it) => assigned[it.id] === null).map((it) => itemButton(it.id))}</div>
      </div>
    </div>
  );
}

/** After checking: the learner's grouping, each item marked, then why each belongs where it does. */
export function SortReview({ question, result, draft }: { question: SortQuestion; result: AnswerResult; draft: Draft }) {
  const n = question.items.length;
  const assigned = assignedOf(draft, n);
  const rows = result.sorted;
  const revealed = !!rows;
  const verdict = (id: number) => rows?.find((r) => r.id === id);
  // One item is open at a time (the first one you got wrong, until you pick another); its reason is shown below.
  const [picked, setPicked] = useState<number | null>(null);
  const active = picked ?? rows?.find((r) => !r.correct)?.id ?? rows?.[0]?.id ?? null;
  const current = rows?.find((r) => r.id === active);
  const right = rows?.filter((r) => r.correct).length ?? 0;
  const wrong = rows ? rows.length - right : 0;

  const card = (id: number, text: string, tone: "plain" | "ok" | "bad" | "ghost") => (
    <button
      key={`${tone}${id}`}
      type="button"
      aria-pressed={id === active}
      disabled={!revealed}
      onClick={() => setPicked(id)}
      className={cx(
        "m-0 flex w-full items-start gap-1.5 rounded-md border px-2.5 py-1.5 text-left text-[13px] leading-snug",
        revealed && "cursor-pointer",
        tone === "plain" && "border-border2 bg-surface2 text-text",
        tone === "ok" && "border-ok bg-ok-bg text-ok",
        tone === "bad" && "border-bad bg-bad-bg text-bad",
        tone === "ghost" && "border-2 border-dashed border-ok bg-transparent text-ok",
        id === active && "ring-2 ring-accent",
      )}
    >
      <span className="flex shrink-0 pt-0.5">{tone === "ok" || tone === "ghost" ? <CheckCircle /> : tone === "bad" ? <XCircle /> : null}</span>
      <span>
        <span className="sr-only">{tone === "ok" ? "Correct: " : tone === "bad" ? "Wrong: " : tone === "ghost" ? "Where it belongs: " : ""}</span>
        {text}
        {tone === "ghost" && <span className="ml-1.5 text-[11px] font-medium uppercase tracking-wide opacity-80">belongs here</span>}
      </span>
    </button>
  );

  return (
    <div className="flex flex-col gap-3">
      {rows ? (
        <div className="text-xs text-text3">
          {right} of {rows.length} placed right.{wrong > 0 ? " Dashed green cards show where the wrong ones belong. Select a card for the reason." : " Select a card for the reason."}
        </div>
      ) : null}
      <div className="grid gap-2.5" style={{ gridTemplateColumns: `repeat(${Math.min(question.buckets.length, 3)}, minmax(0, 1fr))` }}>
        {question.buckets.map((name, b) => (
          <div key={b} className="flex min-h-[80px] flex-col gap-1.5 rounded-lg border border-border bg-surface p-2">
            <div className="text-xs font-medium text-text2">{name}</div>
            {question.items
              .filter((it) => assigned[it.id] === b)
              .map((it) => card(it.id, it.text, !revealed ? "plain" : verdict(it.id)?.correct ? "ok" : "bad"))}
            {rows
              ?.filter((r) => !r.correct && r.answer === name)
              .map((r) => card(r.id, r.text, "ghost"))}
          </div>
        ))}
      </div>
      {current ? (
        <p className="m-0 text-[13px] text-text2" aria-live="polite">
          <span className="font-medium text-text">{current.text}</span>{" "}
          {current.correct ? (
            <>
              <span aria-hidden="true">→</span> <span className="font-medium text-ok">{current.answer}</span>.
            </>
          ) : (
            <>
              belongs in <span className="font-medium text-ok">{current.answer}</span>, not <span className="font-medium text-bad">{current.placed}</span>.
            </>
          )}{" "}
          {current.explanation}
        </p>
      ) : null}
    </div>
  );
}
