# Selfschool: a personal, AI-native course platform

Supersedes the earlier Frappe-LMS plan (dropped: too much multi-user machinery, and syncing into it was a hack). Written in Claude Code after reading the Frappe LMS source (shallow clone in the session scratchpad) to decide what to keep.

Working style for Claude Code: Sarcasm welcome. Skip basics, go implementation-level. Ask before big structural choices. Don't over-engineer: personal tool, single user, no auth, no multi-tenancy, no load balancing.

---

## 1. What Selfschool is

A local web app that looks like the LMS dashboards people remember (course grid, chapter outline, lesson reader, quizzes) but where Claude is the tutor, grader and course author.

```
 "teach me X"  --(skill, Claude Code)-->  course package (plain files in a git repo)
                                                   |
                          fetch by {url, path, ref} v
 browser  <->  web (React)  <->  api (Hono + SQLite)  <--- long-poll --- runner (host)  --> claude CLI
                                   state, scoring,                       grade / chat / generate
                                   question bank, jobs
```

Content (lessons, sources, rubrics) is git-friendly files. State (progress, attempts, XP, question bank, jobs) is SQLite. They never mix.

## 2. Decisions (made, don't relitigate without a reason)

- **Build, don't host Frappe LMS.** The essential learner UX is ~2k lines; ~60% of LMS code is multi-user/edge-case. No sync layer, no schema hacks. Frappe's layout is the visual reference (dashboard grid, sticky lesson sidebar with check/circle, one-question-at-a-time quiz).
- **Stack:** React + TypeScript (Vite SPA), Hono (Node) API, SQLite (Drizzle), zod schemas shared across packages (they double as the course-format validator). One language end to end. pnpm workspace.
- **Content in git, state in DB.** Courses are packages addressed by `{url, path, ref}`; anyone can share one. User state never goes into git.
- **Docker for dev and run:** `web` and `api` as containers via one compose file.
- **AI runs on the host, not in a container.** No AI CLI baked into any image (can't support N CLIs). A host-side **runner** pulls jobs from `api`. Containers never call the host (no host networking, no `host.docker.internal`).
- **Provider adapters, not per-CLI images.** Contract: prompt on stdin, JSON on stdout, validated by zod. Claude is the only adapter in v1; codex/gemini later = a config entry. Check each CLI's real flags at implementation time, don't trust memory.
- **Async grading.** "Grading..." state in the UI; deterministic scoring is instant.
- **UI direction is approved and specified in [`docs/ui.md`](docs/ui.md)** (tokens, type, per-screen spec, accessibility). Reference prototypes in `docs/ui-reference/`. Key rules: ink primary buttons, indigo accent only for the tutor, one hue per course, hairlines not shadows, no global status chrome (AI runner state shows only as an inline notice where AI is unavailable, and on the Settings page).
- Out of scope: payments, certificates, multi-user, video hosting, proctoring, discussions.

## 3. Architecture

### Services

| Service | Where | Job |
|---|---|---|
| `web` | container | React SPA (nginx static in prod, Vite in dev) |
| `api` | container | Sole owner of the SQLite file (named volume). Course loading/validation, progress, scoring, XP ledger, question bank, jobs table |
| `runner` | **host** (Windows) | Long-polls `api` (`GET /jobs/next`, `POST /jobs/:id/result` on the published localhost port), spawns the AI CLI, validates JSON, posts the result |

### Lifecycle

- `school up`: `docker compose up -d`, then the runner in the foreground. Ctrl+C or `school down` stops the runner and runs `compose down`.
- If the runner is down the app still works: MCQ and short answer are scored locally; AI jobs stay `pending` until it starts.
- **Running code in the browser.** A lesson whose resources include scripts (`.py`, `.js`, `.ts`, ...) shows a **Lab card** right under the standfirst: each script with the command the lesson itself uses (arguments taken from a command block such as `python lab01.py "..."`) and Run and Edit buttons. Run opens a **docked terminal** at the bottom of the lesson page (one sticky stack with the ask box): a tab per file, each keeping its own last run, the command line with editable arguments, the output, input lines and the working folder. Edit opens an **editor drawer** to the right of the lesson and above the terminal (over the lesson on narrow screens): the script with highlighting, line numbers and the lines changed against the original marked; edits change the file in the working folder, so the next Run uses them (Ctrl/Cmd+Enter runs), and Reset restores the original. Drag the drawer's left edge, the terminal's top edge, or the corner where they meet to resize (arrow keys on the edges too, double-click for the default); the sizes are kept in localStorage (`selfschool-lab-size`) and clamped by CSS so the lesson and the page above the terminal keep some room. The lab state (engine, tabs, drawer) lives in a provider around the lesson page, so the terminal and a loaded Python carry over from lesson to lesson. Before offering Run, the app reads each script's imports, following the lesson's own modules (lab08 → minigpt.py → torch): a script that needs a package no browser can run (torch, transformers, mlflow, Node/npm modules, ...) is shown as "run it on your computer" with its download instead of a Run that would fail; helper modules other scripts import are not listed as labs. The Lab card is the one place to run or edit a lesson's scripts: the lesson text only links a script's name to its download, and a command block that runs it stays a plain command (Run buttons there repeated the card). "Run your own file" takes the learner's files (picker or drop). Code runs in a Web Worker, never on the host: Python with Pyodide (pinned, loaded from the jsDelivr CDN on first use, packages loaded from imports, `urllib`/`requests` patched to use fetch), JS/TS with sucrase stripping types and a small `require` over the working folder. Safety is the sandbox itself (no access to disk, shell or other programs), not command filtering. Because a worker shares the page's origin, `sandbox.ts` locks each worker down before any code runs: requests to the app's own origin and to loopback/private hosts (the Docker api, other local services) are refused, and IndexedDB, Cache Storage, nested workers and BroadcastChannel are removed, all frozen on the prototypes; the public internet stays reachable (CDN, lab downloads). A stronger follow-up is to start the workers from an opaque-origin sandboxed iframe. Each course has one in-memory working folder per tab (lesson files, the learner's files, and files runs write), so `lab-corpus.py` writing `input.txt` feeds the next lab; a lesson file never overwrites the learner's file of the same name. `input()`/`prompt()` read lines typed before Run (interactive input needs cross-origin isolation, which GitHub Pages cannot provide). Stop terminates the worker. Packages that cannot run in WebAssembly (torch, transformers) end with a plain hint to download the file. Rust code blocks with a `main` open the official Rust Playground with the code filled in.
- **Self-check while AI is off.** In a quiz that shows answers, an open answer waiting for AI (runner down, or its grade failed) shows the rubric and three marks: got it (1), partly (0.5), missed (0). `POST /attempts/:id/answers/:qid/self-mark` stores it with `grader = "self"`, so the attempt is scored, passed and clears the lesson gate now. The grade job stays queued: when the runner grades it, the AI grade replaces the self-mark (`grader` goes back to `ai`). A self-mark gives no XP, because answer XP is keyed per answer and would block the AI grade's award. Exams and quizzes with `show_answers: false` never reveal the rubric, so they keep waiting for AI.
- `school doctor`: Docker up, `api` healthy, configured CLI on PATH and logged in (a one-line haiku "say hi" call with the adapter baseline flags, fractions of a cent), runner connected, DB migrated. The UI mirrors runner state only contextually: an inline "AI is paused" notice where chat/grading is unavailable, and an AI runner row on the Settings page (no global status indicator).

