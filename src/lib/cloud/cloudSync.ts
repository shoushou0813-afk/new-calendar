/**
 * ネット保存(Vercel の /api/data)との同期。
 *
 * - この端末のデータ(IndexedDB)はそのまま使い続ける(速い・電波がなくても動く)。
 * - この端末で何か変えたら、その変更(op)を「送信待ち」に貯めて、まとめてサーバーに送る。
 * - アプリを開いたとき・画面に戻ったとき・1分ごとに、サーバーの最新データを取ってきて置き換える。
 *   Claude がサーバーに書き込んだ予定やタスクも、これで端末に届く。
 */
import { applyOps, emptyDoc, type CloudDoc, type CloudEvent, type CloudOp, type IdRecord } from '../../../api/_lib/cloudDoc';
import type { EventRow } from '../../types/event';
import type { DayPlan, Task } from '../../types/task';
import type { Profile, Transaction } from '../../../api/_lib/money';
import {
  dbOutboxAdd,
  dbOutboxAll,
  dbOutboxDelete,
  dbReadSnapshot,
  dbReplaceAll,
  onLocalChange,
  type LocalChange,
  type LocalSnapshot,
} from '../localDb';

export const CLOUD_CHANGED_EVENT = 'cloud-data-changed';
const API_URL = '/api/data';
const LINKED_KEY = 'cloud-linked';
const PULL_INTERVAL_MS = 60_000;
const FLUSH_DELAY_MS = 800;

export interface CloudStatus {
  state: 'off' | 'syncing' | 'idle' | 'error';
  lastSyncedAt: string | null;
  error: string | null;
}

let token = '';
let status: CloudStatus = { state: 'off', lastSyncedAt: null, error: null };
const statusListeners = new Set<(s: CloudStatus) => void>();
let running: Promise<void> | null = null;
let rerun = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let pullTimer: ReturnType<typeof setInterval> | null = null;
let lastAppliedAt: string | null = null;
let changeQueue: Promise<void> = Promise.resolve();

function setStatus(patch: Partial<CloudStatus>): void {
  status = { ...status, ...patch };
  for (const listener of statusListeners) listener(status);
}

export function getCloudStatus(): CloudStatus {
  return status;
}

export function subscribeCloudStatus(listener: (s: CloudStatus) => void): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

// ---- 変換(端末の形 ⇔ ネットの形) ----

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function eventToCloud(event: EventRow): Promise<CloudEvent> {
  return { ...event, image: event.image ? await blobToDataUrl(event.image) : null } as unknown as CloudEvent;
}

async function eventFromCloud(event: CloudEvent): Promise<EventRow> {
  const image = typeof event.image === 'string' && event.image.startsWith('data:') ? await (await fetch(event.image)).blob() : null;
  return { ...(event as unknown as EventRow), image };
}

async function changeToOp(change: LocalChange): Promise<CloudOp> {
  if (change.kind === 'delete') return { op: 'delete', collection: change.collection, key: change.value };
  switch (change.collection) {
    case 'events':
      return { op: 'put', collection: 'events', record: await eventToCloud(change.value) };
    case 'tasks':
      return { op: 'put', collection: 'tasks', record: change.value as unknown as Record<string, unknown> & { id: string } };
    case 'plans':
      return { op: 'put', collection: 'plans', record: change.value as unknown as Record<string, unknown> & { date: string } };
    case 'transactions':
    case 'profiles':
      return { op: 'put', collection: change.collection, record: change.value as unknown as IdRecord };
    default:
      return { op: 'put', collection: change.collection, key: change.value };
  }
}

async function snapshotToOps(snapshot: LocalSnapshot, onlyMissingFrom?: CloudDoc): Promise<CloudOp[]> {
  const doc = onlyMissingFrom;
  const ops: CloudOp[] = [];
  for (const e of snapshot.events) if (!doc || !doc.events[e.id]) ops.push({ op: 'put', collection: 'events', record: await eventToCloud(e) });
  for (const t of snapshot.tasks)
    if (!doc || !doc.tasks[t.id]) ops.push({ op: 'put', collection: 'tasks', record: t as unknown as Record<string, unknown> & { id: string } });
  for (const p of snapshot.plans)
    if (!doc || !doc.plans[p.date]) ops.push({ op: 'put', collection: 'plans', record: p as unknown as Record<string, unknown> & { date: string } });
  for (const c of snapshot.categories) if (!doc || !doc.categories.includes(c)) ops.push({ op: 'put', collection: 'categories', key: c });
  for (const id of snapshot.tombstones) if (!doc || !doc.tombstones.includes(id)) ops.push({ op: 'put', collection: 'tombstones', key: id });
  for (const t of snapshot.transactions)
    if (!doc || !doc.transactions[t.id]) ops.push({ op: 'put', collection: 'transactions', record: t as unknown as IdRecord });
  for (const p of snapshot.profiles)
    if (!doc || !doc.profiles[p.id]) ops.push({ op: 'put', collection: 'profiles', record: p as unknown as IdRecord });
  return ops;
}

