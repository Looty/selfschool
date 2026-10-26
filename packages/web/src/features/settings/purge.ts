/** Name of the IndexedDB database the in-browser build saves into (packages/local/src/persist.ts). */
export const LOCAL_DB_NAME = "selfschool-local";

/** Deletes a database; resolves once it is gone. `blocked` means another connection is still open, so wait for it. */
function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/**
 * Wipes everything the in-browser build keeps on this device: the saved database and course files, and every
 * `selfschool-*` preference (theme, font, backup dates). The caller reloads the page afterwards so the app starts empty.
 */
export async function purgeLocalData(): Promise<void> {
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith("selfschool-")) localStorage.removeItem(key);
  } catch {
    /* storage blocked: nothing to clear */
  }
  await deleteDatabase(LOCAL_DB_NAME);
}
