---
id: l01                       # unique across the whole package, stable forever (l01, l02, ... not per chapter)
title: Lesson title
quiz: quiz-01.yaml            # optional, path relative to this chapter dir
resources: []                 # optional, e.g. [../resources/cheatsheet.md]
sources: [1]                  # numbers from sources.md, or `none`
---
One or two sentences stating what the learner can do after this lesson.

Plain markdown. Every factual claim ends with its source number, e.g. "Red, green and blue are the additive primaries. [1]".
Images: `![Describe what the image shows](../resources/diagram.svg)` (alt text is required).
Code, commands, formulas and data tables go in fenced blocks with a language tag where there is one.

## Concept name: what it does in a few words

One block per concept (see "Teaching method" in SKILL.md): rule, example ladder, contrast, prediction question.

**Rule:** one plain sentence with a concrete mental model. [1]

```python
# 3 to 6 tiny examples, smallest first, each with its result and the state in between
# at least one edge case: empty input, a value larger than everything, ties
```

**Contrast:** a small table putting this concept next to the neighbour it is confused with, on the same input (skip if there is none).

**P1.** A question answered by reasoning alone.

:::answer
The answer, and why in one or two lines. The app shows this closed, behind "Show answer".
:::

## Cheat sheet

| Tool | Rule | Tiny example → result |
| --- | --- | --- |
| `name` | one line | `call` → `result` |

## If you missed a quiz question

**If you thought** the misconception a distractor targets: reread "Concept name". **R1.** A short question on the same idea.

:::answer
The answer to R1, and why.
:::

:::low-confidence
Use this block when a claim is uncertain, version-dependent or from a weak source. Say what is
uncertain and where to check. Cite the source. [2]
:::

:::key-takeaways
- One-line takeaway.
- Another one-line takeaway.
:::

:::glossary
- **Term**: what it means in everyday words, one sentence, no other jargon. Add a tiny analogy if it helps.
- **Another term**: its plain meaning.
:::
