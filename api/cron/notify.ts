/**
 * 毎晩21時(日本時間)に Vercel Cron が呼ぶ。明日の予定を、日曜は来週の予定も、登録したスマホに通知する。
 * Vercel Cron は Authorization: Bearer <CRON_SECRET> を付けて呼ぶので、それ以外からは動かない。
 */
import { todayInTokyo } from '../_lib/calendarTools.js';
import { digestsFor } from '../_lib/digest.js';
import { pushReady, sendDigests } from '../_lib/push.js';
import { readDoc, readSubscriptions, storageReady, writeSubscriptions } from '../_lib/store.js';

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) return new Response('unauthorized', { status: 401 });
  if (!storageReady() || !pushReady()) return new Response('not configured', { status: 503 });
  const subs = await readSubscriptions();
  if (subs.length === 0) return Response.json({ sent: 0, devices: 0 });
  const { doc } = await readDoc();
  const result = await sendDigests(subs, digestsFor(doc, todayInTokyo()));
  if (result.gone.length) await writeSubscriptions(subs.filter((s) => !result.gone.includes(s.endpoint)));
  return Response.json({ ...result, devices: subs.length });
}