### Runner sandbox (it loses the container sandbox, so compensate)

Friends' course repos are untrusted text going into a CLI on the host that has file access.
- Spawn the CLI with cwd = a fresh empty temp dir.
- Tools and file access disabled via the adapter; **an adapter that can't disable tools is refused**.
- Course content goes in only through stdin, framed as data, never as instructions.
- Output must validate against the job's zod schema or the job fails (no free-form side effects).

Claude adapter baseline (minimal, cheap, isolated; confirmed by the owner, re-verify on first run):
```
claude --model <model> -p "<prompt>" --system-prompt "<job system prompt>" \
  --tools "" --strict-mcp-config --disable-slash-commands --setting-sources "" \
  --output-format json
```
- `--tools ""` = no tools; `--strict-mcp-config` = no MCP servers; `--disable-slash-commands` = no skills; `--setting-sources ""` = no user/project settings, hooks or CLAUDE.md leaking in; `--system-prompt` replaces the default prompt.
- Model per job kind: a cheap model (haiku) for `doctor`, chat and short grading; a stronger one for `generate` and `verify`. Configurable per adapter.
- Verified (2026-10-20, Windows, haiku): output is one JSON object; read `result` (text), `is_error`, `total_cost_usd`, `usage`, `permission_denials`, `session_id`. A "say hi" call costs ~$0.0002 and ~1.4s. With `--tools ""` the model could not read a file in cwd (replied NO_TOOLS). A 109k-char prompt piped on stdin (`-p` with no argument) worked and was answered correctly (~$0.01), so pass job prompts via stdin, not argv.
- Still to confirm: schema-constrained output (we validate with zod and retry, rather than relying on a CLI flag), and behavior when logged out (exit code / `is_error`) for `doctor`.

