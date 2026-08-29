import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_CATEGORIES } from '../lib/validation';
import { supabase } from '../lib/supabaseClient';

export function useCategories(userId: string | undefined) {
  const [customCategories, setCustomCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    const { data, error } = await supabase.from('categories').select('name').order('created_at', { ascending: true });
    if (!error && data) {
      setCustomCategories(data.map((row) => row.name));
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const categories = [
    ...DEFAULT_CATEGORIES,
    ...customCategories.filter((c) => !(DEFAULT_CATEGORIES as readonly string[]).includes(c)),
  ];

  const addCategory = async (name: string) => {
    if (!userId) return;
    const trimmed = name.trim();
    if (!trimmed || categories.includes(trimmed)) return;
    const { error } = await supabase.from('categories').insert({ user_id: userId, name: trimmed });
    if (!error) await reload();
  };

  return { categories, loading, addCategory };
}
