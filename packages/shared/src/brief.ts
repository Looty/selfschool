import { DEPTH_OPTIONS, formatDuration, plannedMinutes } from "./time.js";
import { QUESTION_TYPES, QUESTION_TYPE_INFO } from "./questionTypes.js";
import type { OutlineResult } from "./jobs.js";

export interface BriefChapter {
  dir: string;
  title: string;
  level: number;
  lessons: { id: string; title: string }[];
}

export interface BriefInput {
  course: { id: string; title: string; description: string; /** Language the course is written in (default "en"). */ language?: string | undefined };
  /** Existing chapters in reading order, every level. */
  chapters: BriefChapter[];
  quizIds: string[];
  /** Highest source number in use (at least EXTENSION_SOURCE_BASE - 1); new sources continue after it. */
  lastSourceNumber: number;
  weakSpots: { concept: string; percent: number; lesson: string }[];
  /** The approved outline: only the lessons the learner kept. */
  outline: OutlineResult;
  budgetMinutes: number;
  seed: { topic?: string | undefined; question?: string | undefined };
}

const fence = (lang: string, body: string) => "```" + lang + "\n" + body.trim() + "\n```";

const LESSON_TEMPLATE = `---
id: x01                       # starts with x, unique, stable forever
title: Lesson title
quiz: quiz-01.yaml            # file name relative to this chapter dir
sources: [101]                # numbers from the extension's sources.md (101 and up), or \`none\`
---
One or two sentences stating what the learner can do after this lesson.

## Section heading

Every factual claim ends with its source number. [101]

:::low-confidence
Use this block when a claim is uncertain, version-dependent or from a weak source. Say what is
uncertain and where to check. Cite the source. [102]
:::

:::key-takeaways
- One-line takeaway.
:::

:::glossary
- **Term**: its plain meaning in one everyday sentence.
:::`;

const QUIZ_TEMPLATE = `schemaVersion: 1
id: xq01                         # starts with x, unique, stable
title: "Check: lesson topic"
max_attempts: 0                  # 0 = unlimited
passing_percentage: 70
show_answers: true
shuffle: false
questions:
  - id: xq01-1                   # starts with x, unique, never renumbered
    type: mcq                    # mcq | short | open | fill | sort | spot | hotspot | match | trace
    text: "Which line is a type error?"
    concepts: [const, assignment]   # kebab-case; quote words YAML reads as non-strings: "null", "yes", "no"
    options:                     # 2 to 4 options, at least one correct, EVERY option has an explanation
      - {text: "const n = 5;", correct: false, explanation: "A declaration with an initializer is fine."}
      - {text: "n = 6;", correct: true, explanation: "const bindings cannot be reassigned."}
  - id: xq01-2
    type: short                  # list every acceptable phrasing
    text: "What is the inferred type of \`let x = 'a'\`?"
    answers: ["string"]
    concepts: [inference]
  - id: xq01-3
    type: open                   # graded against the rubric
    text: "Explain structural typing in your own words."
    concepts: [structural-typing]
    rubric: |                    # required; one criterion per line, each worth one point
      - Compatibility is decided by shape, not by declared name.
      - Contrasts with nominal typing.
    sources: [101]
  - id: xq01-4
    type: fill                   # drag chips into numbered slots; a template of only slots is an ordering question
    text: "Complete the function so it returns the first match."
    concepts: [loops]
    template: |
      for (const item of items) {
        {{1}} {
          {{2}}
        }
      }
    chips:                       # one chip per slot (slot: N) plus distractors (no slot); EVERY chip has an explanation
      - {text: "if (test(item))", slot: 1, explanation: "Checks each item against the test."}
      - {text: "return item;", slot: 2, explanation: "Stops at the first match."}
      - {text: "break;", explanation: "Leaves the loop without returning the item."}
  - id: xq01-5
    type: sort                   # drag each item into a group; several items may share a group
    text: "Where does each line fail, if at all?"
    concepts: [type-errors]
    buckets: ["Compile error", "Runtime error", "Fine"]
    items:                       # 2 to 12 items; "bucket" names one of the buckets; EVERY item has an explanation
      - {text: 'const n: number = "5";', bucket: "Compile error", explanation: "A string is not assignable to number."}
      - {text: 'JSON.parse("{")', bucket: "Runtime error", explanation: "It type-checks and throws when it runs."}
  - id: xq01-6
    type: spot                   # click the faulty line(s) of the code
    text: "Which line makes this guard unsafe?"
    concepts: [type-guard]
    code: |
      function isCat(p: Cat | Dog): p is Cat {
        return p.name !== undefined;
      }
    correct: [2]                 # 1-based line numbers
    explanation: "Both types have a name, so the check is true for a dog too."
  - id: xq01-7
    type: hotspot                # click the right place on an image under resources/
    text: "Click the single point of failure."
    concepts: [availability]
    image: resources/architecture.svg
    alt: "Client, one load balancer, two app servers, a database with a replica."
    regions:                     # percent of the image (0-100, from the top left); shapes: rect, ellipse, poly
      - {name: "Load balancer", correct: true, shape: rect, x: 26.5, y: 39.5, w: 19, h: 21, explanation: "Every request passes through it and there is no second copy."}
      - {name: "App servers", shape: rect, x: 54.5, y: 12.5, w: 17.5, h: 75, explanation: "There are two, so one can fail."}
  - id: xq01-8
    type: match                  # connect each left item to its partner on the right
    text: "Match each compiler error to its cause."
    concepts: [compiler-errors]
    pairs:                       # 2 to 8 pairs; EVERY pair has an explanation
      - {left: "TS2322", right: "A value of the wrong type was assigned", explanation: "Type 'string' is not assignable to type 'number'."}
      - {left: "TS2339", right: "A property does not exist on the type", explanation: "Often an unnarrowed union."}
    distractors: ["A module could not be found"]   # optional extra right-hand items that match nothing
  - id: xq01-9
    type: trace                  # fill in what each variable holds after each step
    text: "What does each variable hold after each line runs?"
    concepts: [evaluation-order]
    code: |
      let a = 1;
      let b = a++;
    variables: [a, b]
    steps:                       # one row per step; every variable needs a value; "given" cells are shown pre-filled
      - {label: "line 1", values: {a: 1, b: "not declared"}, given: [b]}
      - {label: "line 2", values: {a: 2, b: 1}}   # a list, [3, "three"], accepts several spellings
    explanation: "a++ yields the old value, then adds one."`;

