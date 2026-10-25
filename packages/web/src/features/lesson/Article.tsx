import { useMemo, useRef } from "react";
import type { Lesson } from "@selfschool/shared";
import { Link, useNavigate } from "react-router-dom";
import { InlineMarkdown } from "../../components/InlineMarkdown";
import { Button, SectionLabel } from "../../ui";
import { DownloadIcon } from "./icons";
import { Markdown } from "./MarkdownView";
import { glossaryEntries, parseGlossary, unmatchedLines } from "./glossary";
import { parseBlocks } from "./markdown";
import { SelectionMenu } from "./SelectionMenu";

const monoLabel = "font-mono text-[11px] font-medium uppercase tracking-[0.08em]";
const pagerCard = "flex min-w-0 flex-col gap-1 rounded-card border border-border px-5 py-4 text-text no-underline";

/**
 * A printed-book sidebar, clearly apart from the running text: UI sans at a smaller size under a bold
 * title, on a panel of its own. "In brief" is the inverted (ink) panel; the caution note is warm-tinted.
 */
function Sidebar({ label, panel, children }: { label: string; panel: string; children: React.ReactNode }) {
  return (
    <aside role="note" aria-label={label} className={`lesson-callout rounded-[6px] px-7 pb-5 pt-5 font-sans ${panel}`}>
      <div className="mb-2 text-[calc(17px*var(--prose-scale,1))] font-semibold tracking-[-0.01em]">{label}</div>
      <div className="text-[calc(15px*var(--prose-scale,1))] leading-[1.6]">{children}</div>
    </aside>
  );
}

export function LowConfidence({ text, sources }: { text: string; sources: ReadonlySet<number> }) {
  return (
    <Sidebar label="Heads up" panel="border border-warn bg-warn-bg text-text [&>div:first-child]:text-warn">
      <Markdown text={text} sources={sources} />
    </Sidebar>
  );
}

export function KeyTakeaways({ text, sources }: { text: string; sources: ReadonlySet<number> }) {
  return (
    <div className="lesson-takeaways">
      <Sidebar label="In brief" panel="lesson-ink">
        <Markdown text={text} sources={sources} />
      </Sidebar>
    </div>
  );
}

/** Glossary terms that never appear in the prose (so nothing in the text carries their meaning): a native collapsible list. */
export function UnusedTerms({ terms }: { terms: ReadonlyArray<{ term: string; meaning: string }> }) {
  if (terms.length === 0) return null;
  return (
    <details className="lesson-unused-terms rounded-card border border-border px-5 py-3 font-sans text-[calc(14px*var(--prose-scale,1))] text-text2">
      <summary className="cursor-pointer font-medium text-text">More terms from this lesson ({terms.length})</summary>
      <ul className="m-0 mt-2 flex list-none flex-col gap-1.5 p-0">
        {terms.map((t) => (
          <li key={t.term}>
            <strong className="text-text">{t.term}</strong>: {t.meaning}
          </li>
        ))}
      </ul>
    </details>
  );
}

