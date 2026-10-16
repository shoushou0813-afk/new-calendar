import { addDays, format, parseISO } from 'date-fns';
import { eventEndDate, isMultiDay } from '../eventSpan';
import type { EventRow } from '../../types/event';
import { toHHmm, toMinutes } from '../planner/freeSlots';
import type { GoogleEvent, GoogleEventInput } from './googleCalendarApi';

/** Google 側の予定を、このアプリの予定の項目に変換する。時刻が読めなければ null。 */
export function googleToFields(ge: GoogleEvent): Pick<EventRow, 'title' | 'date' | 'starts_at' | 'ends_at' | 'end_date' | 'note'> | null {
  const title = ge.summary?.trim() || '(無題の予定)';
  const note = ge.description?.trim() || null;
  if (ge.start?.dateTime) {
    const start = new Date(ge.start.dateTime);
    if (Number.isNaN(start.getTime())) return null;
    const date = format(start, 'yyyy-MM-dd');
    let endsAt: string | null = null;
    let endDate: string | null = null;
    if (ge.end?.dateTime) {
      const end = new Date(ge.end.dateTime);
      const endDay = format(end, 'yyyy-MM-dd');
      const nextDay = format(addDays(parseISO(date), 1), 'yyyy-MM-dd');
      if (endDay === date) endsAt = format(end, 'HH:mm');
      // ちょうど翌日 0:00 に終わる予定は、その日の終わり(23:59)までの予定として持つ
      else if (endDay === nextDay && format(end, 'HH:mm') === '00:00') endsAt = '23:59';
      else if (endDay > date) {
        endDate = endDay;
        endsAt = format(end, 'HH:mm');
      }
    }
    return { title, date, starts_at: format(start, 'HH:mm'), ends_at: endsAt, end_date: endDate, note };
  }
  if (ge.start?.date) {
    // 終日の予定の end.date は「終わった次の日」なので1日戻す
    const lastDay = ge.end?.date ? format(addDays(parseISO(ge.end.date), -1), 'yyyy-MM-dd') : ge.start.date;
    return { title, date: ge.start.date, starts_at: '00:00', ends_at: null, end_date: lastDay > ge.start.date ? lastDay : null, note };
  }
  return null;
}

/** このアプリの予定を Google に送る形に変換する。 */
export function localToGoogle(row: EventRow, timeZone: string): GoogleEventInput {
  const description = [row.note, row.source_url].filter(Boolean).join('\n\n') || undefined;
  const lastDay = eventEndDate(row);
  // 終日の予定(0:00開始・終了時刻なし)は、Googleでも終日の予定にする
  if (row.starts_at === '00:00' && !row.ends_at) {
    return {
      summary: row.title,
      description,
      start: { date: row.date },
      end: { date: format(addDays(parseISO(lastDay), 1), 'yyyy-MM-dd') },
    };
  }
  if (isMultiDay(row)) {
    return {
      summary: row.title,
      description,
      start: { dateTime: `${row.date}T${row.starts_at}:00`, timeZone },
      end: { dateTime: `${lastDay}T${row.ends_at ?? '23:59'}:00`, timeZone },
    };
  }
  const startMin = toMinutes(row.starts_at);
  let endMin = row.ends_at ? toMinutes(row.ends_at) : startMin + 60;
  if (endMin <= startMin) endMin = startMin + 60;
  const endDate = endMin >= 24 * 60 ? format(addDays(parseISO(row.date), 1), 'yyyy-MM-dd') : row.date;
  return {
    summary: row.title,
    description,
    start: { dateTime: `${row.date}T${row.starts_at}:00`, timeZone },
    end: { dateTime: `${endDate}T${toHHmm(endMin % (24 * 60))}:00`, timeZone },
  };
}

export interface SyncPlan {
  /** Google にだけある予定 → ローカルに作る */
  createLocal: GoogleEvent[];
  /** Google 側で更新された予定 → ローカルを上書き */
  updateLocal: { local: EventRow; remote: GoogleEvent }[];
  /** Google 側で削除された予定 → ローカルからも消す */
  deleteLocal: EventRow[];
  /** ローカルにだけある予定 → Google に作る */
  pushCreate: EventRow[];
  /** ローカルで編集した予定 → Google を上書き */
  pushUpdate: EventRow[];
  /** ローカルで削除した同期済み予定 → Google からも消す */
  pushDelete: string[];
  /** すでに両方から消えているので記録を掃除してよいもの */
  clearTombstones: string[];
}

function isLocallyModified(row: EventRow): boolean {
  return !!row.google_synced_at && row.updated_at > row.google_synced_at;
}

function isRemotelyModified(row: EventRow, remote: GoogleEvent): boolean {
  return !row.google_synced_at || (!!remote.updated && remote.updated > row.google_synced_at);
}

/**
 * ローカルと Google の差分から、何をすべきかを決める(副作用なしの純粋関数)。
 * 両方で編集されていたら、更新時刻が新しいほうを採用する。
 */
export function computeSyncPlan(params: {
  local: EventRow[];
  remote: GoogleEvent[];
  tombstones: string[];
  /** 同期する期間 yyyy-MM-dd(両端含む) */
  from: string;
  to: string;
}): SyncPlan {
  const plan: SyncPlan = { createLocal: [], updateLocal: [], deleteLocal: [], pushCreate: [], pushUpdate: [], pushDelete: [], clearTombstones: [] };
  const byGoogleId = new Map(params.local.filter((e) => e.google_event_id).map((e) => [e.google_event_id!, e]));
  const tombstones = new Set(params.tombstones);
  const seenTombstones = new Set<string>();

  for (const remote of params.remote) {
    const local = byGoogleId.get(remote.id);
    if (tombstones.has(remote.id)) {
      seenTombstones.add(remote.id);
      if (remote.status === 'cancelled') plan.clearTombstones.push(remote.id);
      else plan.pushDelete.push(remote.id);
      continue;
    }
    if (remote.status === 'cancelled') {
      if (local) plan.deleteLocal.push(local);
      continue;
    }
    if (!local) {
      if (googleToFields(remote)) plan.createLocal.push(remote);
      continue;
    }
    const localChanged = isLocallyModified(local);
    const remoteChanged = isRemotelyModified(local, remote);
    if (localChanged && (!remoteChanged || local.updated_at >= (remote.updated ?? ''))) plan.pushUpdate.push(local);
    else if (remoteChanged) plan.updateLocal.push({ local, remote });
  }

  // 同期期間外などで今回見つからなかった削除記録も、Google に削除を送る(すでに無ければ成功扱い)
  for (const id of tombstones) {
    if (!seenTombstones.has(id)) plan.pushDelete.push(id);
  }

  for (const local of params.local) {
    if (local.google_event_id) continue;
    if (local.date < params.from || local.date > params.to) continue;
    plan.pushCreate.push(local);
  }
  return plan;
}

export function syncWindow(now: Date): { from: Date; to: Date; fromDate: string; toDate: string } {
  const from = addDays(new Date(now.getFullYear(), now.getMonth(), now.getDate()), -30);
  const to = addDays(from, 30 + 180);
  return { from, to, fromDate: format(from, 'yyyy-MM-dd'), toDate: format(addDays(to, -1), 'yyyy-MM-dd') };
}