const SOURCE_TEMPLATE = `101. [Source title](https://example.com/page) · publisher · accessed YYYY-MM-DD · reliability: high
   - Notes: what this source is used for; version or date it applies to.`;

/** The "which question type" guidance, written once in questionTypes.ts and rendered here for the brief. */
const typeGuide = QUESTION_TYPES.map((t) => {
  const i = QUESTION_TYPE_INFO[t];
  return `- **\`${t}\`** (${i.label}${i.instant ? "" : ", graded by the AI runner"}): ${i.does} Use it for: ${i.useFor} Avoid it for: ${i.avoid}`;
}).join("\n");

const nextNumber =(values: string[], pattern: RegExp): number =>
  values.reduce((max, v) => Math.max(max, Number(pattern.exec(v)?.[1] ?? 0)), 0) + 1;

const pad = (n: number) => String(n).padStart(2, "0");
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "") || "chapter";

/** The chapters the brief asks for, with the directory names and ids they should use. */
export function planChapters(input: BriefInput) {
  const lessonNo = nextNumber(input.chapters.flatMap((c) => c.lessons.map((l) => l.id)), /^x(\d+)$/);
  const quizNo = nextNumber(input.quizIds, /^xq(\d+)$/);
  const dirNo = nextNumber(input.chapters.map((c) => c.dir), /^x(\d+)-/);
  const level = input.chapters.reduce((m, c) => Math.max(m, c.level), 1) + 1;
  let lesson = lessonNo;
  return {
    level,
    chapters: input.outline.chapters.map((c, i) => ({
      dir: `x${pad(dirNo + i)}-${slug(c.title)}`,
      title: c.title,
      why: c.why,
      lessons: c.lessons.map((l, li) => {
        const n = lesson++;
        return { ...l, id: `x${pad(n)}`, quizId: `xq${pad(quizNo + n - lessonNo)}`, file: `lesson-${pad(li + 1)}.md`, quizFile: `quiz-${pad(li + 1)}.yaml` };
      }),
    })),
  };
}

/**
 * A self-contained markdown brief: paste it into the Selfschool authoring skill or any LLM that can do deep
 * research. It carries the approved outline and the format rules, so nothing else has to be supplied.
 */
