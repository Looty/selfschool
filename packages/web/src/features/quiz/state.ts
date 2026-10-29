import type { AnswerInput, AnswerResult, LearnerQuestion, Marks } from "@selfschool/shared";
import type { BadgeTone } from "../../ui";
import { isOrdering, slotCount, slotsOf } from "./fill";

/** What the learner has typed or picked for one question, before it is submitted. */
export interface Draft {
  selected: number[];
  text: string;
  /** Fill: chip id in each slot (slot 1 first), null while empty. */
  slots?: (number | null)[];
  /** Sort: bucket index for each item (by item id), null while unplaced. */
  assigned?: (number | null)[];
  /** Spot: the selected 1-based line numbers. */
  lines?: number[];
  /** Hotspot: the markers placed, in percent of the image. */
  points?: { x: number; y: number }[];
  /** Match: the right-hand item id connected to each left item (by left id), null while unconnected. */
  pairs?: (number | null)[];
  /** Trace: typed values, one row per step and one column per variable. */
  cells?: string[][];
}

export const EMPTY_DRAFT: Draft = { selected: [], text: "" };

/** An MCQ with more than one correct option is answered by selecting all that apply. */
export const isMultiple = (q: LearnerQuestion): boolean => q.type === "mcq" && q.multiple === true;

export function typeLabel(q: LearnerQuestion): string {
  if (q.type === "mcq") return isMultiple(q) ? "Multiple choice · select all" : "Multiple choice";
  if (q.type === "fill") return isOrdering(q.template) ? "Put in order" : "Fill the gaps";
  if (q.type === "sort") return "Sort into groups";
  if (q.type === "match") return "Match the pairs";
  if (q.type === "trace") return "Trace the code";
  if (q.type === "spot") return "Select the lines";
  if (q.type === "hotspot") return q.picks > 1 ? `Click ${q.picks} places` : "Click the image";
  return q.type === "short" ? "Short answer" : "Open-ended";
}

/** The request body for a draft, or null while the draft is empty (Check stays disabled). */
export function toInput(q: LearnerQuestion, d: Draft): AnswerInput | null {
  if (q.type === "mcq") return d.selected.length > 0 ? { type: "mcq", selected: [...d.selected].sort((a, b) => a - b) } : null;
  if (q.type === "fill") {
    const slots = slotsOf(d, slotCount(q.template));
    return slots.every((c) => c !== null) ? { type: "fill", slots: slots as number[] } : null;
  }
  if (q.type === "sort") {
    const assigned = Array.from({ length: q.items.length }, (_, i) => d.assigned?.[i] ?? null);
    return assigned.every((b) => b !== null) ? { type: "sort", buckets: assigned as number[] } : null;
  }
  if (q.type === "match") {
    const pairs = Array.from({ length: q.left.length }, (_, i) => d.pairs?.[i] ?? null);
    return pairs.every((r) => r !== null) ? { type: "match", pairs: pairs as number[] } : null;
  }
  if (q.type === "trace") {
    // a pre-filled cell is sent empty; every other cell must be typed
    const cells = q.steps.map((st, r) => q.variables.map((v, c) => (v in st.given ? "" : (d.cells?.[r]?.[c] ?? "").trim())));
    const complete = q.steps.every((st, r) => q.variables.every((v, c) => v in st.given || cells[r]![c] !== ""));
    return complete ? { type: "trace", cells } : null;
  }
  if (q.type === "spot") return d.lines?.length ? { type: "spot", lines: [...d.lines].sort((a, b) => a - b) } : null;
  if (q.type === "hotspot") return d.points?.length ? { type: "hotspot", points: d.points } : null;
  const text = d.text.trim();
  return text ? { type: q.type, text } : null;
}

export function selectOption(d: Draft, index: number, multiple: boolean): Draft {
  if (!multiple) return { ...d, selected: [index] };
  return { ...d, selected: d.selected.includes(index) ? d.selected.filter((i) => i !== index) : [...d.selected, index] };
}

// ---------- answer state machine (one quiz run) ----------

export interface RunnerState {
  index: number;
  drafts: Record<string, Draft>;
  /** Result of each submitted question; its presence locks the question. */
  results: Record<string, AnswerResult>;
  checking: boolean;
  error: string | null;
}

