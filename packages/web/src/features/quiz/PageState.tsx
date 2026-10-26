import type { ReactNode } from "react";
import { textDirection } from "../../api/language";
import { Button, cx } from "../../ui";
import { InfoIcon } from "./icons";

/** Full-page frame shared by quiz and exam screens: bg-bg below the 56px header. */
export function Page({ children }: { children: ReactNode }) {
  return <div className="min-h-[calc(100vh-56px)] bg-bg">{children}</div>;
}

export function Narrow({ width, children, className, language }: { width: number; children: ReactNode; className?: string; language?: string | undefined }) {
  return (
    <div dir={textDirection(language)} lang={language} className={cx("mx-auto flex flex-col gap-6 px-4 pb-14 pt-7 sm:px-7", className)} style={{ maxWidth: width }}>
      {children}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("animate-pulse rounded bg-surface2", className)} aria-hidden="true" />;
}

/** Loading placeholder: a band-height block and a card, announced politely. */
export function LoadingPage({ width, label }: { width: number; label: string }) {
  return (
    <Page>
      <div role="status" aria-live="polite" aria-busy="true">
        <span className="sr-only">{label}</span>
        <div className="h-[75px] border-b border-border bg-surface" aria-hidden="true" />
        <Narrow width={width}>
          <Skeleton className="h-7 w-1/2" />
          <div className="flex flex-col gap-3.5 rounded-card border border-border p-5" aria-hidden="true">
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-5 w-4/5" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        </Narrow>
      </div>
    </Page>
  );
}

export function ErrorPage({ width, title, message, onRetry, backTo, backLabel }: { width: number; title: string; message: string; onRetry?: () => void; backTo?: string; backLabel?: string }) {
  return (
    <Page>
      <Narrow width={width}>
        <div role="alert" className="flex flex-col gap-3 rounded-card border border-border p-5">
          <div className="flex items-center gap-2 font-semibold text-bad">
            <InfoIcon />
            {title}
          </div>
          <p className="m-0 text-[13px] text-text2">{message}</p>
          <div className="flex gap-2">
            {onRetry ? <Button onClick={onRetry}>Try again</Button> : null}
            {backTo ? <Button to={backTo}>{backLabel ?? "Back"}</Button> : null}
          </div>
        </div>
      </Narrow>
    </Page>
  );
}

export function Notice({ tone = "warn", children }: { tone?: "warn" | "neutral"; children: ReactNode }) {
  return (
    <div role="note" className={cx("flex items-start gap-2 rounded-lg px-3 py-2.5 text-[13px]", tone === "warn" ? "bg-warn-bg text-warn" : "border border-border bg-surface text-text2")}>
      <InfoIcon />
      <span>{children}</span>
    </div>
  );
}

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");