export function buildBrief(input: BriefInput): string {
  const { course, outline } = input;
  const plan = planChapters(input);
  const lessonCount = plan.chapters.reduce((n, c) => n + c.lessons.length, 0);
  const depth = DEPTH_OPTIONS.find((d) => d.minutes === input.budgetMinutes)?.label ?? formatDuration(input.budgetMinutes);
  const nextSource = input.lastSourceNumber + 1;
  const overlay = `extensions/${course.id}/`;
  const asked = input.seed.question ?? input.seed.topic;

  const existing = input.chapters
    .map((c) => `- ${c.dir} · ${c.title}${c.level > 1 ? ` (level ${c.level})` : ""}: ${c.lessons.map((l) => `${l.id} ${l.title}`).join("; ") || "no lessons"}`)
    .join("\n");

  const wanted = plan.chapters
    .map((c) =>
      [
        `### ${c.dir}: ${c.title}`,
        c.why ? `Why: ${c.why}` : "",
        ...c.lessons.map(
          (l) => `- \`${c.dir}/${l.file}\` (id \`${l.id}\`) with \`${c.dir}/${l.quizFile}\` (id \`${l.quizId}\`): **${l.title}**. Objective: ${l.objective}${l.why ? ` Gap it addresses: ${l.why}` : ""}`,
        ),
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n");

  const weak = input.weakSpots.length
    ? input.weakSpots.map((w) => `- ${w.concept}: ${w.percent}% (lesson: ${w.lesson})`).join("\n")
    : "- None recorded yet.";

  return `# Extend the course "${course.title}"

You are writing new chapters for an existing Selfschool course, as plain files. Do real research first: use web search and prefer primary sources (official docs, specs, standards, papers). Only cite sources you actually read, and never invent a source, URL, author or quote. If a topic has no good source, say so in the lesson instead of filling the gap from memory.

## What to build

- Course id: \`${course.id}\`. Write everything into the extensions folder \`${overlay}\`, never into the course package (\`courses/${course.id}/\`), which belongs to its author and is never edited.
${course.language && course.language !== "en" ? `- Language: write all lesson and quiz text in the course's language (\`${course.language}\`). Code, ids, file names and YAML keys stay in English.\n` : ""}- Title of the new level: **${outline.title}**
- Depth: about ${depth} of learner time (${lessonCount} ${lessonCount === 1 ? "lesson" : "lessons"}, planned at roughly ${formatDuration(plannedMinutes(lessonCount))}). Treat this as a guide: write each lesson properly rather than hitting the number exactly.
${asked ? `- The learner asked about: "${asked}"\n` : ""}
Why this was proposed (written to the learner, so "you" below means them):
> ${outline.rationale.replace(/\n+/g, " ")}

## Approved outline (the learner already approved this; do not add or drop lessons)

${wanted}

Directory names, file names, lesson ids and quiz ids above are assigned for you. Use them exactly. Question ids are the quiz id plus a number: \`xq01-1\`, \`xq01-2\`, ... In each lesson's frontmatter, \`quiz:\` is the quiz file name relative to the chapter directory.

## Weak spots to address

${weak}

## What already exists (do not repeat it and never edit it)

${existing}

Existing quiz ids: ${input.quizIds.join(", ") || "none"}.

## Files to produce (all inside \`${overlay}\`)

1. \`${overlay}extension.yaml\`. Create it, or if it exists add these entries to its \`chapters:\` list:
${fence("yaml", `schemaVersion: 1\nchapters:\n${plan.chapters.map((c) => `  - dir: ${c.dir}\n    title: ${c.title}\n    level: ${plan.level}\n    origin: researched`).join("\n")}`)}
2. The lesson and quiz files listed in the outline above, in those chapter folders.
3. \`${overlay}sources.md\`: the extension's own source list, in the same format as the course's. Create it if missing; number yours from ${nextSource} (${nextSource}, ${nextSource + 1}, ...) and never renumber. These are separate from the course's own sources, so cite only these numbers.
4. Do not touch anything under \`courses/\`.

## Choosing a question type

Match the type to what the lesson teaches, and mix types within a quiz rather than defaulting to multiple choice. Every type except open-ended is scored instantly in the app.

${typeGuide}

## Rules

- **Sources.** Every factual claim ends with an inline \`[n]\` that refers to the extension's \`sources.md\`. The lesson's \`sources\` frontmatter lists exactly the numbers used, or \`none\`. Never cite a number for a claim the source does not support.
- **Learner-neutral text.** Lessons and quizzes are shareable, so never mention the learner's scores, weak spots or history in them. The weak spots above only decide what to cover.
- **Low confidence.** If a claim is uncertain, version-dependent or weakly sourced, put it in a \`:::low-confidence\` block saying what is uncertain and where to check. Do not smooth it over.
- **Ids are permanent and unique.** Lesson, quiz and question ids all start with \`x\`; anything else is skipped when the extension is loaded. Chapter folders keep the assigned \`x\` names.
- **MCQ.** 2 to 4 options, at least one correct, and EVERY option (right and wrong) has an \`explanation\`. Distractors must be plausible and wrong for a stated reason.
- **Open questions** need a \`rubric\` (one checkable criterion per line, each worth one point) and \`sources\`. End each quiz with at least one \`open\` question when the lesson teaches a concept rather than a fact.
- **Short answers** list every acceptable phrasing in \`answers\`.
- **Fill** (drag chips into slots): use for completing code or a definition, or, with a template of only slots, for putting steps in order. 1 to 6 slots written \`{{1}}\`, \`{{2}}\`, ... in order, exactly one chip per slot, and one or two plausible distractors. EVERY chip has an \`explanation\`; a distractor says why it is wrong. Keep chips short.
- **Sort** (drag items into groups): 2 to 6 \`buckets\` and 2 to 12 \`items\`, each naming its \`bucket\` and carrying an \`explanation\`. Use it for classifying (error type, which layer, true or false by category). Several items may share a bucket.
- **Spot** (click the faulty line): \`code\` plus \`correct\`, the 1-based line numbers, and one \`explanation\` of why those lines. Use it for finding a bug or the line that does something. Set \`diff: true\` and write \`code\` as a diff (added lines start with \`+\`, removed with \`-\`, context with a space) to ask for a code review; use a block scalar with an indent indicator (\`code: |2\`) so leading spaces survive.
- **Match** (connect pairs): 2 to 8 \`pairs\`, each \`left\`, \`right\` and an \`explanation\`; up to 4 \`distractors\` that belong to nothing. Use it for term and definition, error and cause, tool and purpose. It must be one-to-one, so use \`sort\` when several items share a category.
- **Trace** (fill in the state): \`code\`, the \`variables\` (1 to 5) and up to 8 \`steps\`. Each step gives every variable's value, as text or a number (quote words YAML reads as other types: \`"null"\`, \`"yes"\`). Mark easy cells \`given\` so the learner fills only the interesting ones, list alternative spellings as an array, and explain the result once in \`explanation\`. Use it for evaluation order, scope and state changes. Values are compared as written, ignoring spacing and quote style but not case.
- **Hotspot** (click a place on an image): \`image\` is a file in \`resources/\` (svg, png, jpg, gif, webp) with meaningful \`alt\`. \`regions\` mark where the answer is in percent of the image, as \`rect\` (x, y, w, h), \`ellipse\` (x, y, rx, ry) or \`poly\` (points). At least one region is \`correct\`; more than one means the learner places that many markers. Add decoy regions, each with an explanation of why it is wrong. Measure coordinates on the real image and say nothing in the question text that gives the location away.
- **Plain words.** Write for someone smart who is new to the field. Define technical terms in everyday words the first time they appear and give a small analogy or example for each new concept.
- **Research depth.** Read the primary sources (papers, specifications, official docs) in full, not only their abstracts, and cite roughly one source per lesson. Mark each source in \`sources.md\` with how much you read (\`read: full\`, \`partly\` or \`abstract only\`), and never claim more than that. Copy every number from the text you read.
- **Prerequisites.** Do not rely on an idea the course has not taught yet; if one is unavoidable, add a one-sentence forward note ("explained in a later chapter; for now, treat it as ...").
- **Glossary.** End every lesson, after \`:::key-takeaways\`, with a \`:::glossary\` block: one \`- **Term**: plain meaning\` line per piece of jargon, acronym or tool name the lesson uses (3 to 10), each one sentence in everyday words with no \`[n]\`.
- **Concepts.** Tag every question with \`concepts\` (kebab-case, reuse the existing names where they fit).
- **Length.** Lessons are 400 to 900 words, with code where relevant. Images need meaningful alt text; links are relative and must resolve.
- No marketing tone, no filler intros, no claims about what the learner "will master".

## Templates

Lesson (the ids, numbers and file names in the examples are placeholders; use the ones assigned above):
${fence("markdown", LESSON_TEMPLATE)}

Quiz:
${fence("yaml", QUIZ_TEMPLATE)}

Entry in \`sources.md\`:
${fence("markdown", SOURCE_TEMPLATE)}

## Before you finish

If you can run commands, run \`school validate ${overlay.slice(0, -1)}\` and fix every issue it reports. Otherwise self-check by hand: ids are unique and start with \`x\`, every referenced file exists, every option has an explanation, every open question has a rubric, every lesson has \`sources\`, source numbers exist in the extension's \`sources.md\`, relative links resolve. Then reply with two sentences: what you wrote, and anything weakly sourced or skipped.
`;
}