Environment: Windows with Docker Desktop (decided 2026-10: the repo stays on the Windows file system, not moved into WSL). The Claude CLI is installed and logged in on Windows, and the runner runs there on the host. The web dev server is reached at `127.0.0.1:5174` (`WEB_PORT`, the same port inside the container and on the host so Vite prints the working URL; 5173 is used by something else on this machine), because `localhost` resolves to IPv6 first and Docker publishes IPv4 only.

## 4. Course package format (draft; finalize in phase 1)

```
<package>/                       # fetched by {url, path, ref}; ref pinned to a commit/tag
  course.yaml                    # manifest, schemaVersion, chapters, exam blueprints
  sources.md                     # numbered sources; lessons cite them
  01-<chapter>/
    lesson-01.md                 # frontmatter + markdown + directives
    quiz-01.yaml
  resources/                     # images, pdf, xlsx, docx
  exams/                         # mid.yaml, final.yaml (blueprints, see section 7)
```

**Course ids.** Progress, XP and the question bank are keyed by course id, so ids must be unique across the courses you write and the ones you import. A new course gets `<title-slug>-<6 random chars>` from `school new-id "<title>"` (the authoring skill runs it), and the id never changes after the first publish. Installing a package whose id is already installed from a different source is refused (409) rather than merged; the same source updates in place. Ids made before this rule (`typescript-fundamentals`) stay valid.

`course.yaml`
```yaml
schemaVersion: 1
id: typescript-fundamentals-k3x9f2
title: TypeScript Fundamentals
short_intro: One-line pitch.
description: |
  Markdown description.
level: Beginner
tags: [typescript, programming]
chapters:
  - dir: 01-basics
    title: Types You Actually Use
exams:
  - {id: mid, file: exams/mid.yaml, after: 01-basics}
  - {id: final, file: exams/final.yaml}
```

`01-basics/lesson-01.md`
```markdown
---
id: l01
title: Primitives and inference
quiz: quiz-01.yaml
resources: [../resources/cheatsheet.pdf]
sources: [3, 7]            # or `none`
---
Plain markdown. Images as ![alt](../resources/diagram.png). Code in fenced blocks.
Low-confidence claims are flagged inline, not smoothed over.
```

`01-basics/quiz-01.yaml`
```yaml
id: q01
title: "Check: primitives and inference"
max_attempts: 0                # 0 = unlimited
passing_percentage: 70
show_answers: true
shuffle: false
questions:
  - id: q01-1
    type: mcq                  # mcq | short | open | fill | sort | spot | hotspot | match | trace
    text: "Which line is a type error?"
    code: |
      const n = 5; n = 6;
    concepts: [const, assignment]
    options:                   # authored explanation per option (deterministic, no AI needed)
      - {text: "const n = 5;", correct: false, explanation: "..."}
      - {text: "n = 6;", correct: true, explanation: "const bindings can't be reassigned."}
  - id: q01-2
    type: short                # fuzzy-matched locally
    text: "Inferred type of `let x = 'a'`?"
    answers: ["string"]
  - id: q01-3
    type: open                 # graded by the runner against the rubric
    text: "Explain structural typing in your own words."
    rubric: |
      Must mention: shape-based compatibility; contrast with nominal typing.
    sources: [3]
  - id: q01-4
    type: fill                 # drag chips into numbered slots; scored locally per slot
    text: "Complete the function so it returns the first match."
    template: |
      for (const item of items) {
        {{1}} {
          {{2}}
        }
      }
    chips:                     # exactly one chip per slot (slot: N) plus distractors (no slot)
      - {text: "if (test(item))", slot: 1, explanation: "Tests each item."}
      - {text: "return item;", slot: 2, explanation: "Stops at the first match."}
      - {text: "break;", explanation: "Leaves the loop without returning the item."}
```

