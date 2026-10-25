# Selfschool UI spec

Single source for the UI. Derived from the approved prototype: six Design boards (dashboard, course, lesson, quiz, exam result, settings), kept in [`ui-reference/`](ui-reference/README.md) and published (private) at https://claude.ai/artifact/7Hh1A9cjkbTtq8THUVCoCN. Where this doc and a board disagree, the board wins until this doc is fixed; list differences in section 11.

Product context lives in [`../plan.md`](../plan.md). This doc covers look, components and behavior only.

---

## 1. Design rules

1. **Ink primary buttons.** Primary action = `--primary` background, `--primary-fg` text (near-black in light, near-white in dark). Secondary = 1px `--border2` outline on `--bg`. No colored primary buttons.
2. **Indigo accent is reserved for the tutor.** `--accent` / `--accent-soft` appear only on: AI answers, citations, feedback blocks, "Ask about this" / "Ask about this lesson" actions, the ask-box icon, and the "N answers" chip. Never for navigation, links in chrome, or generic emphasis. (Inline `[3]` citation markers in lesson prose use the accent too.)
3. **One hue per course** (blue, orange, teal, pink). It colors that course's cover/band, monogram, progress bars and the "current item" marker, and nothing else. Small text on a hue tint uses the `-ink` token, not the raw hue.
4. **Green / red / amber only for state.** `--ok` correct or done, `--bad` wrong or failed, `--warn` pending, provisional, low confidence, or AI unavailable. Never decorative.
5. **Hairlines, not shadows.** Separation is 1px borders (`--border`, `--border2`). Shadows exist only on floating layers: the Contents menu, the text-selection menu, and the pinned ask bar (exact values in section 8.2).
6. **Mono uppercase section labels.** IBM Plex Mono, 11px, 0.08em tracking, uppercase, `--text3`. Section header = label on the left, optional meta on the right, 1px `--border2` rule below.
7. **Dot-grid course monogram is the signature element.** A 2-4 letter mono monogram (TS, AWS, PG) in the course hue over a hue-tinted surface with a radial-gradient dot grid (section 8.1). Appears on dashboard cards, the course hero, and the lesson/quiz/exam bands.
8. **No status chrome.** No global "runner connected" indicator. AI runner state shows only (a) as an inline notice where AI is unavailable (`ai: paused` on the lesson ask bar; the same pattern wherever AI is needed) and (b) on the Settings page.
9. **No gradient washes.** The only gradients are the masks that fade the dot grid. Flat fills elsewhere.
10. **No emoji, no sparkle icons.** Icons are 16px, 1.5 stroke, round caps/joins, `currentColor`, outline style. AI affordance icon = chat bubble.

---

## 2. Tokens

Defined on `.app`; dark values on `.app[data-theme="dark"]`. Copied from the boards.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--canvas` | `#F3F5F8` | `#090B10` | Page background behind the dashboard |
| `--bg` | `#FFFFFF` | `#0F131B` | Default surface, header, cards |
| `--surface` | `#F8F9FB` | `#141925` | Panel headers, code blocks, ask bar, thread |
| `--surface2` | `#EEF1F5` | `#1B2130` | Inline code, active nav, segmented control track, progress track |
| `--border` | `#E2E6EC` | `#232A39` | Default hairline |
| `--border2` | `#CDD3DC` | `#333C4F` | Stronger hairline, section rule, button outline |
| `--text` | `#0B1220` | `#E9EDF5` | Primary text |
| `--text2` | `#475467` | `#A3ADBD` | Secondary text |
| `--text3` | `#5F6A7D` | `#8892A4` | Tertiary text, labels, meta |
| `--primary` | `#0B1220` | `#E9EDF5` | Primary button, user chat bubble, logo tile |
| `--primary-fg` | `#FFFFFF` | `#0B1220` | Text on `--primary` |
| `--accent` | `#4C3FD9` | `#9A8CFF` | Tutor text/icons/citations |
| `--accent-fg` | `#FFFFFF` | `#120C33` | Text on a solid accent fill |
| `--accent-soft` | `#EFEDFD` | `#221C4F` | Tutor surfaces (answers, feedback header, chip, selection highlight) |
| `--ok` | `#0F7B45` | `#3DDC84` | Correct, done |
| `--ok-bg` | `#ECFAF2` | `#0C2418` | |
| `--bad` | `#C0262D` | `#FF7B7B` | Wrong, failed |
| `--bad-bg` | `#FDEFEF` | `#2C1417` | |
| `--warn` | `#A15C07` | `#F5B73B` | Pending, provisional, low confidence, AI paused |
| `--warn-bg` | `#FEF6E4` | `#2A1F0B` | |
| `--hue-blue` | `#1F6FD0` | `#6AA8FF` | Course hue: fills, monogram, dots |
| `--hue-blue-bg` | `#E9F2FD` | `#0F2038` | Cover/band tint |
| `--hue-blue-ink` | `#14529E` | `#9CC4FF` | Small text on the tint |
| `--hue-orange` | `#C2570C` | `#FBA45C` | |
| `--hue-orange-bg` | `#FFF1E5` | `#2B1A0C` | |
| `--hue-orange-ink` | `#8F3F08` | `#FDC08F` | |
| `--hue-teal` | `#0B7A6F` | `#34D3C0` | |
| `--hue-teal-bg` | `#E3F5F2` | `#0B2420` | |
| `--hue-teal-ink` | `#085A52` | `#7BE5D6` | |
| `--hue-pink` | `#B8255F` | `#F58BB4` | |
| `--hue-pink-bg` | `#FCEAF1` | `#2B1220` | |
| `--hue-pink-ink` | `#8A1A47` | `#F9B3CD` | |

