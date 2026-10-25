import { useState, type CSSProperties } from "react";
import type { AnswerResult, LearnerQuestion } from "@selfschool/shared";
import { cx } from "../../ui";
import { CheckCircle, XCircle } from "./icons";
import { clearSlot, isOrdering, looksLikeCode, parseTemplate, placeChip, slotCount, slotsOf } from "./fill";
import type { Draft } from "./state";

type FillQuestion = Extract<LearnerQuestion, { type: "fill" }>;

const chipBase = "rounded-md border px-2.5 py-1 text-[13px] leading-normal";

/** A distinct, stable hue per chip (golden-angle steps), tinted with alpha so it reads in light and dark. */
export const chipHue = (id: number): number => Math.round((id * 137.5 + 20) % 360);
export const chipColor = (id: number): CSSProperties => {
  const h = chipHue(id);
  return { backgroundColor: `hsl(${h} 70% 55% / 0.26)`, borderColor: `hsl(${h} 65% 55% / 0.85)` };
};

/**
 * Drag chips into the numbered slots. Dragging is only one way in: pick a chip (click or Enter) and then a slot
 * places it, and a filled slot returns its chip to the bank. All of it is real buttons, so keyboard and touch work.
 */
export function FillInput({
  question,
  draft,
  onChange,
  disabled,
  describedBy,
}: {
  question: FillQuestion;
  draft: Draft;
  onChange: (d: Draft) => void;
  disabled?: boolean;
  describedBy?: string;
}) {
  const count = slotCount(question.template);
  const slots = slotsOf(draft, count);
  const text = (id: number | null) => question.chips.find((c) => c.id === id)?.text ?? "";
  const [picked, setPicked] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const mono = looksLikeCode(question.template);
  /** A chip is in hand (picked or mid-drag): every slot lights up as a place to put it. */
  const carrying = !disabled && (picked !== null || dragging !== null);

  const isOver = (slot: number) => over === slot;
  /** A placed chip is being dragged: the bank becomes a drop target that takes it back. */
  const returning = !disabled && dragging !== null && slots.includes(dragging);
  const returnToBank = (chip: number) => {
    const at = slots.indexOf(chip);
    if (at !== -1) onChange(clearSlot(draft, count, at));
  };
  const put = (chip: number, slot: number) => {
    onChange(placeChip(draft, count, chip, slot));
    setPicked(null);
  };
  const onSlot = (slot: number) => {
    if (disabled) return;
    if (picked !== null) put(picked, slot);
    else if (slots[slot] !== null) onChange(clearSlot(draft, count, slot));
  };

  const slotButton = (slot: number) => {
    const chip = slots[slot] ?? null;
    return (
      <button
        key={`s${slot}`}
        type="button"
        disabled={disabled}
        draggable={chip !== null && !disabled}
        onClick={() => onSlot(slot)}
        onDragStart={(e) => {
          if (chip === null) return;
          e.dataTransfer.setData("text/plain", String(chip));
          setDragging(chip);
        }}
        onDragEnd={(e) => {
          setDragging(null);
          // dropped on nothing: the chip goes back to the bank
          if (chip !== null && !disabled && e.dataTransfer.dropEffect === "none") onChange(clearSlot(draft, count, slot));
        }}
        onDragOver={(e) => {
          if (disabled) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          setOver(slot);
        }}
        onDragLeave={() => setOver((o) => (o === slot ? null : o))}
        onDrop={(e) => {
          e.preventDefault();
          setOver(null);
          setDragging(null);
          const id = Number(e.dataTransfer.getData("text/plain"));
          if (!disabled && Number.isInteger(id) && question.chips.some((c) => c.id === id)) put(id, slot);
        }}
        aria-label={chip !== null ? `Slot ${slot + 1}: ${text(chip)}. Press to remove` : `Slot ${slot + 1}: empty${picked !== null ? ". Press to place the chosen chip" : ""}`}
        style={chip !== null ? chipColor(chip) : undefined}
        className={cx(
          "mx-0.5 inline-block min-w-[84px] rounded-md border px-2.5 py-0.5 align-middle text-center text-[13px] transition-colors disabled:cursor-default",
          mono ? "font-mono" : "",
          chip !== null
            ? "cursor-grab text-text"
            : carrying
              ? "animate-pulse border-2 border-solid border-accent bg-accent-soft font-medium text-accent"
              : "border-dashed border-text3 bg-bg text-text3",
          isOver(slot) && "ring-2 ring-accent",
        )}
      >
        {chip !== null ? text(chip) : carrying ? "Drop here" : String(slot + 1)}
      </button>
    );
  };

  const parts = parseTemplate(question.template);
  return (
    <div className="flex flex-col gap-3" aria-describedby={describedBy} role="group">
      {isOrdering(question.template) ? (
        <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
          {parts
            .filter((p): p is { slot: number } => "slot" in p)
            .map((p) => (
              <li key={p.slot} className="flex items-center gap-2.5">
                <span className="w-4 text-right font-mono text-xs text-text3" aria-hidden="true">
                  {p.slot}
                </span>
                <span className="min-w-0 flex-1 [&>button]:m-0 [&>button]:block [&>button]:w-full [&>button]:py-2 [&>button]:text-left">{slotButton(p.slot - 1)}</span>
              </li>
            ))}
        </ol>
      ) : (
        <div className={cx("whitespace-pre-wrap break-words rounded-lg border border-border bg-surface px-3.5 py-3 text-sm leading-[2.1]", mono && "font-mono text-[13px]")}>
          {parts.map((p, i) => ("slot" in p ? slotButton(p.slot - 1) : <span key={i}>{p.text}</span>))}
        </div>
      )}

      <div
        className={cx("-m-2 rounded-lg border border-transparent p-2 transition-colors", returning && "border-dashed border-accent bg-accent-soft")}
        onDragOver={(e) => {
          if (!returning) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        }}
        onDrop={(e) => {
          if (!returning) return;
          e.preventDefault();
          setDragging(null);
          returnToBank(Number(e.dataTransfer.getData("text/plain")));
        }}
      >
        <div className="mb-1.5 text-xs text-text3">
          {returning ? "Drop here to take the chip back." : picked !== null ? "Now pick a slot, or pick the chip again to cancel." : "Drag a chip into a slot, or pick a chip and then a slot. Drag a placed chip out to remove it."}
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Chips">
          {question.chips.map((c) => {
            const used = slots.includes(c.id);
            return (
              <button
                key={c.id}
                type="button"
                disabled={disabled || used}
                draggable={!disabled && !used}
                onDragStart={(e) => {
                  e.dataTransfer.setData("text/plain", String(c.id));
                  setDragging(c.id);
                }}
                onDragEnd={() => setDragging(null)}
                onClick={() => setPicked((p) => (p === c.id ? null : c.id))}
                aria-pressed={picked === c.id}
                style={chipColor(c.id)}
                className={cx(chipBase, mono && "font-mono", used ? "border-dashed opacity-35" : "cursor-grab text-text", picked === c.id && "ring-2 ring-accent")}
              >
                {c.text}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** After checking: each slot with what was placed, the right answer and why. */
export function FillReview({ question, result, draft }: { question: FillQuestion; result: AnswerResult; draft: Draft }) {
  const count = slotCount(question.template);
  const slots = slotsOf(draft, count);
  const text = (id: number | null) => question.chips.find((c) => c.id === id)?.text ?? "";
  // quiz with show_answers off (state "recorded"): echo the placement, reveal nothing
  const rows: NonNullable<AnswerResult["slots"]> = result.slots ?? slots.map((c) => ({ placed: text(c), correct: false, answer: "", explanation: "" }));
  const revealed = !!result.slots;
  const mono = looksLikeCode(question.template);
  const ordering = isOrdering(question.template);

  // The learner's own answer, laid out like the question, each chip marked right or wrong where it sits.
  const placed = (slot: number) => {
    const r = rows[slot - 1];
    if (!r) return null;
    return (
      <span
        key={`s${slot}`}
        className={cx(
          "mx-0.5 inline-flex items-center gap-1.5 rounded-md border px-2.5 py-0.5 align-middle text-[13px]",
          mono && "font-mono",
          !revealed ? "border-border2 bg-surface2" : r.correct ? "border-ok bg-ok-bg text-ok" : "border-bad bg-bad-bg text-bad",
        )}
      >
        {revealed ? r.correct ? <CheckCircle /> : <XCircle /> : null}
        <span className="sr-only">{revealed ? (r.correct ? "Correct: " : "Wrong: ") : ""}</span>
        {r.placed}
      </span>
    );
  };
  const parts = parseTemplate(question.template);

  return (
    <div className="flex flex-col gap-3">
      {ordering ? (
        <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
          {parts
            .filter((p): p is { slot: number } => "slot" in p)
            .map((p) => (
              <li key={p.slot} className="flex items-center gap-2.5">
                <span className="w-4 text-right font-mono text-xs text-text3" aria-hidden="true">
                  {p.slot}
                </span>
                {placed(p.slot)}
              </li>
            ))}
        </ol>
      ) : (
        <div className={cx("whitespace-pre-wrap break-words rounded-lg border border-border bg-surface px-3.5 py-3 text-sm leading-[2.1]", mono && "font-mono text-[13px]")}>
          {parts.map((p, i) => ("slot" in p ? placed(p.slot) : <span key={i}>{p.text}</span>))}
        </div>
      )}

      {revealed && ordering ? (
        <div className="flex flex-col gap-2 text-[13px]">
          <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-text3">{rows.every((r) => r.correct) ? "Why this order" : "Correct order"}</div>
          <ol className="m-0 flex list-none flex-col p-0">
            {rows.map((r, i) => (
              <li key={i} className={cx("relative flex items-start gap-3", i < rows.length - 1 && "pb-3.5")}>
                {/* the line joins each step to the next, top to bottom, so the sequence reads at a glance */}
                {i < rows.length - 1 ? <span className="absolute bottom-0 left-[9.5px] top-6 w-px bg-border2" aria-hidden="true" /> : null}
                <span className="z-[1] flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border2 bg-bg font-mono text-[11px] text-text2" aria-hidden="true">
                  {i + 1}
                </span>
                <span className="text-text2">
                  <span className="font-medium text-text">{r.answer}</span>
                  {". "}
                  {r.explanation}
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {revealed && !ordering ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0 text-[13px]">
          {rows.map((r, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className={cx("flex pt-0.5", r.correct ? "text-ok" : "text-bad")}>{r.correct ? <CheckCircle /> : <XCircle />}</span>
              <span className="text-text2">
                <span className="mr-1.5 font-mono text-xs text-text3">{i + 1}</span>
                {r.correct ? (
                  r.explanation
                ) : (
                  <>
                    <span className="font-medium text-text">Slot {i + 1} should be: </span>
                    <span className={cx("text-text", mono && "font-mono text-[12px]")}>{r.answer}</span>
                    {". "}
                    {r.explanation}
                    {r.placedExplanation ? (
                      <span className="mt-1 block">
                        <span className="font-medium text-text">Why not <span className={cx(mono && "font-mono text-[12px]")}>{r.placed}</span>: </span>
                        {r.placedExplanation}
                      </span>
                    ) : null}
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