**Choosing a type.** The guidance lives in one place, `packages/shared/src/questionTypes.ts` (`QUESTION_TYPE_INFO`: what the learner does, where to use it, where another type fits better, and whether it is scored instantly). Each schema in `course.ts` points at its entry, the brief renders it for authors, and a type cannot be added without a description (the table is checked against the type list at compile time).

| Type | Use it for |
| --- | --- |
| `mcq` | Recognising the right fact, definition or outcome among plausible alternatives |
| `short` | Recalling one exact term, name or value where the wording hardly varies |
| `open` | Explaining, comparing or justifying in own words (the only type graded by the AI runner) |
| `fill` | Completing code or a sentence from a bank; putting steps in order |
| `sort` | Classifying many items into a few categories |
| `spot` | Finding the faulty or relevant line in code, or reviewing a diff |
| `hotspot` | Locating something on a diagram, screenshot, chart or map |
| `match` | One-to-one pairs: term and definition, error and cause |
| `trace` | Predicting how state changes step by step |

**MCQ** = multiple-choice question: one or more correct options, each with an authored right/wrong explanation. Scored locally, deterministically, all-or-nothing.

**Fill** = chips dragged into the numbered slots (`{{1}}`, `{{2}}`, ... in order, 1 to 8) of a `template`. It covers completing code or a definition; a template of only slots is an ordering question, so there is no separate `order` type. Every chip carries an explanation (a distractor says why it is wrong). Scored locally per slot: marks are the share of slots right, and the answer counts as correct only when all are. The API shuffles the bank per question and never sends the slot key. Dragging is one input among several: pick a chip, then a slot, works for keyboard and touch.

**Sort** = drag items into 2 to 6 named `buckets` (`items: [{text, bucket, explanation}]`, 2 to 12). Several items may share a bucket. Scored locally per item (share right), correct only when all are.

**Spot** = click the faulty line(s) of `code`; `correct` lists 1-based line numbers and one `explanation` says why. Scored locally as right lines over everything picked or needed, so extra picks cost marks; correct only on the exact set.

**Hotspot** = click a place on an image under `resources/`. `regions` are `rect`, `ellipse` or `poly` shapes in percent of the image, each with a `name` and `explanation`; some are `correct`, the rest are decoys. With several correct regions the learner places that many markers (`picks`). The regions are never sent to the browser: the click coordinates go to the API, which grades them and reveals the regions afterwards. Marks are the share of correct regions that hold a marker. It generalizes to any visual: architecture diagrams, UI screenshots, charts, maps, anatomy.

**Spot, diff mode.** `diff: true` draws `code` as a diff (`+` green, `-` red, context plain) for code-review questions. Grading is unchanged: a line left unselected is a line judged fine, so a separate per-line verdict type would add nothing.

**Match** = connect each left item to its partner (`pairs: [{left, right, explanation}]`, 2 to 8, plus up to 4 `distractors` on the right). One-to-one; use `sort` when items share a category. Scored locally per pair.

**Trace** = fill in a grid of what each variable holds after each step of `code` (`variables`, `steps: [{label, values, given}]`). A value may list accepted spellings; `given` cells are shown pre-filled. Cells compare as written (spacing and quote style ignored, case not) and are scored locally per cell, so no model is involved.

These types (and `fill`) are scored locally and instantly, in quizzes and exams. The API shuffles any bank (chips, items) per question and addresses answers by authored index.

**Levels, provenance and depth** (added for extensions, section 6). Optional fields, all with defaults so v1 packages stay valid:
```yaml
budget_minutes: 60               # optional target depth in learner minutes: a hint for deep authoring, a cap for quick generation
chapters:
  - dir: 01-basics               # level 1, origin researched (defaults)
    title: Types You Actually Use
  - dir: 05-guards-deep-dive
    title: How the compiler narrows
    level: 2                     # extension level; never counted in the core course percent
    origin: quick                # researched | quick. quick = written in-app from model knowledge, unverified
```
**Extensions live in an app-owned overlay, never in the package.** Per course, `extensions/<course-id>/` (gitignored, next to `courses/`; override with `SELFSCHOOL_EXTENSIONS_DIR`) holds `extension.yaml` (`schemaVersion: 1`, `chapters:` with `level` >= 2 and `origin`), its own `sources.md`, and chapter folders in the usual layout. The loader merges them after the core chapters. This is what makes extending identical for your own and for pulled courses: a `ref` bump or reinstall replaces the package and leaves the overlay alone, and sharing a course shares only the package, never your progress, weak spots or extensions. Namespace rules keep upstream additions from colliding: lesson, quiz and question ids start with `x`, extension chapter folders are named `xNN-...`, and extension source numbers start at 101. The loader skips anything that breaks these rules (with a warning) rather than failing the course.

