/** True in the build that runs the whole app inside the browser (packages/local), where progress lives only in this browser. */
export const LOCAL = import.meta.env.VITE_LOCAL === "1";

const LAST_KEY = "selfschool-last-backup";
const SNOOZE_KEY = "selfschool-backup-snooze";
const DAY = 86_400_000;
export const BACKUP_EVERY_DAYS = 14;
export const SNOOZE_DAYS = 3;

// localStorage can be blocked or full (private windows); a missing value just means "never" / "not snoozed".
const read = (key: string): number | null => {
  try {
    const n = Number(localStorage.getItem(key));
    return n > 0 ? n : null;
  } catch {
    return null;
  }
};
const write = (key: string, value: number) => {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* ignore */
  }
};

export const loadLastBackup = () => read(LAST_KEY);
/** Called when the person clicks Export backup (a download link, so the click is the only signal there is). */
export const markBackupDone = (now = Date.now()) => write(LAST_KEY, now);
export const loadBackupSnooze = () => read(SNOOZE_KEY);
export const snoozeBackupNudge = (now = Date.now()) => write(SNOOZE_KEY, now + SNOOZE_DAYS * DAY);

/** Nudge only when there is something to lose, the last backup is old or missing, and it was not snoozed. */
export function backupNudgeDue(a: { now: number; lastBackup: number | null; snoozedUntil: number | null; hasProgress: boolean }): boolean {
  if (!a.hasProgress) return false;
  if (a.snoozedUntil !== null && a.now < a.snoozedUntil) return false;
  return a.lastBackup === null || a.now - a.lastBackup > BACKUP_EVERY_DAYS * DAY;
}

export function describeLastBackup(now: number, last: number | null): string {
  if (last === null) return "No backup yet";
  const days = Math.floor((now - last) / DAY);
  return days <= 0 ? "Last backup: today" : days === 1 ? "Last backup: yesterday" : `Last backup: ${days} days ago`;
}
