import type { EventRow } from '../types/event';
import type { DayPlan, Task } from '../types/task';

const DB_NAME = 'calendar-db';
const DB_VERSION = 3;
const EVENTS_STORE = 'events';
const CATEGORIES_STORE = 'categories';
const TASKS_STORE = 'tasks';
const PLANS_STORE = 'plans';
/** ローカルで削除した同期済み予定の Google イベントID。次回同期時に Google 側からも消す。 */
const GOOGLE_TOMBSTONES_STORE = 'google_tombstones';
/** ネットに送る前の変更(送れたら消す)。オフラインでも変更を失わないためにここに貯める。 */
const OUTBOX_STORE = 'cloud_outbox';

export type LocalCollection = 'events' | 'tasks' | 'plans' | 'categories' | 'tombstones';

/** この端末で起きた変更。ネット保存(cloudSync)が受け取って、サーバーに送る。 */
export type LocalChange =
  | { kind: 'put'; collection: 'events'; value: EventRow }
  | { kind: 'put'; collection: 'tasks'; value: Task }
  | { kind: 'put'; collection: 'plans'; value: DayPlan }
  | { kind: 'put'; collection: 'categories' | 'tombstones'; value: string }
  | { kind: 'delete'; collection: LocalCollection; value: string };

let changeListener: ((change: LocalChange) => void) | null = null;

export function onLocalChange(listener: ((change: LocalChange) => void) | null): void {
  changeListener = listener;
}

function notify(change: LocalChange): void {
  changeListener?.(change);
}

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
      if (!db.objectStoreNames.contains(OUTBOX_STORE)) {
        db.createObjectStore(OUTBOX_STORE, { autoIncrement: true });
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
  notify({ kind: 'put', collection: 'events', value: event });
}

export async function dbDeleteEvent(id: string): Promise<void> {
  await withStore(EVENTS_STORE, 'readwrite', (store) => store.delete(id));
  notify({ kind: 'delete', collection: 'events', value: id });
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
  notify({ kind: 'put', collection: 'categories', value: name });
}

export async function dbGetAllTasks(): Promise<Task[]> {
  return withStore<Task[]>(TASKS_STORE, 'readonly', (store) => store.getAll() as IDBRequest<Task[]>);
}

export async function dbPutTask(task: Task): Promise<void> {
  await withStore(TASKS_STORE, 'readwrite', (store) => store.put(task));
  notify({ kind: 'put', collection: 'tasks', value: task });
}

export async function dbDeleteTask(id: string): Promise<void> {
  await withStore(TASKS_STORE, 'readwrite', (store) => store.delete(id));
  notify({ kind: 'delete', collection: 'tasks', value: id });
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
  notify({ kind: 'put', collection: 'plans', value: plan });
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
  notify({ kind: 'put', collection: 'tombstones', value: id });
}

export async function dbRemoveGoogleTombstone(id: string): Promise<void> {
  await withStore(GOOGLE_TOMBSTONES_STORE, 'readwrite', (store) => store.delete(id));
  notify({ kind: 'delete', collection: 'tombstones', value: id });
}

export interface LocalSnapshot {
  events: EventRow[];
  tasks: Task[];
  plans: DayPlan[];
  categories: string[];
  tombstones: string[];
}

/** この端末のデータを丸ごと読む(ネットへ初めて送るときに使う) */
export async function dbReadSnapshot(): Promise<LocalSnapshot> {
  const [events, tasks, plans, categories, tombstones] = await Promise.all([
    dbGetAllEvents(),
    dbGetAllTasks(),
    dbGetAllPlans(),
    dbGetAllCategories(),
    dbGetGoogleTombstones(),
  ]);
  return { events, tasks, plans, categories, tombstones };
}

/**
 * ネットから取ってきたデータで、この端末のデータを丸ごと置き換える。
 * ネットから来た変更なので、もう一度ネットに送らないよう notify はしない。
 */
export async function dbReplaceAll(snapshot: LocalSnapshot): Promise<void> {
  const db = await openDb();
  const stores = [EVENTS_STORE, TASKS_STORE, PLANS_STORE, CATEGORIES_STORE, GOOGLE_TOMBSTONES_STORE];
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(stores, 'readwrite');
    for (const name of stores) tx.objectStore(name).clear();
    for (const e of snapshot.events) tx.objectStore(EVENTS_STORE).put(e);
    for (const t of snapshot.tasks) tx.objectStore(TASKS_STORE).put(t);
    for (const p of snapshot.plans) tx.objectStore(PLANS_STORE).put(p);
    for (const name of snapshot.categories) tx.objectStore(CATEGORIES_STORE).put({ name });
    for (const id of snapshot.tombstones) tx.objectStore(GOOGLE_TOMBSTONES_STORE).put({ id });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function dbOutboxAdd(item: unknown): Promise<void> {
  await withStore(OUTBOX_STORE, 'readwrite', (store) => store.add(item));
}

export async function dbOutboxAll<T>(): Promise<{ key: IDBValidKey; value: T }[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const result: { key: IDBValidKey; value: T }[] = [];
    const request = db.transaction(OUTBOX_STORE, 'readonly').objectStore(OUTBOX_STORE).openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return resolve(result);
      result.push({ key: cursor.key, value: cursor.value as T });
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
}

export async function dbOutboxDelete(keys: IDBValidKey[]): Promise<void> {
  if (keys.length === 0) return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(OUTBOX_STORE, 'readwrite');
    for (const key of keys) tx.objectStore(OUTBOX_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
