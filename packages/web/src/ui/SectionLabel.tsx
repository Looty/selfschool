import type { ReactNode } from "react";
import { cx } from "./cx";

/** Mono uppercase section header: label left, optional meta right, border2 rule below. */
export function SectionLabel({ children, meta, className }: { children: ReactNode; meta?: ReactNode; className?: string }) {
  return (
    <div className={cx("flex items-baseline justify-between gap-3 border-b border-border2 pb-2.5", className)}>
      <h2 className="m-0 font-mono text-[11px] font-normal uppercase tracking-[0.08em] text-text3">{children}</h2>
      {meta ? <div className="text-xs text-text3">{meta}</div> : null}
    </div>
  );
}
