import { apiHref } from "../../basePath";
import { Button, cx } from "../../ui";
import type { LabFile } from "./compat";
import { useLab } from "./lab";
import { PlayIcon } from "./PlayIcon";

const LAUNCHER: Record<LabFile["language"], string> = { python: "python", javascript: "node", typescript: "tsx" };

/**
 * The lab of a lesson, near its top: each script the lesson ships, with how it is run. Scripts that can run in the
 * browser get Run (into the docked terminal) and Edit (the editor drawer); scripts that need a real machine (torch,
 * transformers, Node packages) say so up front, with the download, instead of offering a Run that would fail.
 */
export function LabCard({
  files,
  commands,
}: {
  /** The lesson's runnable files (helpers that other files import are left out by the caller). */
  files: LabFile[];
  /** The arguments the lesson's own command uses for a file (`python lab01.py "..."`), by file name. */
  commands: ReadonlyMap<string, string>;
}) {
  const lab = useLab();
  const inBrowser = files.filter((f) => f.compat?.ok !== false);
  const onComputer = files.filter((f) => f.compat?.ok === false);
  const all = inBrowser.length === 0;

  return (
    <section aria-label="Lab" className={cx("mb-8 overflow-hidden rounded-card border", all ? "border-border" : "border-accent/40 bg-accent-soft/40")}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-5 pt-4">
        <span className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-accent">Lab</span>
        <span className="text-[15px] font-semibold">{all ? "Run this lab on your computer" : "Try it here: runs in your browser"}</span>
      </div>
      <p className="m-0 px-5 pt-1 text-[13px] text-text2">
        {all
          ? onComputer.length === 1
            ? "This script needs packages a browser cannot run. Download it and follow the setup in the lesson."
            : "These scripts need packages a browser cannot run. Download them and follow the setup in the lesson."
          : "No install needed: Run opens a terminal at the bottom of the page, Edit opens the script beside the lesson. Everything runs sandboxed in this tab."}
      </p>

      <ul className="m-0 flex list-none flex-col gap-2 px-5 py-4">
        {inBrowser.map((f) => {
          const args = commands.get(f.name);
          const checking = f.compat === null;
          return (
            <li key={f.name} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-border bg-bg px-3.5 py-2.5">
              <code className="min-w-0 flex-1 truncate font-mono text-[13px] text-text2">
                <span className="text-text3">$ </span>
                {LAUNCHER[f.language]} {f.name}
                {args ? ` ${args}` : ""}
              </code>
              {lab ? (
                <span className="flex items-center gap-2">
                  <Button size="sm" onClick={() => lab.show(f.name, true)} disabled={checking} aria-label={`Edit ${f.name}`}>
                    Edit
                  </Button>
                  <Button variant="primary" size="sm" onClick={() => lab.run(f.name, args)} disabled={checking} aria-label={`Run ${f.name} in the browser`}>
                    <PlayIcon />
                    {checking ? "Checking…" : "Run"}
                  </Button>
                </span>
              ) : null}
            </li>
          );
        })}
        {onComputer.map((f) => (
          <li key={f.name} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-border bg-bg px-3.5 py-2.5">
            <span className="min-w-0 flex-1 text-[13px]">
              <code className="font-mono text-text2">{f.name}</code>
              <span className="text-text3"> needs {f.compat?.ok === false ? f.compat.needs.join(", ") : ""}, which cannot run in a browser</span>
            </span>
            <Button size="sm" onClick={() => download(f.url, f.name)} aria-label={`Download ${f.name}`}>
              Download
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function download(url: string, name: string) {
  const a = document.createElement("a");
  a.href = apiHref(url, import.meta.env.BASE_URL);
  a.download = name;
  a.click();
}