export type RunnerAction =
  | { type: "draft"; qid: string; draft: Draft }
  | { type: "checking" }
  | { type: "checked"; qid: string; result: AnswerResult }
  | { type: "failed"; message: string }
  | { type: "next"; total: number }
  | { type: "reset" };

export const initialRunner: RunnerState = { index: 0, drafts: {}, results: {}, checking: false, error: null };

export function runnerReducer(s: RunnerState, a: RunnerAction): RunnerState {
  switch (a.type) {
    case "draft":
      return s.results[a.qid] || s.checking ? s : { ...s, drafts: { ...s.drafts, [a.qid]: a.draft }, error: null };
    case "checking":
      return s.checking ? s : { ...s, checking: true, error: null };
    case "checked":
      return { ...s, checking: false, error: null, results: { ...s.results, [a.qid]: a.result } };
    case "failed":
      return { ...s, checking: false, error: a.message };
    case "next":
      return { ...s, index: Math.min(s.index + 1, a.total - 1), error: null };
    case "reset":
      return initialRunner;
  }
}

export type Stage = "answering" | "checking" | "answered";

export function stageOf(s: RunnerState, qid: string): Stage {
  return s.results[qid] ? "answered" : s.checking ? "checking" : "answering";
}

// a self-mark beats a stale "grading" from the poll, and an AI grade beats the self-mark
const RANK: Record<AnswerResult["state"], number> = { grading: 1, failed: 2, self: 2, recorded: 3, scored: 3, graded: 3 };

/** The polled attempt knows a graded answer before the local copy does; never go back from graded to grading. */
export function mergeResult(local: AnswerResult | undefined, remote: AnswerResult | undefined): AnswerResult | undefined {
  if (!local) return remote;
  if (!remote) return local;
  return RANK[remote.state] >= RANK[local.state] ? remote : local;
}

// ---------- scoring display ----------

const num = (n: number) => String(Number(n.toFixed(2)));

export const pointsLabel = (m: Marks) => `${num(m.got)} / ${num(m.max)} POINTS`;

export interface Pill {
  tone: BadgeTone;
  label: string;
  mono: boolean;
}

/** The status pill in a question header; null before anything is submitted. */
export function answerPill(r: AnswerResult | undefined): Pill | null {
  if (!r) return null;
  switch (r.state) {
    case "grading":
      return { tone: "warn", label: "Grading…", mono: false };
    case "failed":
      return { tone: "bad", label: "Grading failed", mono: false };
    case "recorded":
      return { tone: "neutral", label: "Answer recorded", mono: false };
    case "self":
      return r.selfMark === "got"
        ? { tone: "ok", label: "Self-marked · got it", mono: false }
        : r.selfMark === "partly"
          ? { tone: "warn", label: "Self-marked · partly", mono: false }
          : { tone: "bad", label: "Self-marked · missed", mono: false };
    case "graded": {
      const m = r.feedback?.marks ?? r.marks;
      if (!m) return { tone: "neutral", label: "Graded", mono: false };
      const ratio = m.max > 0 ? m.got / m.max : 0;
      return { tone: ratio >= 0.5 ? "ok" : ratio > 0 ? "warn" : "bad", label: pointsLabel(m), mono: true };
    }
    case "scored":
      if (r.correct) return { tone: "ok", label: "Correct", mono: false };
      return r.marks && r.marks.got > 0 && r.marks.got < r.marks.max ? { tone: "warn", label: "Partly correct", mono: false } : { tone: "bad", label: "Incorrect", mono: false };
  }
}

/** Live-region text for screen readers (colour is never the only signal). */
export function announcement(r: AnswerResult | undefined): string {
  const p = answerPill(r);
  if (!p) return "";
  if (r?.state === "grading") return "Answer submitted. Grading in progress.";
  return p.mono ? `Graded: ${p.label.toLowerCase()}` : p.label;
}

/** An open answer the learner can mark against the rubric: AI is paused, its grade failed, or it is already self-marked. */
export const canSelfCheck = (r: AnswerResult | undefined, aiPaused: boolean): boolean =>
  !!r?.rubric && ((r.state === "grading" && aiPaused) || r.state === "failed" || r.state === "self");

/** The pill while an answer waits for the learner's own mark (nothing is grading it). */
export const AWAITING_SELF_MARK: Pill = { tone: "warn", label: "Mark it yourself", mono: false };

export const isFinished =(r: AnswerResult | undefined) => !!r && r.state !== "grading";
