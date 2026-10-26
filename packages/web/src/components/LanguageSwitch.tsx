import { useQueryClient } from "@tanstack/react-query";
import { languageName, saveContentLanguage } from "../api/language";

/**
 * Switch the reading language of a course (or of every course, on the dashboard). The choice is global and applies to
 * every course that has it. With `anyLabel` an extra first option means "each course's own language" (no choice).
 */
export function LanguageSwitch({ languages, current, anyLabel }: { languages: string[]; current: string; anyLabel?: string }) {
  const qc = useQueryClient();
  if (languages.length < 2) return null;
  return (
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
  );
}
