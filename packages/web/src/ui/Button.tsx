import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Link } from "react-router-dom";
import { cx } from "./cx";

type Variant = "primary" | "secondary" | "tutor";
type Size = "sm" | "md" | "lg";

const VARIANT: Record<Variant, string> = {
  // Ink primary; indigo only for tutor actions ("Ask about this").
  primary: "bg-primary text-primary-fg border border-transparent",
  secondary: "bg-bg text-text border border-border2",
  tutor: "bg-bg text-accent border border-border2 tutor",
};
const SIZE: Record<Size, string> = {
  sm: "h-[30px] px-3 text-[13px] rounded-control",
  md: "h-[34px] px-3.5 text-[13px] rounded-control",
  lg: "h-10 px-[18px] text-sm rounded-button",
};

interface Common {
  variant?: Variant;
  size?: Size;
  className?: string;
  children?: ReactNode;
}

export type ButtonProps = Common &
  (({ to: string } & { onClick?: never; type?: never; disabled?: never }) | ({ to?: undefined } & ButtonHTMLAttributes<HTMLButtonElement>));

/** Button, or a router Link styled as one when `to` is given. */
export function Button(props: ButtonProps) {
  const { variant = "secondary", size = "md", className, children } = props;
  const cls = cx(
    "inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap font-medium no-underline disabled:cursor-not-allowed disabled:opacity-50",
    VARIANT[variant],
    SIZE[size],
    className,
  );
  if (props.to !== undefined) {
    return (
      <Link to={props.to} className={cls}>
        {children}
      </Link>
    );
  }
  const { variant: _v, size: _s, className: _c, children: _ch, to: _t, ...rest } = props;
  return (
    <button type="button" {...rest} className={cls}>
      {children}
    </button>
  );
}
