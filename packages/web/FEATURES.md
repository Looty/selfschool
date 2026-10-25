# Web features: who owns what

Each screen is one lazy-loaded folder, `src/features/<name>/index.tsx` (default export = the routed component). **A screen session edits only its own folder** (new files inside it are fine). Everything else is shared and changes only through the wave-2 foundation owner.

| Folder | Routes | Screen (docs/ui.md) | Hooks to use |
|---|---|---|---|
| `features/dashboard/` | `/` | 6.1 Dashboard | `useDashboard` |
| `features/course/` | `/courses`, `/courses/:courseId` | 6.2 Course page (+ course list) | `useCourses`, `useCourse`, `useProposeExtension` |
| `features/lesson/` | `/courses/:courseId/lessons/:lessonId` | 6.3 Lesson, Contents menu, selection menu, grounded chat | `useLesson`, `useCompleteLesson`, `useChat`, `useAsk`, `useJob` |
| `features/quiz/` | `/courses/:courseId/quizzes/:quizId` | 6.4 Quiz | `useQuiz`, `useStartQuizAttempt`, `useSubmitAnswer`, `useFinishAttempt`, `useAttempt` |
| `features/exam/` | `/courses/:courseId/exams/:examId`, `…/take/:instanceId`, `/attempts`, `/attempts/:attemptId` | 6.5 Exam: info, take, result, regenerate, report; also the quiz result screen | `useExam`, `useStartExam`, `useRegenerateExam`, `useExamInstance`, `useAttempt`, `useReportQuestion` |
| `features/settings/` | `/settings` | 6.6 Settings | `useSettings`, `useUpdateSettings`, `usePackages`, `useAddPackage` |

Shared, not owned by a screen (propose changes, don't edit in passing):

- `src/ui/`: Button, Badge, ProgressBar, SectionLabel, CourseBand (+ Monogram), Segmented, Card, `cx`. Import from `../../ui`.
- `src/api/`: `client.ts` (typed `callApi`), `hooks.ts` (TanStack Query hooks), `mock/` (in-memory api).
- `src/App.tsx`, `src/Layout.tsx`, `src/components/` (header, theme toggle), `src/theme.ts`, `src/index.css` (tokens).
- `packages/shared/src/api.ts`: the HTTP contract. Needs a field that is missing? Ask; the api session implements against this file, so it must change in one place.

## Running against the mock

```bash
corepack pnpm --filter @selfschool/web dev:mock
```

`VITE_MOCK=1` (set by `--mode mock` via `.env.mock`) swaps the HTTP transport for an in-memory api seeded with the TypeScript course (5 / 12 lessons done, lesson 06 current, `q06` quiz, `mid` exam with a failed attempt and a provisional one with 2 pending answers). Responses are validated against the shared schemas either way, so a fixture that drifts from the contract fails loudly.

- `?ai=paused` in the URL simulates a stopped runner (`ai.available = false`, chat and open answers stay pending).
- Open answers grade ~3 s after submit; chat answers arrive ~1.5 s after asking. Poll with `useAttempt` / `useChat` (they already do).
- State resets on reload; `window.__mockReset()` resets it without one.
- Only the TypeScript course exists in the mock (other course ids appear in lists but 404 on detail).

## Conventions

- Hue: wrap a course's page in `data-hue={course.hue}` (`CourseBand` does it) and use `text-hue`, `bg-hue-bg`, `text-hue-ink`. Indigo (`accent`) is for tutor content only (docs/ui.md rule 2).
- Lesson markdown uses `:::low-confidence` and `:::key-takeaways` directive blocks and `[n]` citations (see `courses/typescript-fundamentals`); the lesson session renders them.
- Content widths: dashboard 1180, course 1120, lesson 940, quiz 720, exam 880, settings 880.
- No answer keys reach the browser except inside `AnswerResult` after submit (exams reveal only in the attempt result).
