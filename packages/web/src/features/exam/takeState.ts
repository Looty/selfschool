import type { LearnerQuestion } from "@selfschool/shared";
import { EMPTY_DRAFT, toInput, type Draft } from "../quiz/state";

/** State of one exam sitting. Question order is whatever the frozen instance says (shuffled server-side). */
export interface TakeState {
  index: number;
  drafts: Record<string, Draft>;
  /** Serialized input last accepted by the api, per question id. */
  saved: Record<string, string>;
  flagged: string[];
}

export const initialTake: TakeState = { index: 0, drafts: {}, saved: {}, flagged: [] };

export type TakeAction =
  | { type: "draft"; qid: string; draft: Draft }
  | { type: "go"; index: number; total: number }
  | { type: "saved"; qid: string; key: string }
  | { type: "flag"; qid: string }
  | { type: "restore"; state: TakeState };

export function takeReducer(s: TakeState, a: TakeAction): TakeState {
  switch (a.type) {
    case "draft":
      return { ...s, drafts: { ...s.drafts, [a.qid]: a.draft } };
    case "go":
      return { ...s, index: Math.max(0, Math.min(a.index, a.total - 1)) };
    case "saved":
      return { ...s, saved: { ...s.saved, [a.qid]: a.key } };
    case "flag":
      return { ...s, flagged: s.flagged.includes(a.qid) ? s.flagged.filter((id) => id !== a.qid) : [...s.flagged, a.qid] };
    case "restore":
      return a.state;
  }
}

export const draftOf = (s: TakeState, q: LearnerQuestion): Draft => s.drafts[q.id] ?? EMPTY_DRAFT;

export const inputKey = (q: LearnerQuestion, d: Draft): string => JSON.stringify(toInput(q, d));

export const isAnswered = (q: LearnerQuestion, s: TakeState) => toInput(q, draftOf(s, q)) !== null;

/** Questions whose current input has not been accepted by the api yet. */
export function dirtyQuestions(qs: LearnerQuestion[], s: TakeState): LearnerQuestion[] {
  return qs.filter((q) => isAnswered(q, s) && s.saved[q.id] !== inputKey(q, draftOf(s, q)));
}

export interface TakeSummary {
  answered: number;
  unanswered: number;
  flagged: number;
  /** 0-based positions of unanswered questions, in instance order. */
  unansweredAt: number[];
}

export function summarize(qs: LearnerQuestion[], s: TakeState): TakeSummary {
  const unansweredAt = qs.flatMap((q, i) => (isAnswered(q, s) ? [] : [i]));
  return {
    answered: qs.length - unansweredAt.length,
    unanswered: unansweredAt.length,
    flagged: qs.filter((q) => s.flagged.includes(q.id)).length,
    unansweredAt,
  };
}

/** Accessible name of a navigator cell: state in words, never colour alone. */
export function navLabel(position: number, q: LearnerQuestion, s: TakeState): string {
  const parts = [`Question ${position + 1}`, isAnswered(q, s) ? "answered" : "not answered"];
  if (s.flagged.includes(q.id)) parts.push("flagged for review");
  return parts.join(", ");
}

// ---------- local persistence (the api has no "read my draft" endpoint) ----------

const storageKey = (instanceId: string) => `selfschool:exam-draft:${instanceId}`;

export function loadTake(instanceId: string, store: Pick<Storage, "getItem"> | undefined = safeStorage()): TakeState {
  try {
    const raw = store?.getItem(storageKey(instanceId));
    if (!raw) return initialTake;
    const p = JSON.parse(raw) as Partial<TakeState>;
    return {
      index: typeof p.index === "number" ? p.index : 0,
      drafts: p.drafts && typeof p.drafts === "object" ? p.drafts : {},
      saved: p.saved && typeof p.saved === "object" ? p.saved : {},
      flagged: Array.isArray(p.flagged) ? p.flagged : [],
    };
  } catch {
    return initialTake;
  }
}

export function saveTake(instanceId: string, s: TakeState, store: Pick<Storage, "setItem"> | undefined = safeStorage()): void {
  try {
    store?.setItem(storageKey(instanceId), JSON.stringify(s));
  } catch {
    /* private mode or full: the sitting still works, it just cannot be restored */
  }
}

export function clearTake(instanceId: string, store: Pick<Storage, "removeItem"> | undefined = safeStorage()): void {
  try {
    store?.removeItem(storageKey(instanceId));
  } catch {
    /* ignore */
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}
