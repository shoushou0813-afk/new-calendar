import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import type { EventDraft, EventRow } from '../types/event';

export function useEvents(userId: string | undefined) {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    const { data, error: fetchError } = await supabase.from('events').select('*').order('date', { ascending: true });
    if (fetchError) {
      setError(fetchError.message);
    } else {
      setError(null);
      setEvents(data as EventRow[]);
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const createEvent = async (draft: EventDraft) => {
    if (!userId) throw new Error('not authenticated');
    const { data, error: insertError } = await supabase
      .from('events')
      .insert({ ...draft, user_id: userId })
      .select('*')
      .single();
    if (insertError) throw insertError;
    await reload();
    return data as EventRow;
  };

  const updateEvent = async (id: string, patch: Partial<EventDraft>) => {
    const { data, error: updateError } = await supabase.from('events').update(patch).eq('id', id).select('*').single();
    if (updateError) throw updateError;
    await reload();
    return data as EventRow;
  };

  const deleteEvent = async (id: string) => {
    const { error: deleteError } = await supabase.from('events').delete().eq('id', id);
    if (deleteError) throw deleteError;
    await reload();
  };

  return { events, loading, error, reload, createEvent, updateEvent, deleteEvent };
}
