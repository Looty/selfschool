# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Read plan.md. It is the design record (format, data model, flows, decisions); README.md covers setup and usage.

## Git

Never commit or push unless the user asks in that message. Commit with the repo-local GitHub noreply identity (already configured here and in `../selfschool-courses`); the global email is private and GitHub rejects pushes that carry it. No personal data (names, emails, local paths) in files.

## Commands

pnpm workspace; Node >= 22. Dev runs in Docker, tests and the CLI run on the host.

```bash
docker compose up -d --build     # api (:3001) + web (:5174) in containers
docker compose restart api       # REQUIRED after changing API code: tsx watch misses bind-mount changes on Windows
pnpm test                        # all packages (vitest); pnpm typecheck; pnpm build
pnpm --filter @selfschool/api test                 # one package
pnpm --filter @selfschool/api exec vitest run test/catalog.lazy.test.ts   # one file (add -t "name" for one test)
pnpm --filter @selfschool/web dev:mock             # web against a mock API (no Docker); preview config in .claude/launch.json
pnpm --filter @selfschool/api stress [-- --courses N | --live | --clean]  # 100-course load test, opt-in, self-cleaning
pnpm school validate <course folder>               # the format validator (needs `pnpm build` once)
```

Lint is Biome (`pnpm lint`, no formatter on purpose: no mass reformat). It exits non-zero only on errors; warnings are known debt (non-null `!` is allowed, `any`, a11y and hook-dependency findings are warnings), so do not add new ones in code you touch. `pnpm typecheck` must be clean before you hand work back. CI (`.github/workflows/ci.yml`, on every pull request) runs build, lint, typecheck and test in that order, so run the same four locally before opening a PR. After editing `packages/shared`, run `pnpm --filter @selfschool/shared build`: the api and cli consume its `dist`, the web app reads its `src`.

## TypeScript conventions

- `tsconfig.base.json` is strict plus `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, NodeNext. So: relative imports end in `.js` (also in tests), type-only imports use `import type`, and indexed access gives `T | undefined`.
- Validate at the boundary with zod and infer types from the schema (`z.infer`); do not hand-write a second type for something a schema in `packages/shared` already defines. Request/response shapes go in `shared/src/api.ts` so api and web cannot drift.
- Prefer `unknown` plus narrowing over `any`. Throw `HttpError` (api) for expected failures; never swallow errors silently.
- Ship small: keep changes scoped to the ask, no speculative abstractions or config. Run the touched package's tests and `pnpm typecheck`; run the full `pnpm test` before you say it is done.
- Tests live beside the code they cover (`test/` in api, shared, runner, cli; `*.test.ts(x)` next to the source in web). Add a test for new behaviour and for every bug you fix, and never loosen an existing assertion to get green.

## Architecture

- **Content in files, state in SQLite.** Courses are plain-file packages (`course.yaml`, `sources.md`, `NN-chapter/lesson-NN.md` + `quiz-NN.yaml`, `exams/`, `resources/`). Progress, attempts, the question bank and jobs live in SQLite (Drizzle, `packages/api/src/db`). They never mix. Courses are NOT in this repo: they live in the sibling repo `../selfschool-courses`, mounted into the api container at `/courses` (`COURSES_PATH`, `SELFSCHOOL_COURSES_DIR`). `examples/` holds fixtures used by tests.
- **`packages/shared`** is the contract: zod schemas for the course format (`course.ts`), every API request/response (`api.ts`), and the validator (`validate.ts`, run by `school validate`, on every package fetch and in tests). The authoring brief given to AI agents is generated from the same rules (`brief.ts`, `questionTypes.ts`). A new question type must be registered in `questionTypes.ts` (compile-time checked) and touches schema, validator, web input and grading.
- **`packages/api`** (Hono): `catalog.ts` scans the courses folder and is the performance-critical part. It keeps per-course entries with fingerprints, refreshes in the background (stale-while-revalidate, async walk, adaptive re-check), loads lesson bodies lazily (LRU), and persists a disk cache (`catalogCache.ts`). Summary endpoints read the light part (`course.light`) and `summaryCache.ts`; never touch `course.lessons`/`quizzes` on those paths. `ctx.ts` pins lesson revisions and loads authored questions into the bank when content changes. `packages.ts` imports courses (git clone, zip, local folder; multi-course repos return `choices`).
- **`packages/runner`** runs on the host, not in Docker, because it shells out to the user's logged-in Claude CLI. It polls the api's job queue (chat, grading, question generation, verification). The app works without it ("AI is paused"). `packages/cli` is the `school` command (`up`, `down`, `doctor`, `new-id`, `validate`).
- **`packages/web`** (React 19, Vite, Tailwind, TanStack Query) talks to the api through typed `callApi` from the shared schemas. `VITE_MOCK` swaps in `src/api/mock` handlers. Layout follows `docs/ui.md`. Reader preferences (theme, font, content width, text size) are CSS variables set on `<html>` and stored in localStorage (`selfschool-*` keys), see `features/settings/prefs.ts`. Glossary terms in lessons become hover tooltips via a remark plugin (`features/lesson/glossary.ts`).
- **`skill/`** is the course-authoring skill (`SKILL.md` plus templates). Changing the course format means updating the shared validator, the templates, `SKILL.md` and `brief.ts` together.
- **Extensions** (extra chapters a user adds) go to `extensions/<course-id>/`, never into the package; the catalog merges them as level 2.

Windows host with a bind-mounted repo: file watching in the container is unreliable and file walks are slow, which is why the catalog polls and caches instead of watching.
