import { useCallback, useEffect, useRef, useState } from 'react';
import { load } from '@tauri-apps/plugin-store';
import { DEFAULT_CONFIG, type Config } from '../config';

const STORE_FILE = 'config.json';

/** The settings, loaded once and saved on every change */
export function useConfig() {
  const [config, setConfigState] = useState<Config>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    (async () => {
      try {
        const store = await load(STORE_FILE);
        const loaded: Partial<Record<keyof Config, unknown>> = {};
        for (const key of Object.keys(DEFAULT_CONFIG) as (keyof Config)[]) {
          const value = await store.get(key);
          if (value !== null && value !== undefined) loaded[key] = value;
        }
        setConfigState({ ...DEFAULT_CONFIG, ...(loaded as Partial<Config>) });
      } catch (error) {
        console.error('Failed to load settings:', error);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Stable, and merges into the latest state, so long-lived listeners (window
  // move/resize) can't undo newer changes. Saves run one at a time: each writes
  // the whole file, so an older save finishing last would undo a newer one.
  const setConfig = useCallback(async (updates: Partial<Config>) => {
    setConfigState((prev) => ({ ...prev, ...updates }));
    const save = saveQueue.current.then(async () => {
      const store = await load(STORE_FILE);
      for (const [key, value] of Object.entries(updates)) await store.set(key, value);
      await store.save();
    });
    saveQueue.current = save.catch(() => {});
    try {
      await save;
    } catch (error) {
      console.error('Failed to save settings:', error);
    }
  }, []);

  return { config, setConfig, loading };
}
