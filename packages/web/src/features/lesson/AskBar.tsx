import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { AlertIcon, ChatIcon, CloseIcon, SendIcon } from "./icons";
import { quotePreview } from "./selection";

/**
 * The pinned ask box: the only sticky element on the lesson screen. Collapsed to one row by
 * default; expands on click or when a selection is quoted, and hides again when focus leaves an
 * unused box. Disabled with an inline notice (expanded only) while the runner is down.
 */
export function AskBar({
  aiAvailable,
  answerCount,
  value,
  onChange,
  quote,
  onClearQuote,
  onSend,
  sending,
  error,
  inputRef,
  initiallyOpen = false,
}: {
  /** Starts expanded (tests); the app starts collapsed. */
  initiallyOpen?: boolean;
  aiAvailable: boolean;
  answerCount: number;
  value: string;
  onChange: (v: string) => void;
  quote: string | null;
  onClearQuote: () => void;
  onSend: () => void;
  sending: boolean;
  error?: string | null;
  inputRef?: RefObject<HTMLInputElement | null>;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const own = useRef<HTMLInputElement>(null);
  const field = inputRef ?? own;
  const root = useRef<HTMLDivElement>(null);
  const hide = useRef<HTMLButtonElement>(null);
  const busy = value.trim().length > 0 || !!quote || !!error || sending;
  const expanded = open || busy;
  const answers = `${answerCount} ${answerCount === 1 ? "answer" : "answers"}`;

  // A quoted selection opens the box; opening by button or quote puts the cursor in the input.
  useEffect(() => {
    if (quote) setOpen(true);
  }, [quote]);
  useEffect(() => {
    if (expanded) (aiAvailable ? field.current : hide.current)?.focus();
    // focus only on the collapsed -> expanded transition
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  const canSend = aiAvailable && !sending && value.trim().length > 0;
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (canSend) onSend();
    }
  };

  if (!expanded) {
    return (
      <div className="sticky bottom-0 z-20 border-t border-border2 bg-bg" style={{ boxShadow: "0 -8px 24px rgba(11, 18, 32, 0.06)" }}>
        <div className="mx-auto box-border flex max-w-[calc(940px*var(--content-scale,1))] items-center gap-2 px-7 py-1">
          <button
            type="button"
            aria-expanded={false}
            onClick={() => setOpen(true)}
            className="tutor flex min-w-0 grow cursor-pointer items-center gap-2 rounded-control border-0 bg-transparent px-0 py-1 text-left font-sans text-[13px] text-text2"
          >
            <span className="flex text-accent">
              <ChatIcon />
            </span>
            <span className="min-w-0 grow truncate">Ask about this lesson{aiAvailable ? "" : " (paused)"}</span>
            {!aiAvailable ? (
              <span className="flex text-warn" title="AI is paused">
                <AlertIcon />
              </span>
            ) : null}
          </button>
          <a href="#thread" className="whitespace-nowrap rounded-full bg-accent-soft px-2 py-px text-xs text-accent no-underline">
            {answers} ↓
          </a>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={root}
      className="sticky bottom-0 z-20 border-t border-border2 bg-bg"
      style={{ boxShadow: "0 -8px 24px rgba(11, 18, 32, 0.06)" }}
      onBlur={(e) => {
        // auto-hide when focus leaves an unused box
        if (!root.current?.contains(e.relatedTarget as Node | null) && !busy) setOpen(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !busy) setOpen(false);
      }}
    >
      <div className="mx-auto box-border flex max-w-[calc(940px*var(--content-scale,1))] flex-col gap-2.5 px-7 pb-4 pt-3">
        {!aiAvailable ? (
          <div role="status" className="flex items-center gap-2.5 rounded-control bg-warn-bg px-3 py-2 text-[13px] text-text">
            <span className="flex text-warn">
              <AlertIcon />
            </span>
            <span className="min-w-0 grow">
              AI is paused. Chat and grading resume when you start the runner with <code className="font-mono text-[0.92em]">school up</code>.
            </span>
            <button ref={hide} type="button" onClick={() => setOpen(false)} aria-label="Hide ask box" className="flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded border-0 bg-transparent text-text2">
              <CloseIcon />
            </button>
          </div>
        ) : null}
        {error ? (
          <div role="alert" className="rounded-control bg-bad-bg px-3 py-2 text-[13px] text-bad">
            {error}
          </div>
        ) : null}
        {quote ? (
          <div className="flex items-start gap-2 rounded-control border border-border bg-accent-soft px-3 py-1.5 text-[13px] text-text2">
            <span className="min-w-0 grow">
              <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-accent">Asking about</span> “{quotePreview(quote)}”
            </span>
            <button type="button" onClick={onClearQuote} aria-label="Remove quoted selection" className="tutor flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded border-0 bg-transparent text-text2">
              <CloseIcon />
            </button>
          </div>
        ) : null}
        <form
          className="flex items-center gap-2.5 rounded-card border border-border2 bg-surface py-2 pl-3.5 pr-2 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSend) onSend();
          }}
        >
          <span className="flex text-accent">
            <ChatIcon />
          </span>
          <label htmlFor="lesson-ask" className="visually-hidden">
            Ask about this lesson
          </label>
          <input
            ref={inputRef}
            id="lesson-ask"
            type="text"
            autoComplete="off"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={!aiAvailable}
            placeholder={aiAvailable ? "Ask about this lesson" : "Ask about this lesson (paused)"}
            className="ask-input min-w-0 grow border-0 bg-transparent py-1.5 font-sans text-[15px] text-text outline-none placeholder:text-text3 focus-visible:outline-none disabled:cursor-not-allowed"
          />
          <a href="#thread" className="whitespace-nowrap rounded-full bg-accent-soft px-2.5 py-[3px] text-xs text-accent no-underline">
            {answers} ↓
          </a>
          <button
            type="submit"
            aria-label="Send"
            disabled={!canSend}
            className="flex h-[34px] w-[34px] shrink-0 cursor-pointer items-center justify-center rounded-control border-0 bg-primary text-primary-fg disabled:cursor-not-allowed disabled:opacity-50"
          >
            <SendIcon />
          </button>
        </form>
      </div>
    </div>
  );
}
