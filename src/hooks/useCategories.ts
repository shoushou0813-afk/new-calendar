import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_CATEGORIES } from '../lib/validation';
import { dbAddCategory, dbGetAllCategories } from '../lib/localDb';

export function useCategories() {
  const [customCategories, setCustomCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    setCustomCategories(await dbGetAllCategories());
    setLoading(false);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const categories = [
    ...DEFAULT_CATEGORIES,
    ...customCategories.filter((c) => !(DEFAULT_CATEGORIES as readonly string[]).includes(c)),
  ];

  const addCategory = async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed || categories.includes(trimmed)) return;
    await dbAddCategory(trimmed);
    await reload();
  };

  return { categories, loading, addCategory };
}
