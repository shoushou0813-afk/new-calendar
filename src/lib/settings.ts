/**
 * 端末ごとの設定。ブラウザの localStorage に保存する(この端末でしか使わない値なので)。
 * Anthropic APIキーもここに入るため、共有PCでは使わないこと。
 */
export interface AppSettings {
  /** Google Cloud で発行した OAuth クライアントID。未設定なら VITE_GOOGLE_CLIENT_ID を使う。 */
  googleClientId: string;
  /** 同期対象の Google カレンダーID。'primary' はメインのカレンダー。 */
  googleCalendarId: string;
  /** Google から取り込んだ予定に付けるカテゴリ */
  googleImportCategory: string;
  /** Claude API キー(AIプランナー用) */
  anthropicApiKey: string;
  /** 作業してよい時間帯 HH:mm */
  workStart: string;
  workEnd: string;
  /** 1回の作業ブロックの最大長(分) */
  maxBlockMinutes: number;
  /** ブロックの間に入れる休憩(分) */
  breakMinutes: number;
}

const STORAGE_KEY = 'calendar-settings';

export const DEFAULT_SETTINGS: AppSettings = {
  googleClientId: '',
  googleCalendarId: 'primary',
  googleImportCategory: 'その他',
  anthropicApiKey: '',
  workStart: '09:00',
  workEnd: '22:00',
  maxBlockMinutes: 50,
  breakMinutes: 10,
};

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<AppSettings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // プライベートブラウズ等で保存できない場合は、このタブの間だけ有効
  }
}

export function resolveGoogleClientId(settings: AppSettings): string {
  return settings.googleClientId.trim() || (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim() || '';
}