Notes
- `--text3` is `#5F6A7D` in light (darkened from an earlier lighter value to pass 4.5:1 on `--surface2`).
- The light `--ok/--bad/--warn` and `--hue-*-ink` values were chosen to pass contrast (section 10); do not lighten them.
- Dashboard activity heatmap (not tokens; hue-blue ramp, 5 levels). Light: `#EEF1F5 #CFE2FA #9CC4F2 #5C9BE6 #1F6FD0`. Dark: `#1B2130 #16365E #1F5A9E #3B82D6 #6AA8FF`.
- Shadow colors: the boards use `rgba(11, 18, 32, ...)` in both themes; no dark variant is defined (section 11).

Theme mechanism: `data-theme="<id>"` and `data-mode="light|dark"` on `<html>`. Five themes, defined in `index.css` under their ids and listed in `src/theme.ts` (`THEMES`):

| Id | Mode | What it is |
|---|---|---|
| `light` | light | The approved light board |
| `light-colorblind` | light | Same neutrals; right is blue (`--ok`), wrong is orange (`--bad`), warning is yellow |
| `dark` | dark | The approved dark board |
| `dark-colorblind` | dark | Same neutrals; right is blue, wrong is orange, warning is yellow |
| `soft-dark` | dark | Reduced-contrast dark: slate surfaces (`#22272e`), text `#adbac7`, softer accents; text pairs still pass 4.5:1 |

The user choice is one of those five or "Match my device" (light default by day, dark default at night, following `prefers-color-scheme` live). The token blocks match any element with the attribute, not only `<html>`, which is how the Settings previews show a theme without applying it. Rules that only care about light versus dark (code highlighting, selection colour) key off `data-mode`. The top-bar toggle flips to the mode's twin (light <-> dark, light colorblind <-> dark colorblind) and returns to the previous theme when that was the other mode (so soft dark -> light -> soft dark). Colour is never the only signal for right and wrong (icons and text always accompany it), which is why the colorblind themes change hue only.

---

## 3. Type

| Role | Family | Size / line | Weight | Notes |
|---|---|---|---|---|
| UI base | IBM Plex Sans | 14 / 1.5 | 400 | Body of the app |
| Page h1 | Plex Sans | 30 / 1.2 (dashboard, settings); 24 (quiz, exam) | 600 | letter-spacing -0.02em |
| Hero h2 (continue card) | Plex Sans | 32 / 1.15 | 600 | -0.025em |
| Course h1 | Plex Sans | 32 / 1.15 | 600 | -0.025em |
| Lesson h1 | Plex Sans | 40 / 1.12 | 600 | -0.025em |
| Lesson standfirst | Plex Sans | 19 / 1.55 | 400 | `--text2`, max 78ch |
| Lesson h2 | Plex Sans | 24 / 1.3 | 600 | -0.015em, always sans |
| Lesson prose | IBM Plex Serif (default) or Plex Sans | 17 / 1.75 | 400 | Settings > Reading font switches Serif/Sans |
| Card title | Plex Sans | 15 / 1.35 | 600 | |
| Body small / meta | Plex Sans | 12-13 | 400 | |
| Section label | IBM Plex Mono | 11, 0.08em, uppercase | 400 | `--text3` |
| Mono data | Plex Mono | 10-13 | 400-600 | Counts, percentages, status pills, code |
| Big numerals | Plex Mono | 44 (exam score), 28-44 (monogram), 21 (ring) | 600 | tabular |
| Code block | Plex Mono | 13 (quiz) / 13.5 (lesson), line 1.65 | 400 | |
| Inline code | Plex Mono | 0.86em | 400 | `--surface2` bg, 2px 6px padding, radius 5 |

Fonts: Google Fonts IBM Plex Sans 400/500/600, Mono 400/500/600, Serif 400/500/600. Self-host for the real app (offline use).

Numbers that change (counts, scores, timers) use tabular figures.

### Radii
Pills/chips 999px; controls and buttons 8px (small) / 10px (primary 40px height); cards and panels 12px; code blocks 10px (lesson) / 8px (quiz); logo tile 7px; progress bars 2px; heatmap cells 3px; inline code 5px; chat bubbles 12px with a 4px corner at the tail.

### Spacing
4px base. Page padding 28px; main column gaps 24-28px; card padding 16-20px; list rows 12px 16px; section header rule gap 10px below label.

