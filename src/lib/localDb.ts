import type { EventRow } from '../types/event';
import type { DayPlan, Task } from '../types/task';

const DB_NAME = 'calendar-db';
const DB_VERSION = 2;
const EVENTS_STORE = 'events';
const CATEGORIES_STORE = 'categories';
const TASKS_STORE = 'tasks';
const PLANS_STORE = 'plans';
/** ローカルで削除した同期済み予定の Google イベントID。次回同期時に Google 側からも消す。 */
const GOOGLE_TOMBSTONES_STORE = 'google_tombstones';

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
      if (!db.objectStoreNames.contains(TASKS_STORE)) {
        db.createObjectStore(TASKS_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(PLANS_STORE)) {
        db.createObjectStore(PLANS_STORE, { keyPath: 'date' });
      }
      if (!db.objectStoreNames.contains(GOOGLE_TOMBSTONES_STORE)) {
        db.createObjectStore(GOOGLE_TOMBSTONES_STORE, { keyPath: 'id' });
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

export async function dbGetAllTasks(): Promise<Task[]> {
  return withStore<Task[]>(TASKS_STORE, 'readonly', (store) => store.getAll() as IDBRequest<Task[]>);
}

export async function dbPutTask(task: Task): Promise<void> {
  await withStore(TASKS_STORE, 'readwrite', (store) => store.put(task));
}

export async function dbDeleteTask(id: string): Promise<void> {
  await withStore(TASKS_STORE, 'readwrite', (store) => store.delete(id));
}

export async function dbGetPlan(date: string): Promise<DayPlan | null> {
  const plan = await withStore<DayPlan | undefined>(
    PLANS_STORE,
    'readonly',
    (store) => store.get(date) as IDBRequest<DayPlan | undefined>,
  );
  return plan ?? null;
}

export async function dbGetAllPlans(): Promise<DayPlan[]> {
  return withStore<DayPlan[]>(PLANS_STORE, 'readonly', (store) => store.getAll() as IDBRequest<DayPlan[]>);
}

export async function dbPutPlan(plan: DayPlan): Promise<void> {
  await withStore(PLANS_STORE, 'readwrite', (store) => store.put(plan));
}

export async function dbGetGoogleTombstones(): Promise<string[]> {
  const rows = await withStore<{ id: string }[]>(
    GOOGLE_TOMBSTONES_STORE,
    'readonly',
    (store) => store.getAll() as IDBRequest<{ id: string }[]>,
  );
  return rows.map((r) => r.id);
}

export async function dbAddGoogleTombstone(id: string): Promise<void> {
  await withStore(GOOGLE_TOMBSTONES_STORE, 'readwrite', (store) => store.put({ id }));
}

export async function dbRemoveGoogleTombstone(id: string): Promise<void> {
  await withStore(GOOGLE_TOMBSTONES_STORE, 'readwrite', (store) => store.delete(id));
}
