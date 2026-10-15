import { useState } from 'react';
import { loadSettings, saveSettings, type AppSettings } from '../lib/settings';

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());

  const updateSettings = (next: AppSettings) => {
    saveSettings(next);
    setSettings(next);
  };

  return { settings, updateSettings };
}
