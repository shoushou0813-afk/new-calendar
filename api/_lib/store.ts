/**
 * Vercel Blob(非公開)に置いた JSON 1ファイルの読み書き。/api/data と /api/mcp の両方から使う。
 */
import { BlobNotFoundError, BlobPreconditionFailedError, get, head, put } from '@vercel/blob';
import { applyOps, emptyDoc, type CloudDoc, type CloudOp } from './cloudDoc.js';

const PATHNAME = 'calendar/data.json';
const MAX_RETRIES = 5;

/**
 * Vercel で Blob の保存場所をプロジェクトにつなぐと、BLOB_STORE_ID(OIDC認証)か
 * BLOB_READ_WRITE_TOKEN(従来の方式)が自動で入る。認証そのものは SDK がやってくれる。
 */
export function storageReady(): boolean {
  return Boolean(process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN);
}

/** 合言葉の確認(比較にかかる時間から推測されにくいよう、1文字ずつ全部比べる) */
export function tokenMatches(given: string | null | undefined): boolean {
  const expected = process.env.APP_TOKEN ?? '';
  if (!expected || !given || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

/**
 * 条件付き書き込み(ifMatch)に使う ETag は head() の値を使う。get() の ETag は配信側のレスポンスヘッダーの値で、
 * ifMatch と一致しないことがあるため。先に ETag を取ってから中身を読むので、間に誰かが書けば書き込みが失敗して読み直しになる。
 */
export async function readDoc(): Promise<{ doc: CloudDoc; etag: string | null }> {
  let etag: string;
  try {
    etag = (await head(PATHNAME)).etag;
  } catch (err) {
    if (err instanceof BlobNotFoundError) return { doc: emptyDoc(), etag: null };
    throw err;
  }
  const result = await get(PATHNAME, { access: 'private', useCache: false });
  if (!result || result.statusCode !== 200) return { doc: emptyDoc(), etag: null };
  const text = await new Response(result.stream).text();
  return { doc: { ...emptyDoc(), ...(JSON.parse(text) as CloudDoc) }, etag };
}

async function writeDoc(doc: CloudDoc, etag: string | null): Promise<void> {
  await put(PATHNAME, JSON.stringify(doc), {
    access: 'private',
    contentType: 'application/json',
    allowOverwrite: true,
    addRandomSuffix: false,
    cacheControlMaxAge: 60,
    ...(etag ? { ifMatch: etag } : {}),
  });
}

/**
 * 読む → 変更を作って適用 → 「読んだときから誰も書き換えていなければ」書く。書き換えられていたら読み直してやり直す。
 * 最後の1回は条件なしで書く(直前に読み直した最新に変更を重ねるので、取りこぼす幅はごくわずか)。
 * makeOps は最新のデータを見て変更を作る(やり直すたびに呼ばれる)。
 */
export async function updateDoc<T>(makeOps: (doc: CloudDoc) => { ops: CloudOp[]; result: T }): Promise<{ doc: CloudDoc; result: T }> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const { doc, etag } = await readDoc();
    const { ops, result } = makeOps(doc);
    if (ops.length === 0) return { doc, result };
    const next = applyOps(doc, ops);
    try {
      await writeDoc(next, attempt === MAX_RETRIES - 1 ? null : etag);
      return { doc: next, result };
    } catch (err) {
      if (err instanceof BlobPreconditionFailedError) continue;
      throw err;
    }
  }
  throw new Error('conflict, please retry');
}

// ---- 通知の宛先(スマホごとのプッシュ通知の受け口)。予定のデータとは別のファイルに置く ----

const PUSH_PATH = 'calendar/push.json';

export interface PushSubscriptionRecord {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  created_at: string;
}

export async function readSubscriptions(): Promise<PushSubscriptionRecord[]> {
  try {
    await head(PUSH_PATH);
  } catch (err) {
    if (err instanceof BlobNotFoundError) return [];
    throw err;
  }
  const result = await get(PUSH_PATH, { access: 'private', useCache: false });
  if (!result || result.statusCode !== 200) return [];
  const parsed = JSON.parse(await new Response(result.stream).text()) as { subscriptions?: PushSubscriptionRecord[] };
  return parsed.subscriptions ?? [];
}

export async function writeSubscriptions(subscriptions: PushSubscriptionRecord[]): Promise<void> {
  await put(PUSH_PATH, JSON.stringify({ subscriptions }), {
    access: 'private',
    contentType: 'application/json',
    allowOverwrite: true,
    addRandomSuffix: false,
    cacheControlMaxAge: 60,
  });
}
