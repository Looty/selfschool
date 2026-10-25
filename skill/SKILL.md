---
name: selfschool-course
description: Author a complete Selfschool course (course.yaml, sources.md, lesson markdown, quiz and exam YAML) from a "teach me X" request, with every fact researched on the live web and cited. Also extends an existing course with new chapters. Use for a new course, a study guide for a certification, or "go deeper" on a course; the result is plain files the Selfschool web app opens directly. Works in any coding agent or chat product that can read and write files.
---

# selfschool-course

Turns "teach me X" into a course package: plain files in `courses/<id>/` that the Selfschool app reads directly, with no import step. This file is the whole format reference; `templates/` beside it holds a starter for every file type (`course.yaml`, `sources.md`, `lesson.md`, `lab-lesson.md`, `quiz.yaml`, `question-types.yaml`, `exam.yaml`). Copy a template, then fill it in.

## Before you start

This skill is written for any model and any product, so it names capabilities, not tools. Use whatever your environment calls them.

| Capability | Needed for | If you do not have it |
| --- | --- | --- |
| Write files | Everything | Print each file in full, with its path as a heading, and tell the user to save them |
| Read files | Extension mode, templates | Ask the user to paste what you need |
| Web search and page fetch | Research (step 3) | Say so before the outline; see "No web access" |
| Run a shell command | `school new-id`, `school validate` | Use the manual fallbacks named in steps 2 and 6 |
| Ask the user and wait | The approval gate (step 4) | Ask in your reply and end your turn |
| Spawn helpers | Optional: one helper per chapter, after approval | Do the chapters one after another |

The `school` command is run from the Selfschool repository root as `pnpm school <command>` (it needs `pnpm build` once), or as plain `school` if it is linked on PATH. Below, `school ...` means either form.

