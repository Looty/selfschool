import type { HTMLAttributes } from "react";
import { cx } from "./cx";

/** Bordered 12px panel on --bg. Hairlines, no shadow. */
export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div {...rest} className={cx("rounded-card border border-border bg-bg", className)} />;
}
