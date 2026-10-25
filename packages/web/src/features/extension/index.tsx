import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { DEPTH_OPTIONS, formatDuration, plannedMinutes, type ExtensionView } from "@selfschool/shared";
import { useDecideExtension, useExtension, useExtensionBrief, useGenerateExtension, useRedraftExtension, useResumeExtension } from "../../api/hooks";
import { InlineMarkdown } from "../../components/InlineMarkdown";
import { Badge, Button, ProgressBar, Segmented, cx } from "../../ui";
import { ErrorPage, LoadingPage, Narrow, Notice, Page, errorMessage } from "../quiz/PageState";
import { canApprove, includedCount, toDraft, toOutline, type Draft } from "./logic";

const mono = "font-mono text-[11px] uppercase tracking-[0.08em] text-text3";
const depthLabel = (minutes: number) => DEPTH_OPTIONS.find((d) => d.minutes === minutes)?.label ?? formatDuration(minutes);
const field ="h-9 w-full min-w-0 rounded-control border border-border2 bg-bg px-2.5 text-sm text-text";

/** `/courses/:courseId/extensions/:extensionId`: review a drafted Level 2 outline, edit it, approve or reject. */
export default function ExtensionPage() {
  const { courseId = "", extensionId = "" } = useParams();
  const ext = useExtension(extensionId);

  if (ext.isError) return <ErrorPage width={880} title="Could not load this proposal" message={errorMessage(ext.error)} onRetry={() => void ext.refetch()} backTo={`/courses/${courseId}`} backLabel="Back to the course" />;
  if (!ext.data) return <LoadingPage width={880} label="Loading proposal" />;
  const e = ext.data;

  return (
    <Page>
      <Narrow width={880}>
        <Link to={`/courses/${courseId}`} className="w-fit text-[13px] text-text2 underline underline-offset-2">
          Back to the course
        </Link>
        {e.status === "drafting" ? <Drafting e={e} /> : e.status === "failed" ? <Failed e={e} courseId={courseId} /> : e.outline ? <Review key={`${e.id}:${e.jobId}`} e={e} courseId={courseId} /> : <Empty e={e} courseId={courseId} />}
      </Narrow>
    </Page>
  );
}

function Seed({ e }: { e: ExtensionView }) {
  const { topic, question, fromLesson } = e.seed;
  const asked = question ?? topic;
  if (!asked) return null;
  return (
    <p className="m-0 text-[13px] text-text2">
      Started from {question ? "your question" : "your topic"}: <span className="text-text">“{asked}”</span>
      {fromLesson ? (
        <>
          {" "}
          in{" "}
          <Link to={`/courses/${e.courseId}/lessons/${fromLesson.id}`} className="text-text underline underline-offset-2">
            {fromLesson.title}
          </Link>
        </>
      ) : null}
    </p>
  );
}

function Drafting({ e }: { e: ExtensionView }) {
  return (
    <>
      <div className="flex flex-col gap-1">
        <span className={mono}>Level 2 proposal</span>
        <h1 className="m-0 text-[24px] font-semibold tracking-[-0.02em]">Drafting an outline</h1>
        <Seed e={e} />
      </div>
      <div role="status" className="flex flex-col gap-3 rounded-card border border-border bg-accent-soft p-5" data-state="drafting">
        <span className="flex items-center gap-2 text-text2">
          <span aria-hidden className="spinner text-accent" />
          Reading your weak spots and the course outline…
        </span>
        <div aria-hidden className="flex flex-col gap-2">
          <span className="shimmer block h-2.5 w-3/5 rounded [--shimmer-base:color-mix(in_srgb,var(--accent)_16%,transparent)] [--shimmer-hi:color-mix(in_srgb,var(--accent)_34%,transparent)]" />
          <span className="shimmer block h-2.5 w-2/5 rounded [--shimmer-base:color-mix(in_srgb,var(--accent)_16%,transparent)] [--shimmer-hi:color-mix(in_srgb,var(--accent)_34%,transparent)]" />
        </div>
        <span className="text-xs text-text3">
          Sized for {depthLabel(e.budgetMinutes)}. Queued for the runner. You can leave this page; the outline will be here when it's ready.
        </span>
      </div>
    </>
  );
}

