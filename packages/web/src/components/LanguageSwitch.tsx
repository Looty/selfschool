import { useQueryClient } from "@tanstack/react-query";
import { languageName, loadContentLanguage, saveContentLanguage } from "../api/language";

/**
 * Switch the reading language of a course (or of every course, on the dashboard). The choice is global and applies to
 * every course that has it. With `anyLabel` an extra first option means "each course's own language" (no choice).
 * On a page that is shown in another language than the one asked for (that page has no translated file), a short note says so.
 */
export function LanguageSwitch({ languages, current, anyLabel }: { languages: string[]; current: string; anyLabel?: string }) {
  const qc = useQueryClient();
  if (languages.length < 2) return null;
  const wanted = loadContentLanguage();
  const missing = !anyLabel && wanted !== "" && wanted !== current && languages.includes(wanted);
  return (
    <span className="flex items-center gap-2">
      {missing ? <span className="text-xs text-text3">Not translated to {languageName(wanted)} yet</span> : null}
      <select
        aria-label="Course language"
        value={current}
        onChange={(e) => {
          saveContentLanguage(e.target.value);
          // everything on screen was fetched in the old language
          void qc.invalidateQueries();
        }}
        className="h-7 max-w-[9rem] cursor-pointer rounded border border-border2 bg-surface px-1.5 text-xs text-text"
      >
        {anyLabel ? <option value="">{anyLabel}</option> : null}
        {languages.map((code) => (
          <option key={code} value={code}>
            {languageName(code)}
          </option>
        ))}
      </select>
    </span>
  );
}
