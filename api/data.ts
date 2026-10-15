/**
 * アプリのデータ置き場の受付窓口(Vercel Function)。
 *   GET  /api/data            … 全データを返す
 *   POST /api/data {ops: [...]} … 変更を適用して、適用後の全データを返す
 * どちらも Authorization: Bearer <APP_TOKEN> が必要(合言葉を知っている人だけが使える)。
 */
import { isCloudOp } from './_lib/cloudDoc.js';
import { readDoc, storageReady, tokenMatches, updateDoc } from './_lib/store.js';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function bearer(request: Request): string | null {
  const header = request.headers.get('authorization') ?? '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

export async function GET(request: Request): Promise<Response> {
  if (!tokenMatches(bearer(request))) return json({ error: 'unauthorized' }, 401);
  if (!storageReady()) return json({ error: 'storage not configured' }, 503);
  const { doc } = await readDoc();
  return json({ doc });
}

export async function POST(request: Request): Promise<Response> {
  if (!tokenMatches(bearer(request))) return json({ error: 'unauthorized' }, 401);
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
  try {
    const { doc } = await updateDoc(() => ({ ops, result: null }));
    return json({ doc, applied: ops.length, rejected: rawOps.length - ops.length });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('conflict')) return json({ error: 'conflict, please retry' }, 409);
    throw err;
  }
}
