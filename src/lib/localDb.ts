import type { EventRow } from '../types/event';

const DB_NAME = 'calendar-db';
const DB_VERSION = 1;
const EVENTS_STORE = 'events';
const CATEGORIES_STORE = 'categories';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(EVENTS_STORE)) {
        db.createObjectStore(EVENTS_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(CATEGORIES_STORE)) {
        db.createObjectStore(CATEGORIES_STORE, { keyPath: 'name' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function withStore<T>(storeName: string, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const request = run(tx.objectStore(storeName));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }),
  );
}

export async function dbGetAllEvents(): Promise<EventRow[]> {
  return withStore<EventRow[]>(EVENTS_STORE, 'readonly', (store) => store.getAll() as IDBRequest<EventRow[]>);
}

export async function dbPutEvent(event: EventRow): Promise<void> {
  await withStore(EVENTS_STORE, 'readwrite', (store) => store.put(event));
}

export async function dbDeleteEvent(id: string): Promise<void> {
  await withStore(EVENTS_STORE, 'readwrite', (store) => store.delete(id));
}

export async function dbGetAllCategories(): Promise<string[]> {
  const rows = await withStore<{ name: string }[]>(
    CATEGORIES_STORE,
    'readonly',
    (store) => store.getAll() as IDBRequest<{ name: string }[]>,
  );
  return rows.map((r) => r.name);
}

export async function dbAddCategory(name: string): Promise<void> {
  await withStore(CATEGORIES_STORE, 'readwrite', (store) => store.put({ name }));
}
