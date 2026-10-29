import { useEffect, useState } from "react";
import { apiHref } from "../../basePath";
import { Button } from "../../ui";
import { LOCAL, backupNudgeDue, describeLastBackup, loadBackupSnooze, loadLastBackup, markBackupDone, snoozeBackupNudge } from "../settings/backup";

/**
 * Only in the in-browser build, where progress lives in this browser and the browser may clear it: a quiet reminder to
 * export a backup when there is progress and the last backup is missing or old. "Later" hides it for a few days.
 */
export function BackupNudge({ hasProgress }: { hasProgress: boolean }) {
  const [hidden, setHidden] = useState(false);
  // false when the browser has not promised to keep the data (it may clear it when space runs low); null while unknown
  const [persisted, setPersisted] = useState<boolean | null>(null);
  useEffect(() => {
    if (LOCAL) void navigator.storage?.persisted?.().then(setPersisted, () => setPersisted(null));
  }, []);

  const now = Date.now();
  const last = loadLastBackup();
  if (!LOCAL || hidden || !backupNudgeDue({ now, lastBackup: last, snoozedUntil: loadBackupSnooze(), hasProgress })) return null;

  return (
    <div role="status" className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-button border border-border bg-warn-bg px-3.5 py-2.5 text-[13px]">
      <span className="min-w-0 flex-[1_1_320px] text-text">
        Your progress is saved only in this browser{persisted === false ? ", and the browser may clear it when space runs low" : ""}. {describeLastBackup(now, last)}.
      </span>
      <a
        href={apiHref("/api/backup", import.meta.env.BASE_URL)}
        download
        onClick={() => {
          markBackupDone();
          setHidden(true);
        }}
        className="inline-flex h-7 items-center rounded-button border border-border2 bg-bg px-2.5 text-xs font-medium text-text no-underline hover:bg-surface2"
      >
        Export backup
      </a>
      <Button
        size="sm"
        onClick={() => {
          snoozeBackupNudge();
          setHidden(true);
        }}
        className="!h-7 !px-2.5 !text-xs"
      >
        Later
      </Button>
    </div>
  );
}
