import type { ReactNode } from "react";
import { CodeBlock as SharedCodeBlock } from "../../components/code/CodeBlock";
import { cx } from "../../ui";
import type { Pill } from "./state";

/** Question text and explanations use `backticks` for inline code. */
export function Inline({ text }: { text: string }): ReactNode {
  return text.split(/(`[^`]+`)/g).map((part, i) =>
    part.startsWith("`") && part.endsWith("`") && part.length > 2 ? (
      <code key={i} className="font-mono text-[0.9em]">
        {part.slice(1, -1)}
      </code>
    ) : (
      part
    ),
  );
}

/** Question code is highlighted like lesson code. Questions carry no language, so TypeScript is assumed. */
export function CodeBlock({ code, lang = "ts" }: { code: string; lang?: string }) {
  return <SharedCodeBlock code={code} lang={lang} />;
}

const PILL_TONE: Record<Pill["tone"], string> = {
  neutral: "bg-surface2 text-text2",
  ok: "bg-ok-bg text-ok",
  bad: "bg-bad-bg text-bad",
  warn: "bg-warn-bg text-warn",
  hue: "bg-hue-bg text-hue-ink",
  accent: "bg-accent-soft text-accent",
};

/** Status pill from the boards: 12px, 1px 9px padding, weight 500 (mono for point totals). */
export function StatusPill({ pill, className }: { pill: Pick<Pill, "tone" | "label" | "mono">; className?: string }) {
  return (
    <span className={cx("inline-flex items-center whitespace-nowrap rounded-full px-[9px] py-px text-xs font-medium", pill.mono && "font-mono", PILL_TONE[pill.tone], className)}>
      {pill.label.startsWith("Grading…") ? <span className="spinner mr-1.5 text-[0.9em]" aria-hidden="true" /> : null}
      {pill.label}
    </span>
  );
}

/** Mono 11px uppercase label used inside cards (not the ruled SectionLabel). */
export const monoLabel = "font-mono text-[11px] uppercase tracking-[0.08em] text-text3";
