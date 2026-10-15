import { useCallback, useEffect, useState } from 'react';
import { dbAddGoogleTombstone, dbDeleteEvent, dbGetAllEvents, dbPutEvent } from '../lib/localDb';
import { CLOUD_CHANGED_EVENT } from '../lib/cloud/cloudSync';
import type { EventDraft, EventRow } from '../types/event';

export function useEvents() {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    const rows = await dbGetAllEvents();
    setEvents(rows.sort((a, b) => a.date.localeCompare(b.date) || a.starts_at.localeCompare(b.starts_at)));
    setLoading(false);
  }, []);

  useEffect(() => {
    reload();
    // ネット保存から新しいデータが届いたら読み直す
    const onCloud = () => void reload();
    window.addEventListener(CLOUD_CHANGED_EVENT, onCloud);
    return () => window.removeEventListener(CLOUD_CHANGED_EVENT, onCloud);
  }, [reload]);

  const createEvent = async (draft: EventDraft) => {
    const now = new Date().toISOString();
    const row: EventRow = {
      ...draft,
      id: crypto.randomUUID(),
      warnings: draft.warnings ?? [],
      memory_checked_at: null,
      miss_count: 0,
      created_at: now,
      updated_at: now,
    };
    await dbPutEvent(row);
    await reload();
    return row;
  };

  const updateEvent = async (id: string, patch: Partial<EventDraft>) => {
    const existing = events.find((e) => e.id === id);
    if (!existing) throw new Error('event not found');
    const updated: EventRow = { ...existing, ...patch, updated_at: new Date().toISOString() };
    await dbPutEvent(updated);
    await reload();
    return updated;
  };

  const deleteEvent = async (id: string) => {
    const existing = events.find((e) => e.id === id);
    if (existing?.google_event_id) await dbAddGoogleTombstone(existing.google_event_id);
    await dbDeleteEvent(id);
    await reload();
  };

  const deleteEvents = async (ids: string[]) => {
    for (const id of ids) {
      const existing = events.find((e) => e.id === id);
      if (existing?.google_event_id) await dbAddGoogleTombstone(existing.google_event_id);
      await dbDeleteEvent(id);
    }
    await reload();
  };

  const importEvents = async (drafts: EventDraft[]) => {
    const now = new Date().toISOString();
    for (const draft of drafts) {
      await dbPutEvent({
        ...draft,
        id: crypto.randomUUID(),
        warnings: draft.warnings ?? [],
        memory_checked_at: null,
        miss_count: 0,
        created_at: now,
        updated_at: now,
      });
    }
    await reload();
  };

  return { events, loading, reload, createEvent, updateEvent, deleteEvent, deleteEvents, importEvents };
}
