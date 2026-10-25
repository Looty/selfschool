import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import type { PackageInfo, Settings } from "@selfschool/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getPackageUpdates, getRemoved, restoreCourse } from "../../api/client";
import { usePackages, useSettings, useUpdateSettings } from "../../api/hooks";
import { LOCAL, describeLastBackup, loadLastBackup, markBackupDone } from "./backup";
import { ImportDialog, type ImportSource } from "./ImportDialog";
import { RemoveDialog } from "./RemoveDialog";
import { currentTheme } from "../../theme";
import { Badge, Button, Segmented, cx, notifySaved } from "../../ui";
import { PageError } from "../dashboard/shared";
import { ThemePicker } from "./ThemePicker";
import {
  CHAT_GRADE, FONT_OPTIONS, FONT_STACK, GENERATE_VERIFY, TEXT_SIZE_DEFAULT, TEXT_SIZE_MAX, WIDTH_OPTIONS, applyContentWidth, applyReadingFont, applyTextSize, applyThemeChoice, formatBytes,
  loadContentWidth, loadReadingFont, loadTextSize, loadThemeChoice, modelChoices, packageBody, pairPatch, pairState, resolveTheme, shortSha, systemPrefersDark,
  validatePackageForm, versionAction,
  type ContentWidth, type ModelPair, type PackageForm, type ReadingFont, type ThemeChoice,
} from "./prefs";

const WIDTH = 880;
/** Follows Settings > Content width, so changing it is visible on this page straight away. */
const MAX_WIDTH = `calc(${WIDTH}px * var(--content-scale, 1))`;

export default function SettingsFeature() {
  return (
    <div className="mx-auto flex flex-col gap-9 px-7 pb-16 pt-9" style={{ maxWidth: MAX_WIDTH }}>
      <div>
        <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-text3">Preferences</div>
        <h1 className="m-0 mt-1 text-[30px] font-semibold leading-[1.2] tracking-[-0.02em]">Settings</h1>
      </div>
      <Appearance />
      <Tutor />
      <Packages />
      <Data />
    </div>
  );
}

// ---------- layout pieces ----------