### Control sizes
- Icon buttons 34x34 (header, lesson nav). Send button 34x34.
- Primary button 40px high, 18px horizontal padding, 10px radius. Compact primary 36px.
- Secondary button 34px (default), 32px (in-card), 30px or 28px (row actions).
- Select 36px. Segmented control: 30px items in a 3px-padded `--surface2` track.
- Pill: font 10-12px, padding 1-3px 7-10px.
- Progress bar 4px (cards, rows), 3px hero bottom edge. Header height 56px.
- Content widths: dashboard 1180, course 1120, lesson article 940 (ask bar and thread same), quiz 720, exam 880, settings 880.

---

## 4. Tailwind mapping

Keep the CSS variables as the source of truth; Tailwind reads them.

**Tailwind v4** (`@theme` in the main CSS):
```css
@import "tailwindcss";

@theme {
  --color-canvas: var(--canvas);
  --color-bg: var(--bg);
  --color-surface: var(--surface);
  --color-surface2: var(--surface2);
  --color-border: var(--border);
  --color-border2: var(--border2);
  --color-text: var(--text);
  --color-text2: var(--text2);
  --color-text3: var(--text3);
  --color-primary: var(--primary);
  --color-primary-fg: var(--primary-fg);
  --color-accent: var(--accent);
  --color-accent-fg: var(--accent-fg);
  --color-accent-soft: var(--accent-soft);
  --color-ok: var(--ok);
  --color-ok-bg: var(--ok-bg);
  --color-bad: var(--bad);
  --color-bad-bg: var(--bad-bg);
  --color-warn: var(--warn);
  --color-warn-bg: var(--warn-bg);
  --color-hue: var(--hue);          /* per-course, see below */
  --color-hue-bg: var(--hue-bg);
  --color-hue-ink: var(--hue-ink);
  --font-sans: "IBM Plex Sans", system-ui, sans-serif;
  --font-serif: "IBM Plex Serif", Georgia, serif;
  --font-mono: "IBM Plex Mono", ui-monospace, monospace;
  --radius-control: 8px;
  --radius-button: 10px;
  --radius-card: 12px;
}
```

**Tailwind v3** (`tailwind.config.ts`):
```ts
export default {
  darkMode: ["selector", '[data-theme="dark"]'], // tokens already switch; rarely needed
  theme: {
    extend: {
      colors: {
        canvas: "var(--canvas)", bg: "var(--bg)", surface: "var(--surface)", surface2: "var(--surface2)",
        border: "var(--border)", border2: "var(--border2)",
        text: "var(--text)", text2: "var(--text2)", text3: "var(--text3)",
        primary: { DEFAULT: "var(--primary)", fg: "var(--primary-fg)" },
        accent: { DEFAULT: "var(--accent)", fg: "var(--accent-fg)", soft: "var(--accent-soft)" },
        ok: { DEFAULT: "var(--ok)", bg: "var(--ok-bg)" },
        bad: { DEFAULT: "var(--bad)", bg: "var(--bad-bg)" },
        warn: { DEFAULT: "var(--warn)", bg: "var(--warn-bg)" },
        hue: { DEFAULT: "var(--hue)", bg: "var(--hue-bg)", ink: "var(--hue-ink)" },
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', "system-ui", "sans-serif"],
        serif: ['"IBM Plex Serif"', "Georgia", "serif"],
        mono: ['"IBM Plex Mono"', "ui-monospace", "monospace"],
      },
      borderRadius: { control: "8px", button: "10px", card: "12px" },
    },
  },
};
```

**Per-course hue.** The tokens are `--hue-blue|orange|teal|pink[-bg|-ink]`. Alias them once on a course wrapper so components use `text-hue`, `bg-hue-bg`, `text-hue-ink`:
```css
[data-hue="blue"]   { --hue: var(--hue-blue);   --hue-bg: var(--hue-blue-bg);   --hue-ink: var(--hue-blue-ink); }
[data-hue="orange"] { --hue: var(--hue-orange); --hue-bg: var(--hue-orange-bg); --hue-ink: var(--hue-orange-ink); }
[data-hue="teal"]   { --hue: var(--hue-teal);   --hue-bg: var(--hue-teal-bg);   --hue-ink: var(--hue-teal-ink); }
[data-hue="pink"]   { --hue: var(--hue-pink);   --hue-bg: var(--hue-pink-bg);   --hue-ink: var(--hue-pink-ink); }
```
The course manifest carries `hue` (default derived from the course id); the web app sets `data-hue` on each course card and course/lesson/quiz/exam page root.

---

## 5. Shared chrome

**Top bar** (56px, `--bg`, bottom hairline): logo tile (26px, `--primary` square with a mark) + "Selfschool"; nav links Dashboard / Courses / Attempts (active = `--surface2` pill, weight 500; inactive `--text2`); right side, in order: **Settings** gear (34px outlined icon link, `aria-label="Settings"`), then **theme toggle** (34px outlined button, immediately right of the gear; shows a sun when dark and a moon when light; `aria-label="Toggle light and dark theme"`). There is no runner status in the bar.

