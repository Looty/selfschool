# selfschool-course skill

`SKILL.md` is the whole skill; `templates/` holds a starter for every file type it writes. Nothing else is needed.

## Install

- **Claude Code:** copy this folder to `.claude/skills/selfschool-course/` in the Selfschool repository (or `~/.claude/skills/selfschool-course/` for every project). Ask: "teach me <topic>" or "use the selfschool-course skill to make a course on <topic>".
- **Claude.ai / Claude desktop:** zip this folder and upload it under Settings > Skills.
- **Other agents (Codex, Cursor, Gemini CLI, Copilot, ...):** keep the folder in the repository and point the agent's instruction file (`AGENTS.md`, `.cursor/rules`, `GEMINI.md`, ...) at it: "To author a course, read and follow `skill/SKILL.md`."
- **Plain chat model with no file access:** paste `SKILL.md` as the first message. It prints each file with its path; save them under `courses/<id>/` yourself.

## Where a course ends up

On your machine only. The skill writes one folder, `<id>/`, into your courses folder (the `selfschool-courses` repository next to the app), and a `<id>.zip` of it if you ask. Nothing is uploaded. The app reads the folder; unzip a zip first.

## What the model needs

Writing files and web search plus page fetch matter most. Without web search the skill refuses to present model memory as sourced fact (see "No web access" in `SKILL.md`). Commands (`pnpm school new-id`, `pnpm school validate`) are optional: the skill has manual fallbacks for both.

## Check a result

```
pnpm build                                  # once
pnpm school validate ../selfschool-courses/<id>   # the mechanical rules
```

Then open the app and read the first lesson and one quiz yourself: validation cannot tell whether a claim is true, only that it is cited.