Lessons already carry `minutes`; a budget is the sum. Rough tiers for outlines: 15 min = 1 chapter of 2-3 short lessons; ~1 h = 4-6 lessons and a quiz; ~12 h = several chapters plus mid and final exams; days = built in stages, one level at a time.

Validator (`school validate`, also run on every package fetch): unique ids, referenced files exist, every option has an explanation, at least one correct option, every lesson has sources or `sources: none`, no broken relative links, image alt text, every `open` question has a rubric.

## 5. Data model (SQLite, owned by `api`)

- `package`: id, url, path, ref (commit SHA), fetched_at, schema_version.
- `lesson_revision`: package, lesson id, content hash, revision no. Content is read from files; this table pins what the user saw.
- `completion`: lesson id + revision completed + when.
- `attempt`: quiz or exam instance, started/finished, score, per-answer rows (answer, correct, marks, grader: `local|ai`, feedback).
- `xp_event`: append-only ledger. Never recomputed downward.
- `question`: the bank. id, package, content hash, type, payload (JSON), concepts, difficulty, sources, origin (`authored|generated`), status (`active|retired|unverified`).
- `exam_instance`: frozen snapshot (list of question ids + payload copy) so later bank changes never alter a taken exam.
- `job`: id, kind (`grade|chat|generate|verify`), payload, status (`pending|running|done|failed`), result, attempts.
- `chat_message`: lesson-scoped history with citations.

## 6. Extensions and revisions ("want to continue learning?")

