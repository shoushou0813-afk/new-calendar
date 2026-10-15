import type { EventRow } from '../../types/event';
import { dbDeleteEvent, dbGetAllEvents, dbGetGoogleTombstones, dbPutEvent, dbRemoveGoogleTombstone } from '../localDb';
import type { AppSettings } from '../settings';
import { getAccessToken } from './googleAuth';
import { deleteEvent, insertEvent, listEvents, patchEvent, type GoogleEvent } from './googleCalendarApi';
import { computeSyncPlan, googleToFields, localToGoogle, syncWindow } from './googleSync';

export interface SyncSummary {
  pulledNew: number;
  pulledUpdated: number;
  pulledDeleted: number;
  pushedNew: number;
  pushedUpdated: number;
  pushedDeleted: number;
}

function laterOf(a: string, b: string | undefined): string {
  return b && b > a ? b : a;
}

/** Googleカレンダーと双方向に同期する。終わったら呼び出し側で予定一覧を再読み込みすること。 */
export async function runGoogleSync(clientId: string, settings: AppSettings): Promise<SyncSummary> {
  const token = await getAccessToken(clientId);
  const calendarId = settings.googleCalendarId || 'primary';
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const window = syncWindow(new Date());

  const [remote, local, tombstones] = await Promise.all([
    listEvents(token, calendarId, window.from, window.to),
    dbGetAllEvents(),
    dbGetGoogleTombstones(),
  ]);
  const plan = computeSyncPlan({ local, remote, tombstones, from: window.fromDate, to: window.toDate });
  const now = () => new Date().toISOString();

  for (const ge of plan.createLocal) {
    const fields = googleToFields(ge)!;
    const ts = laterOf(now(), ge.updated);
    const row: EventRow = {
      ...fields,
      id: crypto.randomUUID(),
      category: settings.googleImportCategory || 'その他',
      doors_at: null,
      source_url: null,
      image: null,
      has_alarm: false,
      time_confirmed: false,
      warnings: [],
      memory_checked_at: null,
      miss_count: 0,
      google_event_id: ge.id,
      google_synced_at: ts,
      task_id: null,
      created_at: ts,
      updated_at: ts,
    };
    await dbPutEvent(row);
  }

  for (const { local: row, remote: ge } of plan.updateLocal) {
    const fields = googleToFields(ge);
    if (!fields) continue;
    const ts = laterOf(now(), ge.updated);
    const timeChanged = fields.date !== row.date || fields.starts_at !== row.starts_at;
    await dbPutEvent({
      ...row,
      ...fields,
      time_confirmed: timeChanged ? false : row.time_confirmed,
      google_synced_at: ts,
      updated_at: ts,
    });
  }

  for (const row of plan.deleteLocal) await dbDeleteEvent(row.id);

  const markPushed = async (row: EventRow, ge: GoogleEvent) => {
    const ts = laterOf(now(), ge.updated);
    await dbPutEvent({ ...row, google_event_id: ge.id, google_synced_at: ts, updated_at: ts });
  };

  for (const row of plan.pushCreate) await markPushed(row, await insertEvent(token, calendarId, localToGoogle(row, timeZone)));
  for (const row of plan.pushUpdate) await markPushed(row, await patchEvent(token, calendarId, row.google_event_id!, localToGoogle(row, timeZone)));

  for (const id of plan.pushDelete) {
    await deleteEvent(token, calendarId, id);
    await dbRemoveGoogleTombstone(id);
  }
  for (const id of plan.clearTombstones) await dbRemoveGoogleTombstone(id);

  return {
    pulledNew: plan.createLocal.length,
    pulledUpdated: plan.updateLocal.length,
    pulledDeleted: plan.deleteLocal.length,
    pushedNew: plan.pushCreate.length,
    pushedUpdated: plan.pushUpdate.length,
    pushedDeleted: plan.pushDelete.length,
  };
}
