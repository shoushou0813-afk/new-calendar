/**
 * アプリのデータ置き場の受付窓口(Vercel Function)。
 *   GET  /api/data            … 全データを返す
 *   POST /api/data {ops: [...]} … 変更を適用して、適用後の全データを返す
 * どちらも Authorization: Bearer <APP_TOKEN> が必要(合言葉を知っている人だけが使える)。
 * データは Vercel Blob(非公開)に JSON 1ファイルとして保存し、ETag で同時書き込みの取りこぼしを防ぐ。
 */
import { BlobNotFoundError, BlobPreconditionFailedError, get, head, put } from '@vercel/blob';
import { applyOps, emptyDoc, isCloudOp, type CloudDoc } from './_lib/cloudDoc.js';

const PATHNAME = 'calendar/data.json';
const MAX_RETRIES = 5;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/** 合言葉の確認(長さが同じでも1文字ずつ比べ、比較にかかる時間から推測されにくくする) */
function authorized(request: Request): boolean {
  const expected = process.env.APP_TOKEN ?? '';
  const header = request.headers.get('authorization') ?? '';
  const given = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!expected || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

/**
 * 条件付き書き込み(ifMatch)に使う ETag は head() の値を使う。get() の ETag は配信側のレスポンスヘッダーの値で、
 * ifMatch と一致しないことがあるため。先に ETag を取ってから中身を読むので、間に誰かが書けば書き込みが失敗して読み直しになる。
 */
async function readDoc(): Promise<{ doc: CloudDoc; etag: string | null }> {
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
 * Vercel で Blob の保存場所をプロジェクトにつなぐと、BLOB_STORE_ID(OIDC認証)か
 * BLOB_READ_WRITE_TOKEN(従来の方式)が自動で入る。認証そのものは SDK がやってくれる。
 */
function storageReady(): boolean {
  return Boolean(process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN);
}

export async function GET(request: Request): Promise<Response> {
  if (!authorized(request)) return json({ error: 'unauthorized' }, 401);
  if (!storageReady()) return json({ error: 'storage not configured' }, 503);
  const { doc } = await readDoc();
  return json({ doc });
}

export async function POST(request: Request): Promise<Response> {
  if (!authorized(request)) return json({ error: 'unauthorized' }, 401);
  if (!storageReady()) return json({ error: 'storage not configured' }, 503);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid json' }, 400);
  }
  const rawOps = (body as { ops?: unknown })?.ops;
  if (!Array.isArray(rawOps)) return json({ error: 'ops must be an array' }, 400);
  const ops = rawOps.filter(isCloudOp);

  // 読む → 変更を適用 → 「読んだときから誰も書き換えていなければ」書く。書き換えられていたら読み直してやり直す。
  // 最後の1回は条件なしで書く(直前に読み直した最新に変更を重ねるので、取りこぼす幅はごくわずか)
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const { doc, etag } = await readDoc();
    const next = applyOps(doc, ops);
    try {
      await writeDoc(next, attempt === MAX_RETRIES - 1 ? null : etag);
      return json({ doc: next, applied: ops.length, rejected: rawOps.length - ops.length });
    } catch (err) {
      if (err instanceof BlobPreconditionFailedError) continue;
      throw err;
    }
  }
  return json({ error: 'conflict, please retry' }, 409);
}