The end of a course offers "dig deeper". Rules:
- **Completed lessons are never mutated silently.** Extensions are new chapters appended as a level ("Level 2", "Deep dive").
- **New source contradicts an old lesson:** Claude proposes a revision; the lesson gets an "updated" badge and a diff; re-reading is optional.
- **Completion is tied to the revision completed.** A new revision never resets it.
- **Progress display:** the core course stays frozen at 100%; extensions are tracked separately. Adding content never makes the percentage go backwards.
- **XP** is an append-only ledger.
- **Approval gate stays:** Claude proposes an extension outline (from weak spots in attempt history plus the learner's seed); the user picks a depth (a time budget) and approves before anything is generated.
- **One format, two writers, any budget.** Both paths must produce files that pass `school validate`:
  - **Deep (`origin: researched`):** approving offers "Copy brief": a self-contained markdown brief (approved outline, existing outline, weak spots, depth, and the format rules and templates embedded, so it works in any LLM). The authoring skill (or any LLM doing deep research) writes the chapters into the course's overlay folder (`extensions/<course-id>/`, section 4), never into the package; the app picks them up on the next load. Real sources, one manual step.
  - **Quick (`origin: quick`):** approving offers "Generate here": the runner writes lessons one job at a time (resumable, with an estimated job count shown before it starts). It has no web access, so the content is model knowledge, labelled unverified. Files go into the same overlay folder in the same format, **never inside the package folder** (a reinstall or `ref` bump replaces that), merged after the core chapters as level 2.
- **Provenance is load-bearing.** Chat and `verify` treat lesson text as ground truth, so quick chapters must not launder model knowledge into "covered in this course": chat citations to a quick chapter carry an "unverified" label, `verify` jobs skip them, and the course page marks them. A quick chapter can be upgraded later by running the deep path over it, which flips it to `researched`.
- **Depth is a budget in learner minutes, and who it binds depends on the path.** On the quick path the budget is a real limit: it sizes the outline and caps the generator, because we control the writer. On the deep path the harness and model decide how far to go, so the budget is only an optional hint in the brief and the skill's Clarify step. The real duration is always measured from the written content (section 4, `time.ts`), which is how a finished course is checked against the budget that was asked for.
- Package updates from a friend's repo (new `ref`) go through the same revision rules.

## 7. Exams, question bank, regeneration

- Mid and final exams are blueprints: duration, passing %, shuffle, question count, and domain weights (cert-style, e.g. SAA exam-guide domains).
- Taking an exam creates an **`exam_instance`** (frozen snapshot). Past results are never affected.
- **Regenerate:** a new instance draws unseen bank questions first, then generates new ones from the blueprint (`generate` job). Dedupe by content hash and concept overlap.
- **Quality:** every generated question gets a `verify` job (second pass checks the answer key against the course sources); failures stay `unverified` and aren't served. "Report bad question" retires it.
- The bank is built incrementally and cached; it is never generated per exam on demand under time pressure.
- Open-ended answers in an exam are graded asynchronously; MCQ, short and fill are scored instantly. Final score shows "pending N AI-graded answers" until done.

## 8. Grounded inline chat

An ask box pinned to the bottom of every lesson (the only pinned element) with a "N answers" jump chip; the conversation is its own section below the article. Also reachable from quiz feedback and the text-selection menu ("Ask about this"). UI details: [`docs/ui.md`](docs/ui.md) section 6.3.
- **Context:** current lesson text, user-selected text, the course's `sources.md`. Small courses fit in context; no vector search in v1.
- **Prompt rules:** answer only from the provided material, cite lesson/source sections, otherwise say "not covered in this course".
- **Enforcement:** structured output with citations; `api` checks that every cited section exists in the supplied context and rejects/flags answers without valid citations. Tools are disabled (no web, no files). Citations are visible in the UI so the user can check.
- **Gap button:** "not covered" offers "Propose as extension", which starts the extension flow in section 6.
- This reduces invention; it can't eliminate it.

## 9. v1 features

**Learner UI** (screen-by-screen spec: [`docs/ui.md`](docs/ui.md))
1. Dashboard: course grid, progress bars, "continue learning" card, streak, weekly stats and activity heatmap, weak spots.
2. Course page: chapter accordion, updated-lesson badge.
3. Lesson reader: markdown, syntax highlighting, images, resource downloads, hue-tinted band with a Contents menu (replaces the sticky sidebar; check vs current vs hollow circle, progress rail), prev/next, reading font (serif/sans), text-selection menu ("Ask about this").
4. Quiz runner: intro card, one question at a time, immediate per-option explanation, result screen, attempt history.
5. Question types: nine, listed with where to use each in section 4 (MCQ, short answer, open-ended AI-graded, and the instant interactive types fill, sort, spot, hotspot, match, trace).
6. Mid and final exams with timer, shuffle, blueprint-based draw.
7. Regenerate exam (new frozen instance); report bad question.
8. Inline grounded chat with citations: pinned ask box, "N answers" chip, conversation section below the article.
9. Continue-learning extension flow with approval gate, including the **outline-review screen** (Claude proposes, user approves; reached from "Propose topics" and "Propose as extension"; not yet designed, see `docs/ui.md` section 9).
9a. Settings page: theme (light, light colorblind, dark, dark colorblind, soft dark, or match the device, as preview cards; plus a light/dark toggle in the top bar), reading font, tutor models and runner status, course packages, data export. App-wide theme toggle in the top bar.

**Platform**
10. Course packages by `{url, path, ref}` with validation and revision diffs.
11. SQLite state (progress, attempts, XP ledger, bank, jobs).
12. Runner with provider adapters (Claude only), sandboxed.
13. `school up|down|doctor|validate`; compose dev setup with hot reload.
14. Course-authoring skill (Claude Code) that writes packages (section 11).

**Deferred to v2:** in-browser TS compiler for "does this compile?", code labs with sandboxed test runs, teach-it-back, spaced-repetition flashcards, confidence ratings, adaptive review queue, authoring UI, other providers.

## 10. Repo layout

```
selfschool/
  plan.md
  CLAUDE.md                     # "Read plan.md."
  compose.yaml                  # web + api
  package.json / pnpm-workspace.yaml
  packages/
    shared/                     # zod schemas: course format, job payloads/results
    web/                        # React SPA: dashboard, course, lesson (Contents menu, pinned ask box + thread, selection menu), quiz, exam, Settings (theme, reading font, models, packages, data), theme toggle; follows docs/ui.md
    api/                        # Hono + Drizzle + SQLite
    runner/                     # host-side job puller + provider adapters
    cli/                        # school up|down|doctor|validate
  skill/
    SKILL.md                    # course-authoring skill
    templates/                  # course.yaml, lesson.md, quiz.yaml
  examples/                     # sample packages used as test fixtures
                                # your courses live in the sibling repo ../selfschool-courses (COURSES_PATH / SELFSCHOOL_COURSES_DIR)
  docs/
    ui.md                       # UI spec: rules, tokens, screens, accessibility
    ui-reference/               # approved prototype boards (need the Design runtime to render)
```

## 11. The authoring skill (`skill/SKILL.md`)

1. **Clarify:** subject, level, depth/length. One short round of questions.
2. **Research:** `deep-research` skill; write `sources.md`.
3. **Outline:** chapters, lessons, quizzes, exam blueprints, learning objectives. **Stop for approval.**
4. **Generate files** per section 4. Every claim ties to a source; flag low confidence. Generate in stages for long courses.
5. **Validate:** `school validate`.
6. **Report:** two sentences: what was built, where to open it, anything skipped.

No sync step: the app reads the package directly.

## 12. Phases and acceptance

0. **Foundations:** pnpm workspace, `shared` schemas, compose with `web` + `api`, `doctor` skeleton. *Accept:* `school up` brings up an empty app; `down` stops it cleanly.
1. **Content and reader:** package loader + validator, dashboard, course page, lesson reader. Hand-write a tiny sample course. *Accept:* open the sample course and read it end to end.
2. **Quizzes and state:** MCQ + short, attempts, completion, progress, XP ledger. *Accept:* scores and progress survive `down`/`up`.
3. **Runner and AI:** jobs table, long-poll runner, Claude adapter, sandbox, open-ended grading, grounded chat. **First run the adapter baseline command (section 3) and confirm** the JSON output shape, stdin prompts, and that tools are really off. *Accept:* open-ended answer gets graded with feedback; chat cites valid sections; a planted injection in lesson text doesn't change behavior; runner down degrades gracefully.
4. **Exams and bank:** blueprints, exam instances, regenerate, verify pass, report bad question. *Accept:* regenerating produces a new instance without touching past ones.
5. **Authoring skill + first real course:** TypeScript. *Accept:* generated package validates and is studyable end to end.
6. **Packages and revisions:** fetch by `{url, path, ref}`, revision diffs, extension flow. *Accept:* bumping `ref` shows an "updated" badge and doesn't reset completion.

## 13. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Prompt injection via friends' course text | Empty-cwd sandbox, tools disabled (adapter refused otherwise), content as stdin data, schema-validated output |
| Generated questions are wrong | Authored explanations, `verify` pass against sources, `unverified` not served, report button |
| Grounded chat still invents | Mandatory citations validated server-side, visible in UI, "not covered" path |
| Subscription limits (bulk generation) | Incremental bank, cached, background jobs, backoff |
| Subscription/terms for CLI use | Only shell out to the official CLI; never reuse OAuth tokens in our own code. Re-check current terms |
| Runner not running | App works without it; AI jobs queue as `pending`; `doctor` reports it |
| Docker on NTFS | Accepted: the repo is bind-mounted from Windows; the SQLite file lives in a named Docker volume, not on NTFS, and the catalog re-scan is throttled (`recheckMs`) so file watching is not needed |
| Schema drift in the package format | `schemaVersion` in the manifest; validator rejects unknown versions loudly |

## 14. Open questions

- Course package manifest: finalize in phase 1 once the reader exists.
- How aggressively to retire/dedupe near-duplicate bank questions (hash only vs concept overlap).
- Fuzzy matcher for short answers (token-sort ratio like Frappe's rapidfuzz > 85, or something simpler).

## 15. References

- Frappe LMS (design reference only): https://github.com/frappe/lms. Worth stealing: lesson page layout (`frontend/src/pages/Lesson.vue`, `StudentLessonSidebar.vue`), quiz flow (`components/Quiz.vue`), `CourseCard.vue`, grading logic in `lms/lms/doctype/lms_quiz/lms_quiz.py`. Frappe has no "continue learning" card; we add it.
- Frappe `skills/frappe-learning/` in that repo: a concise map of the LMS data model.
