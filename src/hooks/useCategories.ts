import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_CATEGORIES } from '../lib/validation';
import { dbAddCategory, dbGetAllCategories } from '../lib/localDb';
import { CLOUD_CHANGED_EVENT } from '../lib/cloud/cloudSync';

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
    // ネット保存から新しいデータが届いたら読み直す
    const onCloud = () => void reload();
    window.addEventListener(CLOUD_CHANGED_EVENT, onCloud);
    return () => window.removeEventListener(CLOUD_CHANGED_EVENT, onCloud);
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
