/**
 * Pictures of projects kept in this browser, in IndexedDB (localStorage is too small for
 * photos). Keyed by building id and slot. Without IndexedDB (a private window in some
 * browsers, or the test runner) every call does nothing and reads come back empty.
 */
const DB_NAME = "bauwerk";
const STORE = "photos";

interface Stored {
  key: string;
  buildingId: string;
  slot: string;
  blob: Blob;
  width: number;
  height: number;
}

let opening: Promise<IDBDatabase | null> | null = null;

function database(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  opening ??= new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(STORE, { keyPath: "key" });
      store.createIndex("building", "buildingId");
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      resolve(null);
    };
  });
  return opening;
}

function run<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  return database().then(
    (db) =>
      new Promise((resolve) => {
        if (!db) {
          resolve(null);
          return;
        }
        const request = work(db.transaction(STORE, mode).objectStore(STORE));
        request.onsuccess = () => {
          resolve(request.result);
        };
        request.onerror = () => {
          resolve(null);
        };
      }),
  );
}

const keyOf = (buildingId: string, slot: string) => `${buildingId}/${slot}`;

export const localPhotos = {
  async put(
    buildingId: string,
    slot: string,
    photo: { blob: Blob; width: number; height: number },
  ) {
    await run("readwrite", (s) =>
      s.put({ key: keyOf(buildingId, slot), buildingId, slot, ...photo }),
    );
  },
  async get(buildingId: string, slot: string): Promise<Stored | null> {
    return (
      (await run<Stored | undefined>(
        "readonly",
        (s) => s.get(keyOf(buildingId, slot)) as IDBRequest<Stored | undefined>,
      )) ?? null
    );
  },
  async list(buildingId: string): Promise<{ slot: string; width: number; height: number }[]> {
    const all = await run<Stored[]>(
      "readonly",
      (s) => s.index("building").getAll(buildingId) as IDBRequest<Stored[]>,
    );
    return (all ?? []).map(({ slot, width, height }) => ({ slot, width, height }));
  },
  async remove(buildingId: string, slot: string) {
    await run("readwrite", (s) => s.delete(keyOf(buildingId, slot)));
  },
  async removeAll(buildingId: string) {
    for (const { slot } of await this.list(buildingId)) await this.remove(buildingId, slot);
  },
};
