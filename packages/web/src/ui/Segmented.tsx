import { useId } from "react";
import { cx } from "./cx";

/** Segmented control: 30px items in a 3px-padded surface2 track (Theme, Reading font). */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  const name = useId();
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex gap-0.5 rounded-control bg-surface2 p-[3px]">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <label
            key={o.value}
            className={cx(
              "flex h-[30px] cursor-pointer items-center rounded-[6px] px-3.5 text-[13px] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-text",
              active ? "bg-bg font-medium text-text" : "text-text2",
            )}
          >
            <input type="radio" name={name} value={o.value} checked={active} onChange={() => onChange(o.value)} className="sr-only" />
            {o.label}
          </label>
        );
      })}
    </div>
  );
}
