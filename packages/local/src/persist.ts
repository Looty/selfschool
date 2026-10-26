/** Browser persistence: the SQLite file and the course/extension files are saved as one record in IndexedDB. */
const DB_NAME = "selfschool-local";
const STORE = "kv";
const KEY = "state";

export interface Saved {
  db: Uint8Array;
  files: Record<string, Uint8Array>;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadSaved(): Promise<Saved | undefined> {
  const idb = await open();
  return new Promise((resolve, reject) => {
    const r = idb.transaction(STORE).objectStore(STORE).get(KEY);
    r.onsuccess = () => {
      idb.close();
      resolve(r.result as Saved | undefined);
    };
    r.onerror = () => reject(r.error);
  });
}

export async function save(state: Saved): Promise<void> {
  const idb = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = idb.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(state, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    // An open connection would block "Delete all data" (indexedDB.deleteDatabase waits for every connection to close).
    idb.close();
  }
  // Ask the browser not to evict this under storage pressure (it may decline).
  void navigator.storage?.persist?.();
}
