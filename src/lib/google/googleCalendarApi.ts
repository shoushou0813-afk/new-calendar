/** Google Calendar API v3 を fetch で直接呼ぶ薄いラッパー。 */

const BASE = 'https://www.googleapis.com/calendar/v3';

export interface GoogleEventTime {
  dateTime?: string;
  date?: string;
  timeZone?: string;
}

export interface GoogleEvent {
  id: string;
  status?: 'confirmed' | 'tentative' | 'cancelled';
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  updated?: string;
  start?: GoogleEventTime;
  end?: GoogleEventTime;
}

export interface GoogleEventInput {
  summary: string;
  description?: string;
  start: GoogleEventTime;
  end: GoogleEventTime;
}

async function request<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init.headers },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Google Calendar API エラー (${res.status}): ${body.slice(0, 200)}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** 期間内のイベントを全件取得(削除済みも含めて取得し、同期で消すのに使う)。繰り返し予定は1回ずつに展開する。 */
export async function listEvents(token: string, calendarId: string, timeMin: Date, timeMax: Date): Promise<GoogleEvent[]> {
  const all: GoogleEvent[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: 'true',
      showDeleted: 'true',
      maxResults: '250',
    });
    if (pageToken) params.set('pageToken', pageToken);
    const page = await request<{ items?: GoogleEvent[]; nextPageToken?: string }>(
      token,
      `/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
    );
    all.push(...(page.items ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return all;
}

export function insertEvent(token: string, calendarId: string, event: GoogleEventInput): Promise<GoogleEvent> {
  return request(token, `/calendars/${encodeURIComponent(calendarId)}/events`, { method: 'POST', body: JSON.stringify(event) });
}

export function patchEvent(token: string, calendarId: string, id: string, event: GoogleEventInput): Promise<GoogleEvent> {
  return request(token, `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(event),
  });
}

export async function deleteEvent(token: string, calendarId: string, id: string): Promise<void> {
  try {
    await request(token, `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(id)}`, { method: 'DELETE' });
  } catch (err) {
    // すでに消えている(410 Gone / 404)なら成功扱い
    if (err instanceof Error && /\((404|410)\)/.test(err.message)) return;
    throw err;
  }
}
