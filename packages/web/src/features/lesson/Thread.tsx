import type { ChapterOutline, ChatMessage } from "@selfschool/shared";
import { Link } from "react-router-dom";
import { Button } from "../../ui";
import { Markdown } from "./MarkdownView";
import { citationHref } from "./selection";

export type ProposeState = "idle" | "pending" | "done" | "error";

const NOT_COVERED = "Not covered in this course.";

/** User messages sent with a selection are stored as `“quote”\n\nquestion`. */
export function splitQuote(content: string): { quote: string | null; question: string } {
  const m = /^“([\s\S]*?)”\n\n([\s\S]*)$/.exec(content);
  return m ? { quote: m[1]!, question: m[2]! } : { quote: null, question: content };
}

export function Thread({
  courseId,
  chapters,
  messages,
  aiAvailable,
  sources,
  loading,
  error,
  onRetry,
  proposeState,
  onPropose,
  unverified = false,
}: {
  courseId: string;
  chapters: ChapterOutline[];
  messages: ChatMessage[];
  /** The lesson was written by the model, so answers that cite it are unverified too. */
  unverified?: boolean;
  aiAvailable: boolean;
  sources: ReadonlySet<number>;
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
  proposeState: (m: ChatMessage) => ProposeState;
  onPropose: (m: ChatMessage, question: string) => void;
}) {
  const answers = messages.filter((m) => m.role === "assistant" && m.status === "done").length;

  return (
    <section id="thread" aria-label="Conversation about this lesson" className="scroll-mt-4 border-t border-border bg-surface">
      <div className="mx-auto box-border flex max-w-[calc(940px*var(--content-scale,1))] flex-col gap-4 px-7 pb-12 pt-9">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border2 pb-2.5">
          <h2 className="m-0 font-mono text-[11px] font-normal uppercase tracking-[0.08em] text-text3">
            Ask about this lesson · {answers} {answers === 1 ? "answer" : "answers"}
          </h2>
          <span className="text-[13px] text-text3">Course answers cite lessons and sources; anything else is labelled.</span>
        </div>

        {loading ? (
          <p role="status" className="m-0 text-text3">
            Loading conversation…
          </p>
        ) : error ? (
          <div role="alert" className="flex items-center gap-3 text-text2">
            <span>Couldn't load the conversation.</span>
            {onRetry ? (
              <Button size="sm" onClick={onRetry}>
                Retry
              </Button>
            ) : null}
          </div>
        ) : messages.length === 0 ? (
          <p className="m-0 text-text2">No questions yet. Ask below, or select text in the lesson and choose “Ask about this”.</p>
        ) : (
          <div className="flex flex-col gap-4" aria-live="polite" aria-relevant="additions text">
            {messages.map((m, i) => {
              if (m.role === "user") return <UserBubble key={m.id} content={m.content} />;
              const prev = messages[i - 1];
              const question = prev?.role === "user" ? splitQuote(prev.content).question : "";
              return (
                <Answer key={m.id} m={m} courseId={courseId} chapters={chapters} aiAvailable={aiAvailable} sources={sources} unverified={unverified} proposeState={proposeState(m)} onPropose={() => onPropose(m, question)} />
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function UserBubble({ content }: { content: string }) {
  const { quote, question } = splitQuote(content);
  return (
    <div className="max-w-[70%] self-end rounded-[12px_12px_4px_12px] bg-primary px-3.5 py-2.5 text-primary-fg max-sm:max-w-[88%]">
      {quote ? <blockquote className="m-0 mb-1.5 border-l-2 border-current pl-2.5 text-[13px] opacity-80">{quote}</blockquote> : null}
      <span className="whitespace-pre-wrap break-words">{question}</span>
    </div>
  );
}

function Answer({
  m,
  courseId,
  chapters,
  aiAvailable,
  sources,
  unverified,
  proposeState,
  onPropose,
}: {
  m: ChatMessage;
  courseId: string;
  chapters: ChapterOutline[];
  aiAvailable: boolean;
  sources: ReadonlySet<number>;
  unverified: boolean;
  proposeState: ProposeState;
  onPropose: () => void;
}) {
  const box = "flex flex-col gap-2.5 rounded-card border border-border bg-accent-soft px-4 py-3.5 leading-[1.65] text-text";

  if (m.status === "pending" && m.partial) {
    // the answer is being written: show it as it grows; citations are checked when it is final
    return (
      <div className={box} data-state="streaming" aria-busy="true">
        <div className="lesson-chat">
          <Markdown text={m.partial} sources={sources} />
        </div>
        <span className="flex items-center gap-2 text-xs text-text3">
          <span aria-hidden className="spinner text-accent" />
          Still writing. Citations are added when the answer is done.
        </span>
      </div>
    );
  }
  if (m.status === "pending") {
    return (
      <div className={box} role="status" aria-label="Tutor is answering" data-state="pending">
        <span className="flex items-center gap-2 text-text2">
          <span aria-hidden className="spinner text-accent" />
          {aiAvailable ? "Looking through the lessons and sources…" : "Waiting for the runner. Your question is queued."}
        </span>
        <div aria-hidden className="flex flex-col gap-2">
          <span className="shimmer block h-2.5 w-3/5 rounded [--shimmer-base:color-mix(in_srgb,var(--accent)_16%,transparent)] [--shimmer-hi:color-mix(in_srgb,var(--accent)_34%,transparent)]" />
          <span className="shimmer block h-2.5 w-2/5 rounded [--shimmer-base:color-mix(in_srgb,var(--accent)_16%,transparent)] [--shimmer-hi:color-mix(in_srgb,var(--accent)_34%,transparent)]" />
        </div>
      </div>
    );
  }
  if (m.status === "failed") {
    return (
      <div className={box} role="alert" data-state="failed">
        <span className="font-semibold">The tutor couldn't answer.</span>
        <span className="text-text2">The job failed. Ask the question again.</span>
      </div>
    );
  }

  if (m.covered === false) {
    const reason = m.content.startsWith(NOT_COVERED) ? m.content.slice(NOT_COVERED.length).trim() : m.content;
    return (
      <div className={box} data-state="not-covered">
        <span className="font-semibold">{NOT_COVERED}</span>
        {reason ? (
          <>
            <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-text3">From the model's general knowledge · not from the course, unverified</span>
            <div className="lesson-chat text-text2">
              <Markdown text={reason} sources={sources} />
            </div>
          </>
        ) : null}
        <span>
          {proposeState === "done" ? (
            <span role="status" className="text-sm text-text2">
              Proposed. The outline is being drafted; check the course page.
            </span>
          ) : (
            <>
              <Button size="sm" onClick={onPropose} disabled={proposeState === "pending"} className="h-8 text-text">
                {proposeState === "pending" ? "Proposing…" : "Propose as extension"}
              </Button>
              {proposeState === "error" ? (
                <span role="alert" className="ml-3 text-sm text-bad">
                  Couldn't propose. Try again.
                </span>
              ) : null}
            </>
          )}
        </span>
      </div>
    );
  }

  return (
    <div className={box} data-state="answer">
      {unverified ? (
        <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-text3">Unverified · this lesson was written by the model, not researched</span>
      ) : null}
      <div className="lesson-chat">
        <Markdown text={m.content} sources={sources} />
      </div>
      {m.citations.length > 0 ? (
        <ul aria-label="Citations" className="m-0 flex list-none flex-wrap gap-1.5 p-0">
          {m.citations.map((c) => (
            <li key={`${c.kind}:${c.ref}`}>
              <CitationChip href={citationHref(c, courseId, chapters)} label={c.label} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function CitationChip({ href, label }: { href: string; label: string }) {
  const cls = "tutor inline-block rounded-full border border-border2 bg-bg px-2 py-0.5 text-xs text-accent no-underline";
  return href.startsWith("/") ? (
    <Link to={href} className={cls}>
      {label}
    </Link>
  ) : (
    <a href={href} className={cls}>
      {label}
    </a>
  );
}