export function Article({
  lesson,
  fontFamily,
  onAsk,
  onComplete,
  onNext,
  completing,
}: {
  lesson: Lesson;
  fontFamily: string;
  onAsk: (quote: string) => void;
  onComplete: () => void;
  /** Completes a quiz-less lesson, then goes to the next one. */
  onNext: () => void;
  completing: boolean;
}) {
  const prose = useRef<HTMLDivElement>(null);
  const known = useMemo(() => new Set(lesson.sources.map((s) => s.n)), [lesson.sources]);
  const blocks = useMemo(() => parseBlocks(lesson.markdown), [lesson.markdown]);
  const lines = useMemo(() => blocks.filter((b) => b.kind === "glossary").flatMap((b) => parseGlossary(b.text)), [blocks]);
  const glossary = useMemo(() => glossaryEntries(lines), [lines]);
  const unused = useMemo(
    () => unmatchedLines(lines, [lesson.standfirst, ...blocks.filter((b) => b.kind === "markdown").map((b) => b.text)].join("\n")),
    [lines, blocks, lesson.standfirst],
  );
  const courseId = lesson.course.id;
  const navigate = useNavigate();
  const locked = Boolean(lesson.quiz) && !lesson.completed;

  return (
    <article className="lesson-article mx-auto box-border w-full max-w-[calc(940px*var(--content-scale,1))] grow px-7 pb-14 pt-11" aria-labelledby="lesson-title">
      <div className={`${monoLabel} font-normal text-text3`}>
        Lesson {String(lesson.number).padStart(2, "0")} · {lesson.minutes} min read · revision {lesson.revision}
      </div>
      <h1 id="lesson-title" className="mb-3.5 mt-2.5 text-[clamp(30px,5vw,40px)] font-semibold leading-[1.12] tracking-[-0.025em]">
        {lesson.lesson.title}
      </h1>
      <div className="mb-8 max-w-[78ch] text-[calc(19px*var(--prose-scale,1))] leading-[1.55] text-text2 [&_p]:m-0">
        <Markdown text={lesson.standfirst} sources={known} glossary={glossary} />
      </div>

      <div ref={prose} className="lesson-prose" style={{ fontFamily }}>
        {blocks.map((b, i) =>
          b.kind === "low-confidence" ? (
            <LowConfidence key={i} text={b.text} sources={known} />
          ) : b.kind === "key-takeaways" ? (
            <KeyTakeaways key={i} text={b.text} sources={known} />
          ) : b.kind === "glossary" ? null : (
            <Markdown key={i} text={b.text} sources={known} glossary={glossary} />
          ),
        )}
        <UnusedTerms terms={unused} />
      </div>
      <SelectionMenu containerRef={prose} onAsk={onAsk} />

      {/* A lesson with a quiz is a gate: the quiz comes before the next lesson until it is passed. */}
      <nav aria-label="Lesson navigation" className="mt-10 flex flex-col gap-3">
        {lesson.quiz ? (
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-card border border-border bg-surface px-5 py-4">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className={`${monoLabel} font-normal text-text3`}>Quiz · {lesson.quiz.questionCount} {lesson.quiz.questionCount === 1 ? "question" : "questions"}</span>
              <span className="text-[15px] font-medium">{locked ? "Pass it to unlock the next lesson" : "Passed: the next lesson is open"}</span>
            </div>
            <Button variant={locked ? "primary" : "secondary"} to={`/courses/${courseId}/quizzes/${lesson.quiz.id}`}>
              {locked ? "Take the quiz" : "Retake quiz"}
            </Button>
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          {lesson.prev ? (
            <Link to={`/courses/${courseId}/lessons/${lesson.prev.id}`} className={`${pagerCard} hover:border-border2 hover:bg-surface`}>
              <span className={`${monoLabel} font-normal text-text3`}>← Previous</span>
              <span className="text-[15px] font-medium leading-snug">{lesson.prev.title}</span>
            </Link>
          ) : (
            <div className="hidden sm:block" />
          )}
          {lesson.next ? (
            locked ? (
              <div className={`${pagerCard} cursor-not-allowed items-end text-right opacity-60`} aria-disabled="true">
                <span className={`${monoLabel} font-normal text-text3`}>Next · locked</span>
                <span className="text-[15px] font-medium leading-snug">{lesson.next.title}</span>
              </div>
            ) : lesson.completed ? (
              <Link to={`/courses/${courseId}/lessons/${lesson.next.id}`} className={`${pagerCard} items-end border-text text-right hover:bg-surface`}>
                <span className={`${monoLabel} font-normal text-text3`}>Next →</span>
                <span className="text-[15px] font-medium leading-snug">{lesson.next.title}</span>
              </Link>
            ) : (
              <button type="button" onClick={onNext} disabled={completing} className={`${pagerCard} cursor-pointer items-end border-text bg-transparent text-right font-[inherit] hover:bg-surface disabled:opacity-60`}>
                <span className={`${monoLabel} font-normal text-text3`}>Next →</span>
                <span className="text-[15px] font-medium leading-snug">{lesson.next.title}</span>
              </button>
            )
          ) : lesson.completed || locked ? (
            <Link to={`/courses/${courseId}`} className={`${pagerCard} items-end text-right hover:border-border2 hover:bg-surface`}>
              <span className={`${monoLabel} font-normal text-text3`}>End of course</span>
              <span className="text-[15px] font-medium leading-snug">Back to the course</span>
            </Link>
          ) : (
            // The last lesson has no "next" to carry completion, so finishing it is this card.
            <button
              type="button"
              disabled={completing}
              onClick={() => {
                onComplete();
                navigate(`/courses/${courseId}`);
              }}
              className={`${pagerCard} cursor-pointer items-end border-text bg-transparent text-right font-[inherit] hover:bg-surface disabled:opacity-60`}
            >
              <span className={`${monoLabel} font-normal text-text3`}>End of course</span>
              <span className="text-[15px] font-medium leading-snug">Finish and go to the course</span>
            </button>
          )}
        </div>
      </nav>

      {lesson.sources.length > 0 ? (
        <section id="sources" aria-label="Sources" className="mt-10 border-t border-border pt-4 text-[13px] text-text2">
          <h2 className={`m-0 mb-1 ${monoLabel} font-normal text-text3`}>Sources</h2>
          <ol className="m-0 flex list-none flex-col gap-0.5 p-0">
            {lesson.sources.map((s) => (
              <li key={s.n} id={`source-${s.n}`} className="lesson-source scroll-mt-6 px-1 py-0.5">
                [{s.n}]{" "}
                {s.url ? (
                  <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-text underline decoration-border2 underline-offset-2">
                    <InlineMarkdown text={s.title} />
                  </a>
                ) : (
                  <InlineMarkdown text={s.title} />
                )}
                {s.note ? (
                  <span className="text-text3">
                    {" · "}
                    <InlineMarkdown text={s.note} />
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {lesson.resources.length > 0 ? (
        <section aria-label="Resources" className="mt-6">
          <SectionLabel>Resources</SectionLabel>
          <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0 text-sm">
            {lesson.resources.map((r) => (
              <li key={r.url}>
                <a href={r.url} download className="inline-flex items-center gap-2 text-text no-underline hover:underline">
                  <span className="text-text3">
                    <DownloadIcon />
                  </span>
                  {r.name}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

    </article>
  );
}
