import type { ReactNode, SVGProps } from "react";
import { Button } from "../../ui";

/** Icons shared by the dashboard, course and settings screens: 16px, 1.5 stroke, round caps, currentColor. */
const PATHS = {
  check: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12.5 2.5 2.5 4.5-5" />
    </>
  ),
  current: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3" fill="currentColor" />
    </>
  ),
  todo: <circle cx="12" cy="12" r="9" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  chevron: <path d="m6 9 6 6 6-6" />,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, ...rest }: { name: IconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      {PATHS[name]}
    </svg>
  );
}

/** Loading placeholder: a few skeleton bars, announced as busy. */
export function PageLoading({ what, width = 1180 }: { what: string; width?: number }) {
  return (
    <div className="mx-auto px-7 py-10" style={{ maxWidth: width }} role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading {what}…</span>
      <div aria-hidden className="flex animate-pulse flex-col gap-4">
        <div className="h-3 w-28 rounded bg-surface2" />
        <div className="h-8 w-64 rounded bg-surface2" />
        <div className="h-40 rounded-card bg-surface2" />
        <div className="h-24 rounded-card bg-surface2" />
      </div>
    </div>
  );
}

/** Error state with retry. */
export function PageError({ what, error, onRetry, width = 1180 }: { what: string; error: unknown; onRetry: () => void; width?: number }) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div className="mx-auto px-7 py-10" style={{ maxWidth: width }}>
      <div role="alert" className="flex flex-col items-start gap-3 rounded-card border border-border bg-bad-bg p-5">
        <div className="font-semibold text-bad">Could not load {what}</div>
        <div className="text-[13px] text-text2">{message}</div>
        <Button size="sm" onClick={onRetry}>
          Try again
        </Button>
      </div>
    </div>
  );
}

/** Warn-tinted inline notice (AI paused and similar). */
export function AiPausedNotice({ children }: { children: ReactNode }) {
  return (
    <div role="status" className="flex items-start gap-2 rounded-control bg-warn-bg px-3 py-2 text-[13px] text-warn">
      <Icon name="clock" className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}
