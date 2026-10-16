/** プッシュ通知の送信(web-push)。鍵は Vercel の環境変数 VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY */
import webpush from 'web-push';
import type { Digest } from './digest.js';
import type { PushSubscriptionRecord } from './store.js';

export function pushReady(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

/** 送って、もう届かない宛先(アプリを消した・通知をオフにした)の endpoint を返す */
export async function sendDigests(subscriptions: PushSubscriptionRecord[], digests: Digest[]): Promise<{ sent: number; gone: string[] }> {
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:noreply@example.com', process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
  let sent = 0;
  const gone: string[] = [];
  for (const sub of subscriptions) {
    for (const digest of digests) {
      try {
        await webpush.sendNotification(sub, JSON.stringify(digest), { TTL: 6 * 3600, urgency: 'normal' });
        sent++;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          gone.push(sub.endpoint);
          break;
        }
      }
    }
  }
  return { sent, gone };
}
