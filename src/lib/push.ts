/**
 * スマホへの通知(Web Push)の登録。
 * iPhone はホーム画面に追加したアプリからしか通知を受け取れない(iOS 16.4 以降)。
 */

export type PushSupport = 'ok' | 'needs-home-screen' | 'unsupported';

export function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function pushSupport(): PushSupport {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  if (ios && !isStandalone()) return 'needs-home-screen';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  return 'ok';
}

function base64UrlToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function api(method: string, token: string, body?: unknown): Promise<Record<string, unknown>> {
  const res = await fetch('/api/push', {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) throw new Error('合言葉が違います。');
  if (res.status === 503) throw new Error('サーバー側の通知の準備ができていません。');
  if (!res.ok) throw new Error(`通知の設定に失敗しました(${res.status})。`);
  return (await res.json()) as Record<string, unknown>;
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() !== 'ok') return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/** 通知を許可してもらい、このスマホを宛先として登録する */
export async function enablePush(token: string): Promise<void> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('通知が許可されませんでした。スマホの設定 → 通知 から許可してください。');
  const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register('/sw.js'));
  await navigator.serviceWorker.ready;
  const { publicKey } = (await (await fetch('/api/push')).json()) as { publicKey?: string };
  if (!publicKey) throw new Error('サーバー側の通知の準備ができていません。');
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(publicKey) }));
  await api('POST', token, { subscription: sub.toJSON() });
}

export async function disablePush(token: string): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await api('DELETE', token, { endpoint: sub.endpoint });
  await sub.unsubscribe();
}

export async function sendTestPush(token: string): Promise<void> {
  await api('POST', token, { test: true });
}
