import type { AnswerInput, AnswerResult, LearnerQuestion } from "@selfschool/shared";

/**
 * Multiple-choice options are shown in a shuffled order, while the server keeps addressing them by their
 * authored position (grading, stored answers, the answer key). This is the translation between the two:
 * `order[shown] = authored`. The order is seeded, so the same seed and question always give the same order:
 * a refetch or a reload of the same sitting never moves an option, and a new seed (a retake) reshuffles.
 */
export function optionOrder(seed: string, questionId: string, count: number): number[] {
  return Array.from({ length: count }, (_, i) => i).sort((a, b) => hash(`${seed}:${questionId}:${a}`) - hash(`${seed}:${questionId}:${b}`) || a - b);
}

/** A fresh seed for one quiz run. */
export const newSeed = () => Math.random().toString(36).slice(2);

/** Converts between what the learner sees (shuffled) and what the api speaks (authored order) for one sitting. */
export function optionShuffler(seed: string) {
  const orderOf = (q: { id: string }, count: number) => optionOrder(seed, q.id, count);
  return {
    /** The question as shown: MCQ options in shuffled order; other types unchanged. */
    question(q: LearnerQuestion): LearnerQuestion {
      if (q.type !== "mcq") return q;
      return { ...q, options: orderOf(q, q.options.length).map((i) => q.options[i]!) };
    },
    /** An answer about to be sent: shown positions become authored positions. */
    input(q: LearnerQuestion, input: AnswerInput): AnswerInput {
      if (q.type !== "mcq" || input.type !== "mcq") return input;
      const order = orderOf(q, q.options.length);
      return { type: "mcq", selected: input.selected.map((shown) => order[shown]!).sort((a, b) => a - b) };
    },
    /** A result from the api: its revealed options (authored order) put back in the order they were shown. */
    result<R extends AnswerResult | undefined>(q: LearnerQuestion, r: R): R {
      if (q.type !== "mcq" || !r?.options) return r;
      const options = r.options;
      return { ...r, options: orderOf(q, options.length).map((i) => options[i]!) };
    },
  };
}

export type OptionShuffler = ReturnType<typeof optionShuffler>;

/**
 * FNV-1a plus murmur3's final mix (keys differ only in their last character, which plain FNV spreads poorly).
 * Small and stable across browsers; only used to order options, never for security.
 */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}