function Group({ title, action, id, children }: { title: string; action?: ReactNode; id?: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id ?? title}-h`} className="flex scroll-mt-6 flex-col">
      <div className="flex items-baseline justify-between gap-3 border-b border-border2 pb-2.5">
        <h2 id={`${id ?? title}-h`} className="m-0 font-mono text-[11px] font-normal uppercase tracking-[0.08em] text-text3">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Row({ title, help, children }: { title: string; help?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-3 border-b border-border py-4">
      <div className="min-w-0 flex-[1_1_260px]">
        <div className="font-medium">{title}</div>
        {help ? <div className="text-[13px] text-text3">{help}</div> : null}
      </div>
      {children}
    </div>
  );
}

const selectCls = "h-9 rounded-control border border-border2 bg-bg px-3 text-text disabled:cursor-not-allowed disabled:opacity-50";

// ---------- Appearance ----------

function Appearance() {
  const [choice, setChoice] = useState<ThemeChoice>(loadThemeChoice);
  const [font, setFont] = useState<ReadingFont>(loadReadingFont);
  const [width, setWidth] = useState<ContentWidth>(loadContentWidth);
  const [textSize, setTextSize] = useState<number>(loadTextSize);
  const changeTextSize = (next: number) => {
    setTextSize(applyTextSize(next));
    notifySaved();
  };
  const choiceRef = useRef(choice);
  choiceRef.current = choice;

  // The top-bar toggle flips data-theme behind our back: mirror it so the control never lies.
  useEffect(() => {
    const obs = new MutationObserver(() => {
      const applied = currentTheme();
      if (resolveTheme(choiceRef.current, systemPrefersDark()) !== applied) setChoice(applied);
    });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);

  // While on "System", follow OS changes live.
  useEffect(() => {
    if (choice !== "system" || typeof matchMedia !== "function") return;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyThemeChoice("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [choice]);

  return (
    <Group title="Appearance">
      <div className="border-b border-border py-4">
        <div className="font-medium">Theme</div>
        <div className="mb-3.5 text-[13px] text-text3">The sun and moon button in the top bar flips between light and dark, keeping a colorblind choice.</div>
        <ThemePicker
          value={choice}
          onChange={(v) => {
            setChoice(v);
            applyThemeChoice(v);
            notifySaved();
          }}
        />
      </div>
      <Row title="Reading font" help="Applies to lesson prose. Code stays monospaced.">
        <Segmented
          label="Reading font"
          options={FONT_OPTIONS}
          value={font}
          onChange={(v) => {
            setFont(v);
            applyReadingFont(v);
            notifySaved();
          }}
        />
      </Row>
      <Row title="Content width" help="Maximum width of the lesson, course and settings pages. Applies immediately.">
        <Segmented
          label="Content width"
          options={WIDTH_OPTIONS}
          value={width}
          onChange={(v) => {
            setWidth(v);
            applyContentWidth(v);
            notifySaved();
          }}
        />
      </Row>
      <Row title="Text size" help="Size of the lesson text. The default is the smallest; you can only make it bigger.">
        <div className="flex items-center gap-2" role="group" aria-label="Text size">
          <button
            type="button"
            aria-label="Smaller text"
            disabled={textSize <= TEXT_SIZE_DEFAULT}
            onClick={() => changeTextSize(textSize - 1)}
            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-control border border-border2 bg-bg text-lg text-text disabled:cursor-not-allowed disabled:opacity-40"
          >
            −
          </button>
          <output aria-live="polite" className="min-w-[78px] text-center font-mono text-[13px] tabular-nums">
            {textSize} px
          </output>
          <button
            type="button"
            aria-label="Larger text"
            disabled={textSize >= TEXT_SIZE_MAX}
            onClick={() => changeTextSize(textSize + 1)}
            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-control border border-border2 bg-bg text-lg text-text disabled:cursor-not-allowed disabled:opacity-40"
          >
            +
          </button>
        </div>
      </Row>
      <p data-testid="font-preview" className="m-0 max-w-[70ch] py-4 leading-[1.75] text-text2" style={{ fontFamily: FONT_STACK[font], fontSize: textSize }}>
        A type guard is an expression whose result tells the compiler which member of a union you are holding.
      </p>
    </Group>
  );
}

// ---------- Tutor ----------

function Tutor() {
  const q = useSettings();
  return (
    <Group title="Tutor">
      {q.isPending ? (
        <p role="status" className="m-0 py-4 text-text3">
          Loading tutor settings…
        </p>
      ) : q.isError ? (
        <div className="py-4">
          <PageError what="tutor settings" error={q.error} onRetry={() => void q.refetch()} width={WIDTH} />
        </div>
      ) : (
        <TutorRows settings={q.data} />
      )}
    </Group>
  );
}

function TutorRows({ settings }: { settings: Settings }) {
  const { runner } = settings;
  return (
    <>
      <Row title="AI runner" help="Runs on this machine and uses your logged-in CLI. Chat and grading wait for it.">
        <div className="flex items-center gap-3">
          <span
            className={cx(
              "flex items-center gap-2 rounded-full px-2.5 py-[3px] text-xs font-medium",
              runner.connected ? "bg-ok-bg text-ok" : "bg-warn-bg text-warn",
            )}
          >
            <span aria-hidden className={cx("h-1.5 w-1.5 rounded-full", runner.connected ? "bg-ok" : "bg-warn")} />
            {runner.connected ? "Connected" : "Paused"}
          </span>
          <code className="font-mono text-xs text-text3">{runner.connected ? "school doctor" : "school up"}</code>
        </div>
      </Row>
      <Row title="Provider" help="Adapters run the CLI with tools disabled in an empty folder.">
        <span className="font-mono text-[13px]">
          {settings.provider.name} · {settings.provider.detail}
        </span>
      </Row>
      <ModelRow title="Model for chat and grading" help="Fast and cheap. Used every time you ask or submit." pair={CHAT_GRADE} settings={settings} />
      <ModelRow title="Model for generation and verification" help="Used when building exam questions and extensions." pair={GENERATE_VERIFY} settings={settings} />
    </>
  );
}

function ModelRow({ title, help, pair, settings }: { title: string; help: string; pair: ModelPair; settings: Settings }) {
  const update = useUpdateSettings();
  const { value, mixed } = pairState(settings.models, pair);
  const choices = modelChoices(settings.modelOptions[pair[0]], value);
  return (
    <Row title={title} help={help}>
      <div className="flex flex-col items-end gap-1">
        <select
          aria-label={title}
          className={selectCls}
          value={mixed ? "" : value}
          disabled={update.isPending}
          onChange={(e) => update.mutate({ body: { models: pairPatch(pair, e.target.value) } }, { onSuccess: () => notifySaved() })}
        >
          {mixed ? (
            <option value="" disabled>
              Mixed
            </option>
          ) : null}
          {choices.map((m) => (
            <option key={m} value={m}>
              {capitalize(m)}
            </option>
          ))}
        </select>
        {update.isError ? (
          <span role="alert" className="text-xs text-bad">
            Could not save: {update.error.message}
          </span>
        ) : null}
      </div>
    </Row>
  );
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ---------- Course packages ----------

function Packages() {
  const q = usePackages();
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState<ImportSource | null>(null);
  const [removing, setRemoving] = useState<PackageInfo | null>(null);
  const { hash } = useLocation();

  useEffect(() => {
    if (hash === "#packages") document.getElementById("packages")?.scrollIntoView?.({ block: "start" });
  }, [hash, q.isSuccess]);

  return (
    <Group
      id="packages"
      title="Course packages"
      action={
        <Button size="sm" aria-expanded={adding} aria-controls="add-package-form" onClick={() => setAdding((a) => !a)} className="!h-7 !px-2.5 !text-xs">
          {adding ? "Cancel" : "Add package"}
        </Button>
      }
    >
      <div className="border-b border-border py-4">
        <ZipDrop onFile={(file) => setImporting({ kind: "zip", file })} />
      </div>
      {adding ? <AddPackageForm onCheck={(body) => setImporting({ kind: "repo", body })} /> : null}
      {importing ? (
        <ImportDialog
          source={importing}
          onClose={() => {
            setImporting(null);
            setAdding(false);
          }}
        />
      ) : null}
      {q.isPending ? (
        <p role="status" className="m-0 py-4 text-text3">
          Loading packages…
        </p>
      ) : q.isError ? (
        <div className="py-4">
          <PageError what="packages" error={q.error} onRetry={() => void q.refetch()} width={WIDTH} />
        </div>
      ) : q.data.packages.length === 0 ? (
        <p className="m-0 border-b border-border py-4 text-[13px] text-text3">No course packages yet. Add one by repo URL, path and ref.</p>
      ) : (
        q.data.packages.map((p) => <PackageRow key={p.id} pkg={p} onRemove={() => setRemoving(p)} onReview={(body) => setImporting({ kind: "repo", body })} />)
      )}
      {removing ? <RemoveDialog pkg={removing} onClose={() => setRemoving(null)} /> : null}
      <RemovedList />
    </Group>
  );
}

/**
 * One installed course. "Check for updates" asks GitHub (on demand) whether its branch or tag has moved and which other
 * branches and tags exist; reviewing an update or switching to another version opens the normal import popup, which
 * dry-runs it and keeps your progress (an existing course is updated in place).
 */
function PackageRow({ pkg, onRemove, onReview }: { pkg: PackageInfo; onRemove: () => void; onReview: (body: { url: string; path: string; ref: string }) => void }) {
  const check = useMutation({ mutationFn: () => getPackageUpdates(pkg.id) });
  const updates = check.data;
  const [picked, setPicked] = useState(pkg.ref);
  const action = versionAction(pkg.ref, updates, picked);
  const others = (names: string[]) => names.filter((n) => n !== pkg.ref);
  return (
    <div data-hue={pkg.course.hue} className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-border py-3.5">
      <span className="w-11 font-mono text-sm font-semibold text-hue" title={pkg.course.title}>
        {pkg.course.monogram}
      </span>
      <span className="min-w-0 flex-[1_1_260px] break-all font-mono text-xs text-text2">
        {pkg.url}
        {pkg.path ? `/${pkg.path}` : ""} @ {pkg.ref} · {shortSha(pkg.sha)}
      </span>
      {updates?.status === "update_available" ? (
        <Badge tone="hue" mono={false}>
          Update available
        </Badge>
      ) : updates?.status === "up_to_date" ? (
        <span className="text-xs text-text3">Up to date</span>
      ) : null}
      {updates && (updates.branches.length > 0 || updates.tags.length > 0) ? (
        <select
          value={picked}
          onChange={(e) => setPicked(e.target.value)}
          aria-label={`Version of ${pkg.course.title}`}
          className="h-7 max-w-[10rem] rounded border border-border2 bg-surface px-1.5 font-mono text-xs text-text"
        >
          <option value={pkg.ref}>{pkg.ref} (installed)</option>
          {others(updates.branches).length > 0 ? (
            <optgroup label="Branches">
              {others(updates.branches).map((n) => (
                <option key={`b-${n}`} value={n}>
                  {n}
                </option>
              ))}
            </optgroup>
          ) : null}
          {others(updates.tags).length > 0 ? (
            <optgroup label="Tags">
              {others(updates.tags).map((n) => (
                <option key={`t-${n}`} value={n}>
                  {n}
                </option>
              ))}
            </optgroup>
          ) : null}
        </select>
      ) : null}
      {action ? (
        <Button size="sm" onClick={() => onReview({ url: pkg.url, path: pkg.path, ref: picked })} className="!h-7 !px-2.5 !text-xs">
          {action === "switch" ? `Switch to ${picked}` : "Review changes"}
        </Button>
      ) : null}
      <Button size="sm" disabled={check.isPending} onClick={() => check.mutate()} aria-label={`Check ${pkg.course.title} for updates`} className="!h-7 !px-2.5 !text-xs">
        {check.isPending ? "Checking…" : "Check for updates"}
      </Button>
      <Button size="sm" onClick={onRemove} aria-label={`Remove ${pkg.course.title}`} className="!h-7 !px-2.5 !text-xs">
        Remove
      </Button>
      {check.isError ? (
        <p role="alert" className="m-0 basis-full text-[13px] text-bad">
          Could not check: {check.error.message}
        </p>
      ) : updates?.note ? (
        <p role="status" className="m-0 basis-full text-[13px] text-text3">
          {updates.note}
        </p>
      ) : null}
    </div>
  );
}

/** Courses removed from the app whose folders are still in `courses/`; "Restore" shows one again, from zero. Hidden when there are none. */
function RemovedList() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["removed"], queryFn: getRemoved });
  const restore = useMutation({
    mutationFn: (id: string) => restoreCourse(id),
    onSuccess: () => Promise.all([["removed"], ["api", "packages"], ["api", "courses"], ["api", "dashboard"]].map((queryKey) => qc.invalidateQueries({ queryKey }))),
  });
  const rows = q.data?.courses ?? [];
  if (rows.length === 0) return null;
  return (
    <div className="border-b border-border py-3.5">
      <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.08em] text-text3">Removed</div>
      {rows.map((c) => (
        <div key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-1.5 text-[13px]">
          <span className="min-w-0 flex-[1_1_200px]">
            <span className="text-text2">{c.title}</span> <span className="break-all font-mono text-xs text-text3">courses/{c.folder}</span>
          </span>
          <Button size="sm" disabled={restore.isPending} onClick={() => restore.mutate(c.id)} aria-label={`Restore ${c.title}`} className="!h-7 !px-2.5 !text-xs">
            Restore
          </Button>
        </div>
      ))}
      {restore.isError ? (
        <p role="alert" className="m-0 pt-1 text-[13px] text-bad">
          Could not restore: {restore.error.message}
        </p>
      ) : null}
    </div>
  );
}

/** Drop target and file picker for a course zip; the file goes to the import popup, which checks it before anything is added. */
function ZipDrop({ onFile }: { onFile: (f: File) => void }) {
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pick = useRef<HTMLInputElement>(null);

  function take(files: FileList | null | undefined) {
    const f = files?.[0];
    if (!f) return;
    if (!/\.zip$/i.test(f.name)) return setError("That is not a .zip file.");
    setError(null);
    onFile(f);
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        take(e.dataTransfer.files);
      }}
      className={cx(
        "flex flex-wrap items-center justify-between gap-3 rounded-card border border-dashed px-5 py-4 text-[13px]",
        over ? "border-text bg-surface2" : "border-border2 bg-surface",
      )}
    >
      <span className="text-text2">
        Drop a course <span className="font-mono">.zip</span> here. It is checked before anything is added.
        {error ? (
          <span role="alert" className="ml-2 text-bad">
            {error}
          </span>
        ) : null}
      </span>
      <input ref={pick} type="file" accept=".zip,application/zip" hidden aria-label="Choose a course zip" onChange={(e) => { take(e.target.files); e.target.value = ""; }} />
      <Button size="sm" onClick={() => pick.current?.click()} className="!h-7 !px-2.5 !text-xs">
        Choose a file
      </Button>
    </div>
  );
}

function AddPackageForm({ onCheck }: { onCheck: (body: { url: string; path: string; ref: string }) => void }) {
  const [form, setForm] = useState<PackageForm>({ url: "", path: "", ref: "main" });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof PackageForm) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  function submit(e: FormEvent) {
    e.preventDefault();
    const problem = validatePackageForm(form);
    setError(problem);
    if (problem) return;
    onCheck(packageBody(form));
  }

  const input = "h-9 w-full rounded-control border border-border2 bg-bg px-3 text-text";
  return (
    <form id="add-package-form" onSubmit={submit} className="flex flex-col gap-3 border-b border-border py-4" noValidate>
      <div className="flex flex-wrap gap-3">
        <label className="flex min-w-[240px] flex-[3_1_240px] flex-col gap-1 text-[13px] text-text2">
          Repository URL
          <input className={input} value={form.url} onChange={set("url")} placeholder="github.com/you/course-package" autoFocus aria-invalid={error ? true : undefined} aria-describedby={error ? "pkg-error" : undefined} />
        </label>
        <label className="flex min-w-[140px] flex-[1_1_140px] flex-col gap-1 text-[13px] text-text2">
          Path
          <input className={input} value={form.path} onChange={set("path")} placeholder="(repo root)" />
        </label>
        <label className="flex min-w-[100px] flex-[1_1_100px] flex-col gap-1 text-[13px] text-text2">
          Ref
          <input className={input} value={form.ref} onChange={set("ref")} placeholder="main" />
        </label>
      </div>
      {error ? (
        <p id="pkg-error" role="alert" className="m-0 text-[13px] text-bad">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" size="sm">
          Check package
        </Button>
      </div>
    </form>
  );
}

// ---------- Data ----------

function Data() {
  const q = useSettings();
  const [last, setLast] = useState(loadLastBackup);
  return (
    <Group title="Data">
      <Row
        title="Progress database"
        help={`Attempts, progress, XP and the question bank. Course files are separate. ${describeLastBackup(Date.now(), last)}.${LOCAL ? " In this build the data lives in your browser, which can clear it: export a backup now and then." : ""}`}
      >
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-text3">{q.data ? formatBytes(q.data.database.sizeBytes) : q.isError ? "unavailable" : "…"}</span>
          <a
            href="/api/backup"
            download
            onClick={() => {
              markBackupDone();
              setLast(loadLastBackup());
            }}
            className="inline-flex h-8 items-center rounded-button border border-border2 bg-bg px-3 text-[13px] font-medium text-text no-underline hover:bg-surface2"
          >
            Export backup
          </a>
        </div>
      </Row>
    </Group>
  );
}
