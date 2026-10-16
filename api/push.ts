/**
 * 通知の登録窓口。
 *   GET    /api/push              … 通知用の公開鍵を返す(合言葉不要)
 *   POST   /api/push {subscription} … このスマホを通知の宛先に登録
 *   DELETE /api/push {endpoint}     … 登録をやめる
 *   POST   /api/push {test: true}   … 今すぐ「明日の予定」を送ってみる
 */
import { todayInTokyo } from './_lib/calendarTools.js';
import { addDaysStr, dailyDigest } from './_lib/digest.js';
import { pushReady, sendDigests } from './_lib/push.js';
import { readDoc, readSubscriptions, storageReady, tokenMatches, writeSubscriptions, type PushSubscriptionRecord } from './_lib/store.js';

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

function isSubscription(v: unknown): v is Omit<PushSubscriptionRecord, 'created_at'> {
  const s = v as PushSubscriptionRecord | undefined;
  return !!s && typeof s.endpoint === 'string' && s.endpoint.startsWith('https://') && typeof s.keys?.p256dh === 'string' && typeof s.keys?.auth === 'string';
}

export async function GET(): Promise<Response> {
  if (!pushReady()) return json({ error: 'push not configured' }, 503);
  return json({ publicKey: process.env.VAPID_PUBLIC_KEY });
}

export async function POST(request: Request): Promise<Response> {
  if (!tokenMatches(bearer(request))) return json({ error: 'unauthorized' }, 401);
  if (!storageReady() || !pushReady()) return json({ error: 'not configured' }, 503);
  const body = (await request.json().catch(() => null)) as { subscription?: unknown; test?: boolean } | null;
  const subs = await readSubscriptions();
  if (body?.test) {
    const { doc } = await readDoc();
    const result = await sendDigests(subs, [dailyDigest(doc, addDaysStr(todayInTokyo(), 1))]);
    if (result.gone.length) await writeSubscriptions(subs.filter((s) => !result.gone.includes(s.endpoint)));
    return json({ ok: true, ...result, devices: subs.length });
  }
  if (!isSubscription(body?.subscription)) return json({ error: 'invalid subscription' }, 400);
  const { endpoint, keys } = body.subscription;
  const next = [...subs.filter((s) => s.endpoint !== endpoint), { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth }, created_at: new Date().toISOString() }];
  await writeSubscriptions(next);
  return json({ ok: true, devices: next.length });
}

export async function DELETE(request: Request): Promise<Response> {
  if (!tokenMatches(bearer(request))) return json({ error: 'unauthorized' }, 401);
  if (!storageReady()) return json({ error: 'storage not configured' }, 503);
  const body = (await request.json().catch(() => null)) as { endpoint?: string } | null;
  const subs = await readSubscriptions();
  const next = subs.filter((s) => s.endpoint !== body?.endpoint);
  if (next.length !== subs.length) await writeSubscriptions(next);
  return json({ ok: true, devices: next.length });
}