**Course band** (course, lesson, quiz, exam): `--hue-bg` fill, bottom hairline, dot grid masked to fade in from the right/middle, monogram + 1px divider (hue at 35% opacity) + course title link + sub-line; right side shows position (`06 / 12`, `1 / 4 · QUIZ`, `ATTEMPT 2`). A 3px progress rail (`--border` track, `--hue` fill) sits on the bottom edge where progress applies (course, lesson, quiz; not exam).

**Section header**: mono uppercase label left, optional meta right, `--border2` rule.

**Pills**: mono or sans, fully rounded; tints `--*-bg` with the matching foreground. Examples: `UPDATED`, `UPDATED · REV 2` (hue), `ATTEMPT 2 · 2 PENDING` (warn), `Provisional` (warn), `Incorrect` (bad), `Grading…` (warn), `2 / 3 POINTS` (ok).

---

## 6. Screens

### 6.1 Dashboard (`Main.dc.html`)
- Header row: date label (mono, e.g. "Tuesday · Oct 20"), h1 "Dashboard". Right: a warn-tinted link chip "2 answers awaiting grading → View" shown only when AI-graded answers are pending (links to Attempts / the exam result).
- **Continue card**: hue-tinted (the last-studied course's hue), dot grid fading in from the right, mono label "Continue · TS · Lesson 06", h2 lesson title, sub-line (course · chapter · time), primary button "Resume lesson →" and an "Up next" line. A 116px progress ring on the right (hue stroke over a `--bg` track, `42%` in mono, `5 / 12` beneath). Ring has `role="img"` and an aria-label with the percent.
- **Three columns** (wrap): *This week* (label + "12-day streak", big "3h 40m" with "studied · 41 questions", 7 bars M-S with today highlighted at the top of the ramp); *Activity* (16-week heatmap 7x16 cells, Less-More legend, horizontally scrollable); *Weak spots* (3 rows: concept, percent in `--bad` below 50% or `--warn` otherwise, 4px bar in the same color, "Course · Lesson" sub-line, each a link to the lesson).
- **Courses · NN**: auto-fill grid (min 260px, gap 20). Card = 92px cover (hue-bg, dot grid at 35%, bottom-left monogram 28px, optional `UPDATED` pill top-right), then title, "N lessons · N exams", 4px hue progress bar, mono caption "42% complete" / "Not started". Last tile is a dashed "Add a course" card: "From a package: repo URL, path and ref." + "Add package" button.
- States: empty (no courses) shows only the Add-a-course tile; no continue card until a lesson has been opened.

### 6.2 Course page (`Course.dc.html`)
- Hue band: breadcrumb "Courses / Title", 44px monogram, h1, description (max 64ch), right-aligned mono meta "12 lessons · 2 exams · Level 1" in `--hue-ink`; 3px progress rail.
- Left column: **chapter accordions** (12px-radius bordered panels). Header = `--surface` row with "N · Title" and a right-hand count ("3 / 3" with a green check icon when complete; "2 / 4" with a chevron when partial). Expanded rows: check circle (`--ok`) for done, a dot-in-circle for **current** (row tinted `--hue-bg`, label weight 500, mono `CURRENT` in `--hue-ink`), hollow circle (`--text3`) for not started; duration right in mono; revised lessons get a `UPDATED · REV 2` pill. A fully-complete chapter may stay collapsed.
- **Exams** panel: rows with title, "30 questions · 45 min · pass at 70%", right pill (`ATTEMPT 2 · 2 PENDING` warn) or "Not started".
- Right column (max 320): **Progress** card (label, "5 / 12 · 42%", 4px hue bar, primary "Resume: <lesson>"); dashed **Level 2 · Deep dive** card with "Propose topics" (leads to the outline review screen, section 9) and the explanation that nothing is generated until the outline is approved; mono footer "repo @ sha · 24 sources".

### 6.3 Lesson (`Lesson.dc.html`)
Layout, top to bottom: top bar, hue band, article, conversation section, pinned ask bar.

- **Band**: monogram, divider, course link, chapter sub-line; right: `06 / 12`, a **Contents** button (menu icon + label, `aria-expanded`), prev and next icon buttons (`aria-label`s). 3px progress rail.
- **Contents menu**: popover under the band (right-aligned, 340px, `--bg`, `--border2` border, 12px radius, floating-layer shadow). Chapter headings as mono labels with counts, lesson rows with the same check / current / hollow icons, current row `--hue-bg` with `--hue-ink` text and `aria-current="page"`, exam row with a `--warn` attempt tag. Closes on outside click / Escape.
- **Article** (max 940, padding 44 28 56): meta label "Lesson 06 · 12 min read · revision 1", h1, standfirst, prose in the chosen reading font at 17/1.75. Code blocks: `--surface` panel, 1px border, 10px radius, comments in `--text3`. Citations `[3]` are superscript accent links to the Sources list at the bottom.
  - **Callouts** (always sans): *Low confidence* = `--warn-bg` panel, mono warn label, text + citation; *Key takeaways* = `--surface` panel, mono label, bullet list in `--text2`.
  - Sources list (mono label, numbered rows with ids targeted by the citations).
  - End actions: primary "Take the quiz · N questions", secondary "Next: <lesson>".
- **Text-selection menu**: selecting prose shows a floating two-button toolbar above the selection ("Ask about this" in `--accent`, "Copy" in `--text2`); the selection is highlighted with `--accent-soft`. "Ask about this" puts the selected text into the ask box as context and focuses it.
- **Conversation section** (`id="thread"`, `--surface`, top hairline, 940 wide): header "Ask about this lesson · N answers" with the right-hand note "Answers use only this course's lessons and sources." User messages are right-aligned ink bubbles (max 70%). Tutor answers are `--accent-soft` panels with a 12px radius containing the text and **citation chips** (pill, accent text, links to the lesson section / source). A "not covered" answer shows bold "Not covered in this course.", a `--text2` reason, and a **Propose as extension** button (leads to the outline review screen, section 9).
- **Pinned ask bar**: the only pinned element. `position: sticky; bottom: 0`, `--bg`, top hairline plus a soft upward shadow (floating layer). Contains: optional notice, then a rounded input row (`--surface`, 12px radius): accent chat icon, input labelled "Ask about this lesson" (visually-hidden `<label>`), an **"N answers ↓"** chip (accent-soft pill, anchors to `#thread`), and an ink 34px Send button.
- **`ai: available | paused`**: when paused, a `--warn-bg` inline notice above the input ("AI is paused. Chat and grading resume when you start the runner with `school up`."); the input shows the placeholder "Ask about this lesson (paused)" and both input and Send are `disabled`. Available = no notice.
- Settings > Reading font changes only the prose container's font family.

### 6.4 Quiz (`Quiz.dc.html`)
- Narrow band (720): monogram, course link, "Lesson 06 · Type guards" link, right "`1` / 4 · QUIZ"; 3px rail at question progress. Title "Check: type guards" with mono right meta "PASS AT 70% · ATTEMPT 1".
- One question panel at a time (the board stacks three states for review): header = mono label "Question N of M · Type" + status pill; question text 16/1.5 weight 500; optional code block; answers; actions.
- **Which type for what** is written once in `packages/shared/src/questionTypes.ts` (authors see it in the brief and the skill); this section only specifies how each type looks and behaves. The type label in the header ("Fill the gaps", "Sort into groups", ...) comes from the same naming.
- **MCQ answered**: every option reveals its authored explanation. Selected-wrong = `--bad` border/`--bad-bg`, x-circle icon, "Your answer" tag; correct = `--ok` border/`--ok-bg`, check-circle, "Correct answer" tag; other options neutral with their explanation in `--text2`. Colour is never the only signal (icon + text tag). Actions: right-aligned primary "Next question".
- **Open-ended, submitted** (`Grading…` pill, warn): the user's answer in a `--surface` box, two grey skeleton lines (`aria-hidden`), caption "Queued for the runner. You can leave this page; the result appears here and on the dashboard."
- **Open-ended, graded** (`2 / 3 POINTS` pill, ok): answer box, then a **Feedback** block: accent-soft header "Feedback — AI-graded against the rubric", bullet rows with ok check / bad x icons (what the answer got and what it missed, with a link to the lesson section). Actions: "Ask about this" (outlined, accent text) and primary "See results".
- **Fill** ("Fill the gaps", or "Put in order" when the template is only slots): the template sits in a `--surface` box (monospace when it reads as code) with dashed slot buttons showing their number; below it a hint line and the chip bank (dashed, dimmed once placed). Drag a chip into a slot, or pick a chip (click/Enter, `aria-pressed`) and then a slot; a filled slot returns its chip when pressed and can itself be dragged. Check stays off until every slot is filled. Ordering questions lay the slots out as numbered rows. After checking: the learner's own answer is shown laid out exactly like the question, each placed chip in `--ok` or `--bad` with a check or x icon where it sits; under it one line per slot with the explanation, and "Belongs here: ..." for a wrong one. The pill is Correct, **Partly correct** (warn, some slots right) or Incorrect.
- **Sort** ("Sort into groups"): groups as columns (up to three per row), each a dashed drop zone titled with its name, and a tray of items below. Items are coloured chips like fill. While an item is in hand (picked or mid-drag) every group turns solid accent with "Drop here" on an empty one, and the tray takes a placed item back. After checking, the same columns show each item right or wrong where it was put, then one line per item: right ones state their group, wrong ones say "belongs in X, not Y" and why.
- **Spot** ("Select the lines"): the code is shown as numbered lines, each a toggle with a 3px accent bar when selected; the generic code block is not shown. After checking: right lines `--ok`, wrong picks `--bad`, missed lines dashed `--ok` with "You missed this line", and one explanation underneath naming the line(s).
- **Hotspot** ("Click the image" or "Click N places"): the image at full width, `cursor: crosshair`; a click places a marker (a second click moves a single marker; with several picks the markers fill up and the last one moves). The picture is also a keyboard target: arrows move a dashed crosshair (Shift for bigger steps), Enter places. After checking, every correct region is outlined (`--ok`, dashed when missed), a decoy that was hit is `--bad`, markers are numbered when there are several and coloured right or wrong, and one line per correct or hit region explains it. A marker outside every region counts as a miss.
- **Spot in diff mode**: the same numbered lines with added lines tinted `--ok` and removed lines tinted `--bad` (the `+`/`-` stays in the text, and the accessible name says "Added" or "Removed"). Selection and the review marks are unchanged.
- **Match** ("Match the pairs"): items in two columns with a 64px gutter between; the connections are curves drawn in that gutter. Pick an item on either side and then one on the other, or drag from left to right; the right-hand items light up as targets while a left item is in hand. A connected pair shares a colour (box and line); pressing a connected item cuts it. After checking, the left items stay as buttons marked `--ok` or `--bad`, under "N of M pairs right. Select an item to see where it belongs." One item is open at a time (the first wrong one, else the first). The right column then holds only that item's relevant boxes: where it belongs (`--ok`, check, solid green curve) and, if the learner was wrong, what they chose (`--bad`, cross, solid red curve). Every other right-hand item is hidden, so lines never cross. Its explanation sits underneath: "left → correct partner. explanation".
- **Trace** ("Trace the code"): the code above, then a table, one row per step and one column per variable. Given cells are greyed text; every other cell is a mono text input labelled "After <step>, <variable>". Check stays off until every typed cell is filled. After checking, each cell is `--ok` or `--bad`, a wrong one shows "expected X" beneath, and one explanation follows the table.
- Not shown on the board but required: short-answer question (text input, local fuzzy match, instant result) and the final result screen (reuses the exam result layout).

### 6.5 Exam result (`Exam.dc.html`)
- Band without a progress rail: "Mid-course exam", right "ATTEMPT 2".
- h1 "Result". Two cards: **score** (44px mono "74%", `Provisional` warn pill, "26 of 30 scored · passing is 70%", and a `--surface` note "2 open-ended answers are waiting for the runner. The score can change by up to 7 points."); **By domain** (label, rows with name, percent, 4px hue bar; percent colored `--bad` when the domain is weak).
- **Regenerate exam** panel: "Take it again with new questions" + explanation (unseen bank questions first, then generated and verified; earlier attempts untouched) + primary "Regenerate exam".
- **Missed questions** list: `Q7 · text` with "Domain · Lesson" sub-line, bad x icon, **Report question** outlined button per row; pending open-ended rows show a warn clock and "Open-ended · awaiting grading" with no report button.
- **Attempts** list: "Attempt 1 · Oct 14 — 68% · FAILED" (bad), "Attempt 2 · today — 74% · PROVISIONAL" (warn).
- States: Provisional (pending AI grading) becomes final when all grades arrive; the pill and note disappear and the attempt row shows PASSED / FAILED.

### 6.6 Settings (`Settings.dc.html`)
Single column (880), page label "Preferences", h1 "Settings". Each section has a mono-label header with a `--border2` rule, then rows (16px vertical padding, hairline between): title weight 500 + `--text3` help text on the left, control on the right.
- **Appearance**: *Theme* as a grid of cards in the style of GitHub's appearance settings (section 2): each card is a radio with a miniature of the app drawn in that theme's own tokens, the name and a one-line description. Six cards: Light default, Light colorblind, Dark default, Dark colorblind, Soft dark, and Match my device (a half-light, half-dark preview). The selected card has an accent border and ring; the choice applies immediately and the top-bar button keeps the card in step; *Reading font* segmented Serif / Sans (applies to lesson prose; code stays mono); a live preview paragraph in the chosen font.
- **Tutor**: *AI runner* row with a `Connected` ok pill and `school doctor` hint (this is one of the two places runner state is shown); *Provider* "Claude Code CLI · logged in"; *Model for chat and grading* select (Haiku, Sonnet); *Model for generation and verification* select (Sonnet, Opus).
- **Importing a course** (zip or repo, same popup): a dashed drop zone ("Drop a course .zip here", plus "Choose a file") above the list, and the "Add package" form (its button reads "Check package"). Either opens a modal that runs a dry run first and installs nothing: a checklist (upload with % for a zip, read or fetch, find course.yaml, validate, course id is free), a "What to fix" list of file and message on failure, and an "At a glance" block (counts, then each chapter with its lessons and, per lesson, quiz question count and types, then exams). "Import course" is the final confirm and is disabled until every check passes; it reads "Replace course" when the same source is already installed, and an id owned by a different source is refused. After import: "Open course". Server: `POST /packages/upload/preview` and `/packages/upload` (raw zip, 50 MB, 200 MB expanded, 3000 files, path-traversal safe) and `POST /packages/preview` for repos. A sample zip to try: `examples/tiny-sample-course.zip` (and `tiny-broken-course.zip` for the failing state).
- **Course packages**: header action "Add package"; rows = mono monogram in hue, `repo @ sha` mono, status ("Up to date" `--text3`, or `Update available` hue pill with a "Review changes" button).
- **Data**: *Progress database* with size and "Export backup" button.
- Persistence: theme, reading font and model choices are stored (local storage for theme/font; API settings for models).

---

## 7. Interaction summary

| Interaction | Behavior |
|---|---|
| Theme toggle | Flips to the theme's light/dark twin immediately and persists; Settings > Theme picks any of the five or "Match my device" |
| Contents menu | Toggle button, popover, Esc and outside click close, focus returns to button |
| Ask box | Enter sends; disabled with notice when `ai: paused`; "N answers ↓" scrolls to `#thread` |
| Selection menu | Appears on non-empty selection inside lesson prose; Escape or click away dismisses |
| Quiz answer | Locks on submit, reveals per-option explanations, then "Next question" |
| Open-ended | Submit -> `Grading…` (job queued) -> Feedback; page can be left; dashboard chip counts pending answers |
| Exam | Provisional score while open-ended answers are queued; Regenerate creates a new frozen instance; Report question retires it from serving |
| Propose topics / Propose as extension | Opens the outline review screen (not built yet, section 9) |

---

## 8. Components (reference snippets)

### 8.1 Dot-grid monogram surface
```css
.cover { position: relative; background: var(--hue-bg); }
.cover::before {
  content: ""; position: absolute; inset: 0; opacity: .35; /* .4-.45 on bands */
  background-image: radial-gradient(circle, var(--hue) 1px, transparent 1.5px);
  background-size: 14px 14px; pointer-events: none;
}
/* bands fade the grid in from one side: */
.band::before { mask-image: linear-gradient(90deg, transparent 55%, #000 85%); } /* dashboard, course */
/* lesson: transparent 30%, #000 50%, transparent 72%; quiz: 20/40/60; exam: 25/45/65 */
```
Monogram: Plex Mono 600, -0.03em, `color: var(--hue)`, 28px on cards, 44px on the course hero, 26px on bands.

### 8.2 Floating-layer shadows (the only shadows)
- Contents menu: `0 12px 32px rgba(11, 18, 32, 0.14)`.
- Selection menu: `0 8px 24px rgba(11, 18, 32, 0.12)`.
- Pinned ask bar: `0 -8px 24px rgba(11, 18, 32, 0.06)`.

### 8.3 Progress
Bar: 4px, radius 2px, track `--surface2` (`--border` on the band rail and weak-spot rows), fill in the course hue (weak-spot fill uses `--bad` / `--warn`). Ring: r=42, stroke 7, round caps, circumference 263.9, track `--bg`, fill `--hue`.

---

## 9a. Extension flow (built; no prototype board, so this is the spec)

Entry points: the course page's **Level 2 · Deep dive** card ("Propose topics", or "Review outline" / "View draft" while a proposal is open) and the lesson thread's "Propose as extension". All of it lives at `/courses/:courseId/extensions/:extensionId`, a narrow (880px) page with a "Back to the course" link. The course card also shows a one-line pointer (indigo-soft background, small button) to an approved proposal whose lessons are not in the course yet, or whose writing is running or stopped.

**Drafting.** Indigo-soft card with a spinner, two shimmer lines and the depth it is sized for. The page polls; the learner can leave. A failed draft shows the error and a primary "Draft again".

**Review.** Mono eyebrow "LEVEL 2 PROPOSAL", then the level title as an editable field and the seed ("Started from your question ... in <lesson>").
- **Depth**: a segmented control (15 min / 1 hour / 4 hours / 12 hours, default 1 hour). Changing it drafts a new outline and replaces edits; the hint under it says so.
- **Why these topics**: tutor-indigo panel with the rationale (second person, at most 3 sentences).
- A neutral notice when the outline leans on the model's own knowledge.
- One card per chapter (editable title, why line); lessons as rows with a keep checkbox, editable title, "You'll be able to: ..." line and a muted why line. Unchecked rows dim.
- Footer: "N of M lessons kept · duration" (live), Reject, and a primary "Approve outline" (disabled when nothing is kept).

**After approval**, two equal cards:
- **Write them here** (primary "Generate here"): the runner writes the kept lessons one at a time, from the model's own knowledge, unverified.
- **Research them elsewhere** ("Copy brief", plus a collapsed "Show the brief" textarea as the copy fallback): a self-contained markdown brief for the authoring skill or any deep-research assistant.

**Writing.** One card with a progress bar (`ok` tone, `bad` when stopped): "Writing lessons · 3 of 20" and the lesson in progress; "Stopped after N of M lessons" with the error and a primary "Continue"; "All N lessons are written" with a primary "Open the course". Once writing starts the brief is no longer offered (both writers would use the same ids).

**Provenance.** Chapters written by the model show an "Unverified" badge on the course page; their lessons carry "· Unverified" in the band subline; chat answers on such a lesson get a mono "Unverified · this lesson was written by the model, not researched" line. Chat answers stream into the bubble as they are written (a "Still writing. Citations are added when the answer is done." line, then the final answer with its citations); quiz grading keeps the skeleton until the result.

**Selection menu**: both actions highlight on hover and keyboard focus (indigo-soft for "Ask about this", `--surface2` for "Copy").

---

## 9. Not built yet (follow-ups)

These are intentionally missing from the prototype.

1. **Inline "Check yourself" MCQ inside lessons** and a **"You'll be able to..." objective line** under the standfirst. Both need a lesson-format directive in the package format (plan.md section 4) and a skill change before any UI is built; the existing end-of-lesson quiz stays the only assessment until then.
Also still open: short-answer question state, quiz intro card and final result screen on the Quiz board, empty/loading/error states for every list, mobile layouts (the boards are desktop widths; layouts use flex-wrap but were not designed below ~600px).

---

## 10. Contrast and accessibility

### Contrast (WCAG 2.x, computed from the token values in section 2)
All text and background token pairs actually used pass **4.5:1 in both themes**:

| Pair | Light | Dark |
|---|---|---|
| `--text` on `--bg` / `--canvas` / `--surface` / `--surface2` | 18.7 / 17.1 / 17.8 / 16.5 | 15.9 / 16.8 / 15.0 / 13.7 |
| `--text2` on the same four | 7.7 / 7.0 / 7.3 / 6.8 | 8.2 / 8.7 / 7.8 / 7.1 |
| `--text3` on the same four | 5.5 / 5.0 / 5.2 / **4.8** | 5.9 / 6.3 / 5.6 / 5.1 |
| `--accent` on `--bg` / `--surface` / `--accent-soft` | 7.0 / 6.6 / 6.0 | 6.7 / 6.3 / 5.6 |
| `--accent-fg` on `--accent` | 7.0 | 6.7 |
| `--primary-fg` on `--primary` | 18.7 | 16.0 |
| `--ok` on `--bg` / `--ok-bg` | 5.3 / 5.0 | 10.4 / 9.2 |
| `--bad` on `--bg` / `--bad-bg` | 5.9 / 5.3 | 7.4 / 6.9 |
| `--warn` on `--bg` / `--warn-bg` | 5.2 / 4.8 | 10.4 / 9.0 |
| `--text3` on `--warn-bg` | 5.1 | 5.2 |
| `--hue-*-ink` on `--hue-*-bg` (blue/orange/teal/pink) | 6.8 / 6.6 / 7.2 / 7.8 | 9.2 / 10.4 / 10.9 / 10.2 |
| `--text` and `--text2` on each `--hue-*-bg` | >= 6.8 | >= 7.2 |

Caveat: raw `--hue-*` on its own `--hue-*-bg` is **below 4.5 in light** for blue (4.38) and orange (4.07); teal 4.62 and pink 5.24 pass. The raw hue is therefore used only for large display text (monograms >= 26px bold, needs 3:1), graphics and fills; any small text on a hue tint must use `--hue-*-ink`. Raw hue on `--bg` passes (blue 5.0, orange 4.5, teal 5.2, pink 6.1), which covers the 14px monogram on Settings.

Re-run the check whenever a token changes (the pairs above are the test set).

### Accessibility notes
- Use real `<button>` and `<a>`; never click-handler divs. Links navigate, buttons act.
- Icon-only controls carry `aria-label` (Settings, theme toggle, prev/next lesson, Send); decorative SVGs are `aria-hidden`.
- Colour is never the only signal: correct/wrong use icon + text ("Correct answer", "Your answer"), progress has numbers, pending has text ("Grading…", "PROVISIONAL"), done/current/todo differ by icon shape.
- The ring has `role="img"` + aria-label; skeleton lines are `aria-hidden`; the ask input has a visually-hidden label; the thread is a labelled section; the Contents popover is `role="dialog"` with `aria-expanded` on its trigger and `aria-current="page"` on the current lesson.
- Keyboard: everything reachable by Tab, visible focus ring required (the boards rely on browser default; the app must add a 2px ring using `--accent` for tutor controls and `--text` elsewhere), Esc closes the menus.
- Respect `prefers-reduced-motion`; no animation is specified beyond the skeleton shimmer.
- Honor `prefers-color-scheme` when Theme = System.

---

## 11. Board discrepancies noted while writing this

- Settings: the "System" theme option exists, but the board's toggle logic treats anything except "dark" as light, so System is not wired in the prototype. Implement as `matchMedia`.
- The boards define no focus styles and no dark-mode shadow values (shadows are light-theme rgba only); the app should add both.
- `Tokens.dc.html` in the project folder is a stale token sheet (it still has light `--text3` `#667085`, which fails on `--surface2`); it is not in `canvas.json` and not copied to `ui-reference/`. The token values here come from the six boards.
- Dashboard nav "Attempts" links to the exam result board; there is no attempts list screen yet.