function Failed({ e, courseId }: { e: ExtensionView; courseId: string }) {
  const redraft = useRedraftExtension();
  return (
    <div role="alert" className="flex flex-col gap-3 rounded-card border border-border p-5">
      <span className="font-semibold text-bad">Couldn't draft an outline</span>
      <p className="m-0 text-[13px] text-text2">{e.error ?? "The drafting job failed."}</p>
      <div className="flex gap-2">
        <Button variant="primary" disabled={redraft.isPending} onClick={() => redraft.mutate({ params: { extensionId: e.id }, body: { budgetMinutes: e.budgetMinutes } })}>
          {redraft.isPending ? "Starting…" : "Draft again"}
        </Button>
        <Button to={`/courses/${courseId}`}>Back to the course</Button>
      </div>
    </div>
  );
}

function Empty({ e, courseId }: { e: ExtensionView; courseId: string }) {
  return (
    <div className="flex flex-col gap-3">
      <h1 className="m-0 text-[24px] font-semibold tracking-[-0.02em]">Proposal {e.status}</h1>
      <Button to={`/courses/${courseId}`}>Back to the course</Button>
    </div>
  );
}

/** After approval: write the lessons here (quick, unverified) or take a brief elsewhere (deep, real sources). Once generating, show progress. */
function Approved({ e, courseId }: { e: ExtensionView; courseId: string }) {
  const lessons = e.outline!.chapters.reduce((n, c) => n + c.lessons.length, 0);
  return e.generation ? <Generation e={e} generation={e.generation} courseId={courseId} /> : <Choose e={e} lessons={lessons} />;
}

function Generation({ e, generation: g, courseId }: { e: ExtensionView; generation: NonNullable<ExtensionView["generation"]>; courseId: string }) {
  const resume = useResumeExtension();
  const percent = g.total ? Math.round((g.done / g.total) * 100) : 0;
  return (
    <section aria-label="Writing lessons" className="flex flex-col gap-3 rounded-card border border-border p-[18px]" data-state={g.state}>
      <div className="flex flex-col gap-1">
        <span className="font-semibold">
          {g.state === "done" ? `All ${g.total} lessons are written` : g.state === "failed" ? `Stopped after ${g.done} of ${g.total} lessons` : `Writing lessons · ${g.done} of ${g.total}`}
        </span>
        <p className="m-0 text-[13px] text-text2">
          {g.state === "done"
            ? "They are in the course as a Level 2 section, marked unverified because they come from the model's own knowledge."
            : g.state === "failed"
              ? `"${g.current}" failed: ${g.error}`
              : `Now writing “${g.current}”. You can leave this page; each lesson appears in the course as soon as it's written.`}
        </p>
      </div>
      <ProgressBar value={percent} tone={g.state === "failed" ? "bad" : "ok"} label="Lessons written" />
      <div className="flex flex-wrap items-center gap-2">
        {g.state === "failed" ? (
          <Button variant="primary" disabled={resume.isPending} onClick={() => resume.mutate({ params: { extensionId: e.id } })}>
            {resume.isPending ? "Starting…" : "Continue"}
          </Button>
        ) : null}
        <Button variant={g.state === "done" ? "primary" : "secondary"} to={`/courses/${courseId}`}>
          {g.state === "done" ? "Open the course" : "Back to the course"}
        </Button>
        {resume.isError ? <span role="alert" className="text-xs text-bad">{errorMessage(resume.error)}</span> : null}
      </div>
    </section>
  );
}

