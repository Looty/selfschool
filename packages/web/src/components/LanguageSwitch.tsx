import { useQueryClient } from "@tanstack/react-query";
import { languageName, saveContentLanguage } from "../api/language";

/** Switch the reading language of a course that has translations. The choice is global and applies to every course that has it. */
export function LanguageSwitch({ languages, current }: { languages: string[]; current: string }) {
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
      {languages.map((code) => (
        <option key={code} value={code}>
          {languageName(code)}
        </option>
      ))}
    </select>
  );
}
