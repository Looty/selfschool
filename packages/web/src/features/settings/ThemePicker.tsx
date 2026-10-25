import type { CSSProperties } from "react";
import { THEMES, type ThemeId } from "../../theme";
import { cx } from "../../ui";
import type { ThemeChoice } from "./prefs";

/**
 * A miniature of the app drawn with a theme's own tokens. `data-theme` scopes the CSS variables to this element,
 * so the preview shows the theme without applying it.
 */
function Preview({ id, style }: { id: ThemeId; style?: CSSProperties }) {
  const pill = (w: number, o = 0.5): CSSProperties => ({ display: "block", width: w, height: 6, borderRadius: 3, background: "var(--text3)", opacity: o });
  return (
    <div data-theme={id} aria-hidden="true" className="absolute inset-0" style={{ background: "var(--canvas)", ...style }}>
      <div className="flex h-[26px] items-center gap-2 px-4" style={{ background: "var(--surface2)" }}>
        <span style={pill(36)} />
        <span style={pill(28)} />
        <span style={pill(34)} />
      </div>
      <div className="relative px-6 pt-3.5">
        <span style={pill(64, 0.4)} />
        <span className="absolute right-6 top-3.5 flex gap-1">
          <span style={{ width: 9, height: 9, borderRadius: 2, background: "var(--ok)" }} />
          <span style={{ width: 9, height: 9, borderRadius: 2, background: "var(--bad)" }} />
        </span>
        <div className="mt-3 overflow-hidden rounded-md" style={{ background: "var(--surface)", border: "1px solid var(--border)", height: 56 }}>
          <div className="flex h-[20px] items-center px-2" style={{ background: "var(--ok-bg)" }}>
            <span style={{ display: "block", width: "55%", height: 7, borderRadius: 4, background: "var(--ok)" }} />
          </div>
          <div className="flex flex-col gap-1.5 px-2 pt-2">
            <span style={pill(90, 0.3)} />
            <span style={pill(60, 0.3)} />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Light on one half and dark on the other: the theme follows the device. */
function SystemPreview() {
  return (
    <>
      <Preview id="light" />
      <Preview id="dark" style={{ clipPath: "polygon(50% 0, 100% 0, 100% 100%, 50% 100%)" }} />
    </>
  );
}

interface Card {
  value: ThemeChoice;
  label: string;
  description: string;
}

const CARDS: Card[] = [
  ...THEMES.map((t) => ({ value: t.id as ThemeChoice, label: t.label, description: t.description })),
  { value: "system", label: "Match my device", description: "Light default in the daytime and dark default at night, following your system setting." },
];

/** Theme cards in the style of GitHub's appearance settings: a preview, a radio and a description. */
export function ThemePicker({ value, onChange }: { value: ThemeChoice; onChange: (v: ThemeChoice) => void }) {
  return (
    <div role="radiogroup" aria-label="Theme" className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))" }}>
      {CARDS.map((c) => {
        const selected = value === c.value;
        return (
          <label
            key={c.value}
            className={cx(
              "flex cursor-pointer flex-col overflow-hidden rounded-card border bg-bg transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-text",
              selected ? "border-accent ring-1 ring-accent" : "border-border hover:border-border2",
            )}
          >
            <input type="radio" name="theme" value={c.value} checked={selected} onChange={() => onChange(c.value)} className="sr-only" />
            <div className="relative h-[116px] overflow-hidden border-b border-border">{c.value === "system" ? <SystemPreview /> : <Preview id={c.value} />}</div>
            <div className="flex flex-col gap-1 p-3.5">
              <div className="flex items-center gap-2.5 font-medium">
                <span aria-hidden="true" className={cx("flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2", selected ? "border-accent" : "border-border2")}>
                  {selected ? <span className="h-2 w-2 rounded-full bg-accent" /> : null}
                </span>
                {c.label}
              </div>
              <div className="pl-[26px] text-[13px] leading-snug text-text3">{c.description}</div>
            </div>
          </label>
        );
      })}
    </div>
  );
}