async function docToSnapshot(doc: CloudDoc): Promise<LocalSnapshot> {
  return {
    events: await Promise.all(Object.values(doc.events).map(eventFromCloud)),
    tasks: Object.values(doc.tasks) as unknown as Task[],
    plans: Object.values(doc.plans) as unknown as DayPlan[],
    categories: doc.categories,
    tombstones: doc.tombstones,
    transactions: Object.values(doc.transactions ?? {}) as unknown as Transaction[],
    profiles: Object.values(doc.profiles ?? {}) as unknown as Profile[],
  };
}

// ---- 通信 ----

async function request(method: 'GET' | 'POST', ops?: CloudOp[]): Promise<CloudDoc> {
  const res = await fetch(API_URL, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(ops ? { 'Content-Type': 'application/json' } : {}) },
    body: ops ? JSON.stringify({ ops }) : undefined,
    cache: 'no-store',
  });
  if (res.status === 401) throw new Error('合言葉が違います。設定を確認してください。');
  if (res.status === 503) throw new Error('Vercelで保存場所(Blob)がまだ用意されていません。');
  if (res.status === 404) throw new Error('ネット保存の窓口が見つかりません(デプロイ待ちかもしれません)。');
  if (!res.ok) throw new Error(`ネット保存に失敗しました(${res.status})。`);
  const body = (await res.json()) as { doc: CloudDoc };
  return { ...emptyDoc(), ...body.doc };
}

function linkedFor(t: string): boolean {
  try {
    return localStorage.getItem(LINKED_KEY) === t.slice(0, 8);
  } catch {
    return false;
  }
}

function markLinked(t: string): void {
  try {
    localStorage.setItem(LINKED_KEY, t.slice(0, 8));
  } catch {
    // 保存できなくても、次回また重複を避けつつ送るだけ
  }
}

async function runSync(): Promise<void> {
  setStatus({ state: 'syncing' });
  let doc: CloudDoc;

  // この端末で初めてネット保存を使うときは、端末にあってネットにないデータを送る
  if (!linkedFor(token)) {
    const remote = await request('GET');
    const ops = await snapshotToOps(await dbReadSnapshot(), remote);
    doc = ops.length > 0 ? await request('POST', ops) : remote;
    markLinked(token);
  }

  // 送信待ちの変更を送り、そのままサーバーの最新を受け取る
  const pending = await dbOutboxAll<CloudOp>();
  if (pending.length > 0) {
    doc = await request('POST', pending.map((p) => p.value));
    await dbOutboxDelete(pending.map((p) => p.key));
  } else {
    doc = await request('GET');
  }

  // 送っている間に増えた変更は、まだサーバーにないので上から重ねて反映する
  const stillPending = await dbOutboxAll<CloudOp>();
  const merged = stillPending.length > 0 ? applyOps(doc, stillPending.map((p) => p.value)) : doc;
  if (merged.updated_at !== lastAppliedAt || stillPending.length > 0) {
    await dbReplaceAll(await docToSnapshot(merged));
    lastAppliedAt = merged.updated_at;
    window.dispatchEvent(new Event(CLOUD_CHANGED_EVENT));
  }
  setStatus({ state: 'idle', lastSyncedAt: new Date().toISOString(), error: null });
}

/** 今すぐ同期する(同期中なら、終わったあとにもう1回) */
export function syncNow(): Promise<void> {
  if (!token) return Promise.resolve();
  if (running) {
    rerun = true;
    return running;
  }
  running = runSync()
    .catch((err: unknown) => {
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      setStatus({
        state: 'error',
        error: offline ? '電波がないため、つながったら送ります。' : err instanceof Error ? err.message : 'ネット保存に失敗しました。',
      });
    })
    .finally(() => {
      running = null;
      if (rerun) {
        rerun = false;
        void syncNow();
      }
    });
  return running;
}

function scheduleFlush(): void {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => void syncNow(), FLUSH_DELAY_MS);
}

function handleLocalChange(change: LocalChange): void {
  // 変更の順番を保つため、1件ずつ順に送信待ちに入れる
  changeQueue = changeQueue
    .then(async () => dbOutboxAdd(await changeToOp(change)))
    .then(scheduleFlush)
    .catch(() => setStatus({ state: 'error', error: '変更を送信待ちに入れられませんでした。' }));
}

function handleVisibility(): void {
  if (document.visibilityState === 'visible') void syncNow();
}

/** 合言葉を設定してネット保存を始める(空ならやめる) */
export function configureCloud(newToken: string): void {
  const next = newToken.trim();
  if (next === token) return;
  token = next;
  if (pullTimer) clearInterval(pullTimer);
  document.removeEventListener('visibilitychange', handleVisibility);
  if (!token) {
    onLocalChange(null);
    setStatus({ state: 'off', error: null });
    return;
  }
  onLocalChange(handleLocalChange);
  document.addEventListener('visibilitychange', handleVisibility);
  pullTimer = setInterval(() => {
    if (document.visibilityState === 'visible') void syncNow();
  }, PULL_INTERVAL_MS);
  void syncNow();
}
