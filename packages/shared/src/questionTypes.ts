import type { QuestionType } from "./course.js";

export interface QuestionTypeInfo {
  /** Short name shown to authors and in docs. */
  label: string;
  /** One line: what the learner does. */
  does: string;
  /** Where this type is the right choice. */
  useFor: string;
  /** Where another type fits better. */
  avoid: string;
  /** Scored instantly in the app; `open` waits for the AI runner. */
  instant: boolean;
}

/**
 * Static guidance for choosing a question type. Authors read it in the brief and the skill; the schemas in
 * course.ts point here. `satisfies Record<QuestionType, ...>` makes a new type fail to compile until it is described.
 */
export const QUESTION_TYPE_INFO = {
  mcq: {
    label: "Multiple choice",
    does: "Picks one option, or every option that applies when more than one is correct.",
    useFor: "Recognising the right fact, definition or outcome among plausible alternatives. Strongest when each wrong option is a real misconception, because every option carries an explanation.",
    avoid: "Options that give the answer away, or recall that should not be prompted (use short or open).",
    instant: true,
  },
  short: {
    label: "Short answer",
    does: "Types a short answer that is matched loosely against the accepted phrasings.",
    useFor: "Recalling one exact term, name, keyword or value where the wording hardly varies: which operator, what a call returns, what a command is called.",
    avoid: "Answers that can be phrased many valid ways (use open) and numbers that need a tolerance (use mcq).",
    instant: true,
  },
  open: {
    label: "Open-ended",
    does: "Writes an answer in their own words, graded by the AI runner against a rubric.",
    useFor: "Explaining, comparing, justifying or applying an idea, where understanding shows in the reasoning. The only type that needs the runner, so the result arrives a moment later.",
    avoid: "Facts with one right answer, which any instant type grades better and for free.",
    instant: false,
  },
  fill: {
    label: "Fill the gaps",
    does: "Drags chips into numbered slots of a code or text template; a template of only slots is an ordering question.",
    useFor: "Completing code, a sentence or a definition from a bank that includes distractors, and putting the steps of a process in order.",
    avoid: "More than about six slots, free-form answers, and sorting items into categories (use sort).",
    instant: true,
  },
  sort: {
    label: "Sort into groups",
    does: "Drags each item into the group it belongs to; several items may share a group.",
    useFor: "Classifying many items into a few categories: compile error or runtime error, which layer, valid or invalid, true or false by topic.",
    avoid: "One-to-one pairings (use match) and a fixed sequence (use fill as an ordering).",
    instant: true,
  },
  spot: {
    label: "Spot the line",
    does: "Clicks the line or lines of code that answer the question; can show the code as a diff.",
    useFor: "Finding the faulty or relevant line in code, and reviewing a change: the line with the bug, the unsafe cast, the missing check.",
    avoid: "Answers that are not tied to specific lines.",
    instant: true,
  },
  hotspot: {
    label: "Click the image",
    does: "Places one or more markers on a picture, checked against hidden regions.",
    useFor: "Locating something on a visual: a component in an architecture diagram, a control in a screenshot, a feature on a chart or map. Add decoy regions to explain common wrong picks.",
    avoid: "Questions where the picture is decoration and the answer is a fact (use mcq).",
    instant: true,
  },
  match: {
    label: "Match the pairs",
    does: "Connects each left item to its partner on the right; extra right-hand items match nothing.",
    useFor: "One-to-one relationships: term and definition, error and cause, tool and purpose, cause and effect.",
    avoid: "Many items sharing a category (use sort).",
    instant: true,
  },
  trace: {
    label: "Trace the code",
    does: "Fills in what each variable holds after each step of some code; some cells can be given.",
    useFor: "Predicting how state changes step by step: evaluation order, scope, loops, mutation, state machines. Each cell is graded on its own and instantly.",
    avoid: "A single final value (use short or mcq).",
    instant: true,
  },
} as const satisfies Record<QuestionType, QuestionTypeInfo>;

/** Every question type, in the order the docs present them. */
export const QUESTION_TYPES = Object.keys(QUESTION_TYPE_INFO) as QuestionType[];