function Choose({ e, lessons }: { e: ExtensionView; lessons: number }) {
  const generate = useGenerateExtension();
  return (
    <section aria-label="Next step" className="flex flex-col gap-3">
      <span className="font-semibold">Approved. Now get the lessons written.</span>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-2 rounded-card border border-border p-[18px]">
          <span className="font-medium">Write them here</span>
          <p className="m-0 flex-1 text-[13px] text-text2">
            The runner writes {lessons === 1 ? "the lesson" : `all ${lessons} lessons`} from the model's own knowledge, one at a time. No web research, so they are marked unverified. One model call per lesson; chat and grading stay responsive.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" disabled={generate.isPending} onClick={() => generate.mutate({ params: { extensionId: e.id } })}>
              {generate.isPending ? "Starting…" : "Generate here"}
            </Button>
            {generate.isError ? <span role="alert" className="text-xs text-bad">{errorMessage(generate.error)}</span> : null}
          </div>
        </div>
        <BriefOption extensionId={e.id} />
      </div>
    </section>
  );
}

function BriefOption({ extensionId }: { extensionId: string }) {
  const brief = useExtensionBrief(extensionId, true);
  const [copied, setCopied] = useState<"yes" | "failed" | null>(null);
  const copy = async () => {
    const text = brief.data!.markdown;
    try {
      await navigator.clipboard.writeText(text);
      setCopied("yes");
    } catch {
      // permission denied or no async clipboard: fall back to copying through a hidden selection
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.cssText = "position:fixed;opacity:0;pointer-events:none";
      document.body.append(area);
      area.select();
      let ok = false;
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }
      area.remove();
      setCopied(ok ? "yes" : "failed");
    }
  };
  return (
    <div className="flex flex-col gap-2 rounded-card border border-border p-[18px]">
      <span className="font-medium">Research them elsewhere</span>
      <p className="m-0 text-[13px] text-text2">
        Copy the brief into the Selfschool authoring skill, or any assistant that can do deep research. It carries the outline and the file format, so it can write real, sourced chapters into your extensions folder.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={!brief.data} onClick={() => void copy()}>
          {brief.isError ? "Brief unavailable" : copied === "yes" ? "Copied" : "Copy brief"}
        </Button>
        <span role="status" className="text-xs text-text3">
          {copied === "failed" ? "Couldn't copy automatically. Open the brief below and select it." : brief.isError ? errorMessage(brief.error) : null}
        </span>
      </div>
      {brief.data ? (
        <details>
          <summary className="w-fit cursor-pointer text-[13px] text-text2 underline underline-offset-2">Show the brief</summary>
          <textarea readOnly aria-label="Brief" value={brief.data.markdown} rows={14} className="mt-2 w-full resize-y rounded-control border border-border2 bg-bg p-2.5 font-mono text-xs text-text" />
        </details>
      ) : null}
    </div>
  );
}

