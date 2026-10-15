/**
 * Google Identity Services(GIS)でアクセストークンを取得する。
 * バックエンドなしのブラウザアプリなので「トークンモデル」(ポップアップで許可→短時間有効なトークン)を使う。
 * https://developers.google.com/identity/oauth2/web/guides/use-token-model
 */

const GIS_SRC = 'https://accounts.google.com/gsi/client';
export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface TokenClient {
  requestAccessToken: (overrides?: { prompt?: string }) => void;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (response: TokenResponse) => void;
            error_callback?: (error: { type: string; message?: string }) => void;
          }) => TokenClient;
          revoke: (token: string, done?: () => void) => void;
        };
      };
    };
  }
}

let scriptPromise: Promise<void> | null = null;
let cachedToken: { token: string; expiresAt: number } | null = null;

function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = GIS_SRC;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        scriptPromise = null;
        reject(new Error('Googleのログイン用スクリプトを読み込めませんでした。'));
      };
      document.head.appendChild(script);
    });
  }
  return scriptPromise;
}

/** 有効なアクセストークンを返す。期限切れなら Google の許可ポップアップを出す。 */
export async function getAccessToken(clientId: string): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token;
  await loadGis();
  const oauth2 = window.google!.accounts.oauth2;

  return new Promise((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: clientId,
      scope: CALENDAR_SCOPE,
      callback: (res) => {
        if (res.error || !res.access_token) {
          reject(new Error(res.error_description || res.error || 'Googleの認証に失敗しました。'));
          return;
        }
        cachedToken = { token: res.access_token, expiresAt: Date.now() + (res.expires_in ?? 3600) * 1000 };
        resolve(res.access_token);
      },
      error_callback: (err) => reject(new Error(err.type === 'popup_closed' ? 'Googleの許可画面が閉じられました。' : (err.message ?? err.type))),
    });
    client.requestAccessToken({ prompt: cachedToken ? '' : undefined });
  });
}

export function isGoogleConnected(): boolean {
  return !!cachedToken && cachedToken.expiresAt > Date.now();
}

export function disconnectGoogle(): void {
  if (cachedToken && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(cachedToken.token);
  cachedToken = null;
}
