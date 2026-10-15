/**
 * ネット上(Vercel Blob)に保存するデータの形と、変更(op)の適用。
 * サーバー(api/data.ts)とアプリの両方から使う純粋関数なので、ブラウザ専用のAPIは使わない。
 */

/** 予定。画像は Blob のままでは JSON にできないので data URL(文字列)で持つ。 */
export type CloudEvent = Record<string, unknown> & { id: string; image: string | null };

export interface CloudDoc {
  version: 1;
  events: Record<string, CloudEvent>;
  tasks: Record<string, Record<string, unknown> & { id: string }>;
  /** 1日の計画(キーは日付 yyyy-MM-dd) */
  plans: Record<string, Record<string, unknown> & { date: string }>;
  categories: string[];
  /** Googleから消すべき予定のID(Google同期用) */
  tombstones: string[];
  updated_at: string;
}

export type Collection = 'events' | 'tasks' | 'plans' | 'categories' | 'tombstones';

export type CloudOp =
  | { op: 'put'; collection: 'events'; record: CloudEvent }
  | { op: 'put'; collection: 'tasks'; record: Record<string, unknown> & { id: string } }
  | { op: 'put'; collection: 'plans'; record: Record<string, unknown> & { date: string } }
  | { op: 'put'; collection: 'categories' | 'tombstones'; key: string }
  | { op: 'delete'; collection: Collection; key: string };

export function emptyDoc(): CloudDoc {
  return { version: 1, events: {}, tasks: {}, plans: {}, categories: [], tombstones: [], updated_at: new Date(0).toISOString() };
}

const COLLECTIONS: Collection[] = ['events', 'tasks', 'plans', 'categories', 'tombstones'];

/** 受け取った op の形をざっと確かめる(不正なものは捨てる) */
export function isCloudOp(value: unknown): value is CloudOp {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (!COLLECTIONS.includes(v.collection as Collection)) return false;
  if (v.op === 'delete') return typeof v.key === 'string' && v.key !== '';
  if (v.op !== 'put') return false;
  if (v.collection === 'categories' || v.collection === 'tombstones') return typeof v.key === 'string' && v.key !== '';
  const record = v.record as Record<string, unknown> | undefined;
  if (!record || typeof record !== 'object') return false;
  return v.collection === 'plans' ? typeof record.date === 'string' : typeof record.id === 'string';
}

/** op を順に適用した新しい doc を返す(元の doc は変えない)。同じ op を2回適用しても結果は同じ。 */
export function applyOps(doc: CloudDoc, ops: CloudOp[], now = new Date()): CloudDoc {
  const next: CloudDoc = {
    ...doc,
    events: { ...doc.events },
    tasks: { ...doc.tasks },
    plans: { ...doc.plans },
    categories: [...doc.categories],
    tombstones: [...doc.tombstones],
  };
  for (const op of ops) {
    if (op.op === 'put') {
      if (op.collection === 'events') next.events[op.record.id] = op.record;
      else if (op.collection === 'tasks') next.tasks[op.record.id] = op.record;
      else if (op.collection === 'plans') next.plans[op.record.date] = op.record;
      else if (!next[op.collection].includes(op.key)) next[op.collection].push(op.key);
    } else if (op.collection === 'categories' || op.collection === 'tombstones') {
      next[op.collection] = next[op.collection].filter((k) => k !== op.key);
    } else {
      delete next[op.collection][op.key];
    }
  }
  next.updated_at = now.toISOString();
  return next;
}