function Review({ e, courseId }: { e: ExtensionView; courseId: string }) {
  const decide = useDecideExtension();
  const open = e.status === "ready";
  const redraft = useRedraftExtension();
  const [draft, setDraft] = useState<Draft>(() => toDraft(e.outline!));

  const edit = (fn: (d: Draft) => void) => setDraft((d) => { const next = structuredClone(d); fn(next); return next; });
  const kept = includedCount(draft);
  const total = draft.chapters.reduce((n, c) => n + c.lessons.length, 0);
  const shown = open ? draft : toDraft(e.outline!);

  const send = (body: Parameters<typeof decide.mutate>[0]["body"]) => decide.mutate({ params: { extensionId: e.id }, body });

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <span className={mono}>Level 2 proposal</span>
          {e.status === "approved" ? <Badge tone="ok">Approved</Badge> : null}
          {e.status === "rejected" ? <Badge tone="neutral">Rejected</Badge> : null}
        </div>
        {open ? (
          <input aria-label="Level title" value={draft.title} onChange={(ev) => edit((d) => { d.title = ev.target.value; })} className={cx(field, "h-11 text-[22px] font-semibold tracking-[-0.02em]")} />
        ) : (
          <h1 className="m-0 text-[24px] font-semibold tracking-[-0.02em]">{e.outline!.title}</h1>
        )}
        <Seed e={e} />
      </div>

      {open ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Segmented
            label="Depth"
            options={DEPTH_OPTIONS.map((d) => ({ value: String(d.minutes), label: d.label }))}
            value={String(e.budgetMinutes)}
            onChange={(v) => Number(v) !== e.budgetMinutes && redraft.mutate({ params: { extensionId: e.id }, body: { budgetMinutes: Number(v) } })}
          />
          <span className="text-xs text-text3">{redraft.isError ? "Couldn't re-draft. Try again." : "Changing the depth drafts a new outline and replaces your edits."}</span>
        </div>
      ) : null}

      <section aria-label="Why these topics" className="tutor flex flex-col gap-1.5 rounded-card border border-border bg-accent-soft px-[18px] py-4">
        <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-accent">Why these topics</span>
        <p className="m-0 leading-[1.65]">
          <InlineMarkdown text={e.outline!.rationale} />
        </p>
      </section>

      {e.outline!.unverified ? (
        <Notice>
          No new research was possible. The lessons draw on your course sources and the model's own knowledge, so check facts before relying on them.
        </Notice>
      ) : null}

      {e.status === "approved" ? <Approved e={e} courseId={courseId} /> : null}

      <ol className="m-0 flex list-none flex-col gap-4 p-0">
        {shown.chapters.map((c, ci) => {
          const none = !c.lessons.some((l) => l.included);
          return (
            <li key={ci} className={cx("flex flex-col gap-3 rounded-card border border-border p-[18px]", open && none && "opacity-60")}>
              <div className="flex flex-col gap-1.5">
                <span className={mono}>Chapter {ci + 1}</span>
                {open ? (
                  <input aria-label={`Chapter ${ci + 1} title`} value={c.title} onChange={(ev) => edit((d) => { d.chapters[ci]!.title = ev.target.value; })} className={cx(field, "font-semibold")} />
                ) : (
                  <h2 className="m-0 text-[17px] font-semibold">{c.title}</h2>
                )}
                {c.why ? <p className="m-0 text-[13px] text-text2">{c.why}</p> : null}
              </div>
              <ul className="m-0 flex list-none flex-col divide-y divide-border border-t border-border p-0">
                {c.lessons.map((l, li) => (
                  <li key={li} className={cx("flex items-start gap-3 py-3", open && !l.included && "opacity-55")}>
                    {open ? (
                      <input
                        type="checkbox"
                        aria-label={`Keep “${l.title}”`}
                        checked={l.included}
                        onChange={(ev) => edit((d) => { d.chapters[ci]!.lessons[li]!.included = ev.target.checked; })}
                        className="mt-2.5 size-4 shrink-0 accent-[var(--text)]"
                      />
                    ) : (
                      <span aria-hidden className="mt-0.5 w-4 shrink-0 text-right font-mono text-xs text-text3">{li + 1}</span>
                    )}
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      {open ? (
                        <input aria-label={`Lesson ${li + 1} title`} value={l.title} onChange={(ev) => edit((d) => { d.chapters[ci]!.lessons[li]!.title = ev.target.value; })} className={field} />
                      ) : (
                        <span className="font-medium">{l.title}</span>
                      )}
                      <span className="text-[13px] text-text2">
                        <span className="text-text3">You'll be able to: </span>
                        {l.objective}
                      </span>
                      {l.why ? <span className="text-xs text-text3">{l.why}</span> : null}
                    </div>
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ol>

      {open ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium" aria-live="polite">
              {kept} of {total} {total === 1 ? "lesson" : "lessons"} kept · {formatDuration(plannedMinutes(kept))}
            </span>
            <span className="text-xs text-text3">Approving saves this outline. Then you choose how the lessons get written.</span>
            {decide.isError ? (
              <span role="alert" className="text-xs text-bad">
                Couldn't save: {errorMessage(decide.error)}
              </span>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button size="lg" disabled={decide.isPending} onClick={() => send({ decision: "reject" })}>
              Reject
            </Button>
            <Button variant="primary" size="lg" disabled={!canApprove(draft) || decide.isPending} onClick={() => send({ decision: "approve", outline: toOutline(draft) })}>
              {decide.isPending ? "Saving…" : "Approve outline"}
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <Button to={`/courses/${courseId}`}>Back to the course</Button>
        </div>
      )}
    </>
  );
}
