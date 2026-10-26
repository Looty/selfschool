import { portableBackupSchema, type PortableBackup } from "@selfschool/shared";
import { ApiError, callApi } from "../../api/client";
import { markBackupDone } from "./backup";

/** Preferences worth carrying to another install; the backup dates describe this install only. */
const PREF_PREFIX = "selfschool-";
const LOCAL_ONLY = new Set(["selfschool-last-backup", "selfschool-backup-snooze"]);

function readPrefs(): Record<string, string> {
  const prefs: Record<string, string> = {};
  try {
    for (const key of Object.keys(localStorage)) {
      const value = localStorage.getItem(key);
      if (key.startsWith(PREF_PREFIX) && !LOCAL_ONLY.has(key) && value !== null) prefs[key] = value;
    }
  } catch {
    /* storage blocked: the file just has no preferences */
  }
  return prefs;
}

/** Downloads one JSON file with all progress, where each course came from, and the preferences. */
export async function downloadPortableBackup(): Promise<void> {
  const res = await fetch("/api/backup/portable");
  if (!res.ok) throw new ApiError(res.status, "Could not create the backup.");
  const file = { ...((await res.json()) as PortableBackup), prefs: readPrefs() };
  const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `selfschool-backup-${file.exportedAt.slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  markBackupDone();
}

export interface RestoreReport {
  /** Courses fetched again from their repository. */
  courses: string[];
  /** Courses that need to be added by hand: imported from a zip (no source) or the repository could not be reached. */
  missing: { id: string; reason: string }[];
}

/**
 * Restores a portable backup file: replaces all progress, puts the preferences back, then fetches each course again
 * from its repository (the newest commit of the saved branch or tag; progress follows the lessons by id).
 */
export async function restorePortableBackup(file: File, onStep: (message: string) => void): Promise<RestoreReport> {
  let parsed: PortableBackup;
  try {
    const result = portableBackupSchema.safeParse(JSON.parse(await file.text()));
    if (!result.success) throw new Error("not a backup");
    parsed = result.data;
  } catch {
    throw new ApiError(400, "This is not a Selfschool backup file.");
  }

  onStep("Restoring progress…");
  const res = await fetch("/api/restore", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(parsed) });
  if (!res.ok) {
    const json = (await res.json().catch(() => undefined)) as { error?: string } | undefined;
    throw new ApiError(res.status, json?.error ?? "Could not restore the backup.");
  }

  try {
    for (const [key, value] of Object.entries(parsed.prefs)) if (key.startsWith(PREF_PREFIX) && !LOCAL_ONLY.has(key)) localStorage.setItem(key, value);
  } catch {
    /* storage blocked: preferences stay as they are */
  }

  const report: RestoreReport = { courses: [], missing: [] };
  for (const c of parsed.courses) {
    if (c.url.startsWith("zip:")) {
      report.missing.push({ id: c.id, reason: "added from a zip, add the zip again" });
      continue;
    }
    onStep(`Fetching ${c.id}…`);
    try {
      await callApi("addPackage", { body: { url: c.url, path: c.path, ref: c.ref } });
      report.courses.push(c.id);
    } catch (e) {
      report.missing.push({ id: c.id, reason: e instanceof ApiError ? e.message : "could not be fetched" });
    }
  }
  return report;
}