Where files go: everything is written locally, and nothing is uploaded anywhere. The output is one folder, `<id>/`, holding every file of the course.
- The courses live in their own folder, normally the `selfschool-courses` repository next to the app (`../selfschool-courses`, or whatever `COURSES_PATH` in the app's `.env` points to). Each course is `<id>/` at the top of that folder. If the current directory is that repository (it holds other `<id>/` folders with a `course.yaml` each), write `<id>/` here. If it is the Selfschool app repository (a `plan.md` next to `packages/`), write to the courses folder from `.env`, not into the app. Below, `courses/<id>` means `<id>/` inside that folder. The app reads it directly.
- Anywhere else: write `<id>/` in the current working directory. The user then moves it into the courses folder, which is where the app (running in Docker) can see it; a folder elsewhere on the machine is not visible to the app.
- If the user wants one file to move or share, also zip the folder as `<id>.zip` next to it (`zip -r`, `tar -a -cf` or PowerShell `Compress-Archive`, whichever exists). The app reads folders, not zips, so the zip must be unpacked before use.
- With no file access, print every file in full under its path (`<id>/course.yaml`, ...) and say that you could not write them.

Rules that hold on every model:

- Never leave a placeholder, `TODO`, `...` or "similar to above" in a file. Every file is complete.
- Never invent a source, URL, quote, number, version or API. If you did not read it this session, it is not a fact in the course.
- Do not skip the approval gate, and do not carry on after it without an explicit yes.
- Work in small steps: one file at a time, one chapter at a time. A long single output is where mistakes creep in.

## Flow

### 1. Clarify (one short round)

Ask at most 4 questions in one message and skip any the user already answered:
- Subject and goal (hobby, job, a certification with an exam guide?)
- Learner level and prerequisites
- Depth: chapters, rough lesson count, lesson length (a hint in learner minutes: 15 min, 1 h, 4 h, 12 h or more)
- Mid or final exams wanted? For a certification, which official exam guide to mirror?

- Prerequisites: what does the learner already know? Name the ideas the course will lean on that it does not teach (for example "what a model is"). Either teach them first or give them a "New to X?" primer (see Content rules).

If the request already answers these, go straight to step 2.

### 2. Course id

Run `school new-id "<course title>"` and use its output (for example `python-basics-k3x9f2`) as `<id>`: the folder name and the `id:` in `course.yaml`. Progress is stored per course id, so it must be unique across the user's own courses and imported ones, and it never changes after the first publish. Never type an id by hand. Without the command, make it yourself: the title in lowercase kebab-case, a dash, then 6 random lowercase letters or digits.

### 3. Research (fetch, read, do not recall)

Research is where a course is won or lost. The standard to meet: **every lesson stands on sources you read in depth, and the primary ones (the paper, the standard, the specification, the official documentation) are read in full, not only their abstract or a summary.** A course built from abstracts and an encyclopedia reads fine and is thin underneath.

**How much to read.** Plan the amount from the size of the course, then read at least that much before the outline:

| Course size | Sources to read (at least) | Of which primary, read in full |
| --- | --- | --- |
| About 15 minutes, one chapter | 5 | 2 |
| About 1 hour, 4 to 6 lessons | 10 | 4 |
| About 4 hours | 25 | 10 |
| About 12 hours, or a certification | 60 to 75 (about one per lesson) | 25 or more |

If the budget is larger, scale it up; do not stop early because the first few sources looked sufficient. A topic that has a founding paper, a standard or a spec must have that document in the list, read in full.

**Steps.**
1. **Map the subject.** List the chapters you expect, and for each one the primary documents that define its facts: the original papers, the specification or standard, the current exam guide, the official docs, a recognised textbook or syllabus, and the recent changes (versions, deprecations). Write 5 to 10 queries per major area, not per course.
2. **Find and fetch.** Search, then open the actual documents. Prefer the primary source over any summary of it. Use secondary sources (encyclopedias, tutorials, blogs) to find the primary ones, not as the evidence.
3. **Read in full.** For a PDF, a fetch tool may return binary or a short summary. Save the file and extract its text locally (for example `pypdf` in a throwaway environment, or `pdftotext`), then read the sections you will teach from: definitions, the method, the numbers and tables, the limitations. Scanned PDFs have no text layer: say so and look for another copy (a publisher HTML version, a preprint, a mirror). If you can only read an abstract, mark the source `read: abstract only` and keep claims from it to what the abstract says.
4. **Check the numbers.** Copy every figure, version, name, formula and date you will use from the text you read, with the section or table it came from, into your working notes. Do not round, do not reconstruct from memory.
5. **Look for the second opinion.** For each chapter find at least one source that disagrees, extends or corrects the main one (a follow-up paper, a critique, a newer version). Say in the lesson where sources differ.
6. **Write `courses/<id>/sources.md`** from `templates/sources.md`, numbering sources 1..N. Add them as you go; never renumber.

If your environment can run helpers in parallel, research chapters in parallel, one helper per chapter or area, each returning verified facts with their sources; keep the numbering and the final sources.md in one place.

Rules:
- Every fact, number, version, name, date, command, price or exam weighting in a lesson or question comes from a page you opened this session. Model memory is for structure and explanation only; it is out of date.
- List only sources you actually read. Give each its `accessed` date, `reliability: high|medium|low` (and why when not high), and `read:` how much you read: `full`, `partly (which sections)` or `abstract only`. Lessons never claim more than the `read:` level supports.
- A claim you could not verify goes in a `:::low-confidence` block that says what was not checked. That block is for genuine gaps; if a gap can be closed by reading one more document, read it instead.
- If a topic has no good source, say so in the outline. Do not fill the gap from memory.
- For a certification, fetch the current official exam guide and mirror its domain names and weights.
- When a source is a secondary one (encyclopedia, blog, tutorial), say so in its Notes and prefer to replace it later with the primary document it points to.

**Before the outline** report the research in one line each: how many sources, how many primary, how many read in full, and which topics rest on weak ones. If the totals are below the table above, keep researching.

**No web access.** Tell the user before the outline. If they still want the course, write every lesson with `sources: none` and a `:::low-confidence` block saying it comes from model knowledge and must be checked.

### 4. Outline (HARD approval gate)

Show in chat, and write no lesson, quiz or exam yet:
- Chapters, each with its lessons (title plus a one-line objective) and which lessons get a quiz
- A prerequisite map: for each chapter, the earlier chapter that teaches what it assumes; any chapter that needs an idea taught later gets reordered, or a primer
- Which lessons are hands-on, and the runnable files each will ship (see "Practical files")
- Exams as blueprints: duration, passing %, `limit_questions`, `max_attempts`, and domain weights summing to 100
- Sources found, and topics with weak or missing sources

Then stop and ask for approval. If the user asks for changes, revise and ask again; an earlier "yes" does not cover a changed outline.

### 5. Generate files

```
courses/<id>/
  course.yaml  sources.md
  01-<chapter>/  lesson-01.md  quiz-01.yaml  lesson-02.md ...
  resources/
  exams/  mid.yaml  final.yaml
```

Order: `course.yaml` first, listing every approved chapter; then per chapter its lessons, then its quizzes; exams last. After each chapter, report progress in one line and continue.

Every exam listed under `exams:` in `course.yaml` needs its file (copy `templates/exam.yaml`, one per exam, with a matching `id`); remove the example `mid` and `final` entries from the template if the user wants no exams. Optionally set `budget_minutes` in `course.yaml` to the depth the user asked for.

The first paragraph of a lesson is shown as its intro: one or two plain sentences with no heading, saying what the learner can do afterwards.

**Images.** A lesson or `hotspot` image must be a real file in `resources/`. Draw diagrams yourself as a small SVG text file, with an obvious shape per labelled part so coordinates are easy to measure; never reference a file you did not create or download. If you cannot produce an image, skip `hotspot` and use `mcq` or `match` instead.

For each lesson, in this order:
1. Look at the sources you fetched for it and note the facts you will use.
2. Write the lesson from `templates/lesson.md`, citing `[n]` after each factual sentence.
3. Write its quiz from `templates/quiz.yaml` and `templates/question-types.yaml`.
4. Re-read both files against the rules below before moving on.

#### Prerequisites (never use a word before it is taught)

A learner reads lessons in order and cannot ask. A lesson that leans on an idea taught later, or never, feels like needing a second course.
- **Order.** Teach an idea before any lesson depends on it. If a chapter must mention something taught later, say so in one sentence at the point of use ("explained in chapter 4; for now, treat it as ...") and keep the dependence shallow.
- **Primer.** The first lesson of a course for newcomers gets a short "New to <field>? The 60-second version" section (plain markdown, 80 to 150 words) defining the handful of base words the rest of the course uses. A chapter that builds on a different field (for example an LLM chapter in an MLOps course) gets a short "<Topic> basics in plain words" section the same way.
- **Check.** After drafting a chapter, list every term a newcomer might not know. Each must be defined where first used, covered by the lesson's glossary, or have a forward note.

#### Practical files

Theory-only chapters are fine early, but a course that promises skills needs hands-on material, and "copy this from the page" is not enough.
- Every lab, capstone or exercise lesson ships runnable files in `resources/` and lists them in its frontmatter `resources:`: scripts, a script that generates its sample data, configuration files. Prefer data bundled with a library or generated by a script over a download that may disappear.
- **Run them before you publish.** Install the dependencies in a clean environment, run each script, and put what you saw (a number, a file created) in the lesson so the learner can compare. If the environment cannot run code, say so in a `:::low-confidence` block and do not claim the files were tested.
- Pin or name any version that broke in testing (for example "pandas below 2.3").
- Give each lab a "Shortcut" section with the exact setup and run commands, and keep the step-by-step explanation after it.
- `school validate` warns about a lab/capstone/exercise lesson with no resources and about a lesson with no glossary.

#### Content rules

- **Sources.** Every factual claim ends with an inline `[n]` that refers to `sources.md`. The lesson frontmatter `sources` lists exactly the numbers used, or `none` for a lesson with no factual claims. Never cite a number for a claim the source does not support.
- **Low confidence.** If a claim is uncertain, version-dependent or weakly sourced, put it in a `:::low-confidence` block saying what is uncertain and where to check. Do not smooth it over.
- **Stable ids.** Lesson ids (`l01`, `l02`, ...) are unique across the whole package, not per chapter. Quiz ids (`q01`), question ids (`q01-1`) and exam ids are unique too. Never reuse or renumber an id once it exists; append new ones. Chapter folder names are permanent.
- **Plain words.** Write for someone smart who is new to the field, not for a journal. Define a technical term the first time it appears, in the same sentence, in everyday words; prefer the short common word over the academic one; give a small analogy or concrete example for each new concept.
- **Glossary.** End every lesson, after `:::key-takeaways`, with a `:::glossary` block: one `- **Term**: plain meaning` line per piece of jargon, acronym or tool name the lesson uses (usually 3 to 10). Each meaning is one sentence in everyday words, with no other undefined jargon, and is not a citation target (no `[n]`). Skip terms everyone knows. Repeat a term in a later lesson if it is needed there. The app does not show the block as a list: it underlines the first use of each term in the lesson text with a dotted line and shows the meaning on hover, so write each term the way it appears in the prose ("LLM (large language model)" covers both forms, and "a / b / c" lines with a matching "x / y / z" meaning are split into one entry each). A term that never appears in the prose is listed under a collapsed "More terms" note.
- **Concepts.** Tag every question with `concepts` (kebab-case, reused consistently); exam domains and regeneration depend on them.
- **Images** need meaningful alt text; links are relative and must resolve; every file in `resources/` is referenced by some lesson.
- **Length.** Lessons are 400 to 900 words, with code where relevant. End a quiz with at least one `open` question when the lesson teaches a concept rather than a fact. 3 to 6 questions per quiz.
- **Tone.** No marketing, no filler intros, no claims about what the learner "will master".
- **Exams** are blueprints, not question lists: `duration_minutes`, `max_attempts`, `shuffle`, `limit_questions`, `passing_percentage`, and `domains` with weights summing to 100. Each domain names the `chapters` (and optionally `concepts`) it draws from.

#### Question rules

Match the type to what the lesson teaches, and mix types within a quiz instead of defaulting to multiple choice. Everything except `open` is scored instantly in the app; `open` waits for the AI runner. Examples of every type are in `templates/question-types.yaml`.

| Type | Use it for | Avoid it for |
| --- | --- | --- |
| `mcq` | Recognising the right fact, definition or outcome among plausible alternatives; strongest when each wrong option is a real misconception | Options that give the answer away; recall that should not be prompted |
| `short` | Recalling one exact term, name, keyword or value where the wording hardly varies | Answers with many valid phrasings (use `open`); numbers that need a tolerance (use `mcq`) |
| `open` | Explaining, comparing, justifying or applying an idea in the learner's own words | Facts with one right answer |
| `fill` | Completing code, a sentence or a definition from a bank with distractors; putting steps in order | More than about six slots; free-form answers; sorting into categories (use `sort`) |
| `sort` | Classifying many items into a few categories (error type, layer, valid or invalid) | One-to-one pairings (use `match`); a fixed sequence (use `fill` as ordering) |
| `spot` | Finding the faulty or relevant line in code, or reviewing a change as a diff | Answers not tied to specific lines |
| `hotspot` | Locating something on a diagram, screenshot, chart or map, with decoy regions | Pictures that are decoration and answers that are facts (use `mcq`) |
| `match` | One-to-one relationships: term and definition, error and cause, tool and purpose | Many items sharing a category (use `sort`) |
| `trace` | Predicting how state changes step by step: evaluation order, scope, loops, mutation | A single final value (use `short` or `mcq`) |

Per-type requirements:

- **mcq**: 2 to 4 options, at least one correct (several correct makes it select-all), and EVERY option, right and wrong, has an `explanation` that says why. Distractors are plausible and wrong for a stated reason.
- **short**: list every acceptable phrasing in `answers`.
- **open**: a `rubric` with one criterion per line, each worth one point and checkable against the answer; add `sources`.
- **fill**: `template` with numbered slots `{{1}}`, `{{2}}`, ... (1 to 6, in order) and `chips`: exactly one chip per slot (`slot: N`) plus one or two distractors (no `slot`), each chip with an `explanation`. A template of only slots is an ordering question.
- **sort**: 2 to 6 `buckets`, 2 to 12 `items`, each with a `bucket` (one of the bucket names) and an `explanation`.
- **spot**: `code`, `correct` (1-based line numbers) and one `explanation`. With `diff: true` the code is a diff (`+` added, `-` removed, a leading space for context); write it as `code: |2` so leading spaces survive.
- **hotspot**: `image` (a file under `resources/`), `alt`, and `regions` in percent of the image (`rect` with x, y, w, h; `ellipse` with x, y, rx, ry; `poly` with points). At least one region is `correct` (more than one asks for that many markers); add decoy regions with their own explanations. Measure coordinates on the real image.
- **match**: 2 to 8 `pairs` (`left`, `right`, `explanation`) and up to 4 `distractors` (right-hand items that match nothing). One-to-one only.
- **trace**: `code`, `variables` (1 to 5), up to 8 `steps` (`label`, `values` for every variable, optional `given` list of pre-filled variables) and one `explanation`. A value may be a list of accepted spellings.

#### YAML pitfalls

- Quote any value that contains `: `, starts with a symbol (`{ [ * & ! | > % @`), or reads as another type: `"yes"`, `"no"`, `"on"`, `"off"`, `"null"`, `"true"`, `"1.10"`.
- Use `|` blocks for code and multi-line text; keep the indentation consistent (2 spaces, no tabs).
- Put code containing quotes in a `|` block rather than in a quoted string.
- After writing a YAML file, re-read it once and check that the indentation and quotes are balanced.

### 6. Validate

Run `school validate courses/<id>` and fix every error until it exits clean. Without the command, check by hand and say the validation was manual:

- [ ] `course.yaml`: `id` matches the folder; every chapter and exam file listed exists
- [ ] Lesson, quiz, question and exam ids are all unique across the package, with no gaps filled by reuse
- [ ] Every lesson has `sources` (numbers that exist in `sources.md`, or `none`) and its inline `[n]` match it
- [ ] Every source in `sources.md` is cited by at least one lesson, and every lesson cites only sources it declares (`school validate` warns about both)
- [ ] The number of sources and how many were read in full meet the table in step 3, and no lesson claims more than its source's `read:` level
- [ ] Every `mcq` option has an `explanation`, and at least one option is correct
- [ ] Every `open` question has a `rubric` and `sources`
- [ ] Every `fill` has one chip per slot; every `spot` line number is inside its `code`; every `trace` step has a value for every variable
- [ ] Every image has alt text, every relative link resolves, every `hotspot` image exists
- [ ] Exam domain weights sum to 100, and each domain's chapters exist
- [ ] Every lesson ends with a `:::glossary`; no lesson uses a term taught only later without a forward note
- [ ] Every lab/capstone lesson lists runnable `resources` that you ran, and says what the learner should see

### 7. Report

Two sentences: what was built (chapters, lessons, quizzes, exams) and the absolute path of the folder (and zip, if made), then anything skipped, weakly sourced or flagged low-confidence. No recap of the process.

## Extending an existing course

Use this mode when the user wants more chapters for a course that already exists, whether they wrote it or pulled it from someone else. Never edit `courses/<id>/`: new chapters go into `extensions/<id>/`, which the app merges after the core chapters as level 2. A package update from its author then cannot overwrite them.

**Start from the brief.** The app's "Copy brief" button produces a self-contained brief with the approved outline, assigned folder names and ids, and the format rules. If the user pastes one, follow it exactly, skip steps 1 and 4 (clarify and the approval gate), and go to research (step 3), generation and validation. Without a brief, run the normal flow, but ask for the course id and the depth, read the existing course first so nothing is repeated, and still stop at the approval gate.

Files, all under `extensions/<id>/`:

```
extension.yaml            schemaVersion: 1, chapters: [{dir, title, level: 2, origin: researched}]
sources.md                the extension's own sources, numbered from 101
x01-<chapter>/            chapter folders named xNN-slug
  lesson-01.md  quiz-01.yaml  ...
resources/                optional, referenced by a lesson
```

Rules that differ from a new course (the loader skips anything that breaks them):

- Lesson, quiz and question ids start with `x` (`x01`, `xq01`, `xq01-1`), continue after the highest existing one, and are never reused or renumbered.
- Source numbers start at 101 and cite only the extension's own `sources.md`; never reuse a number from the course's `sources.md`.
- Chapter folders are named `xNN-slug` and never match a core chapter folder.
- Add to an existing `extension.yaml` instead of replacing it, and raise `level` by one for each later extension (`origin: researched` for work done by this skill).
- Learner-neutral text: never mention the learner's scores, weak spots or progress in a lesson or quiz. Weak spots only decide what to cover, because extensions can be shared.
- Never edit a completed lesson or anything under `courses/`. If new research contradicts an old lesson, tell the user instead of changing it.

Validate with `school validate extensions/<id>`; it checks the folder against `courses/<id>` (ids, chapter folders and source numbers must not collide, ids start with `x`, cited sources exist) and exits 1 on any issue. Without the command, run the step 6 checklist plus these rules by hand and say the validation was manual. The app picks the chapters up on its next load.
