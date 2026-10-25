import { useCallback, useEffect, useRef, useState } from 'react';
import { load } from '@tauri-apps/plugin-store';
import { EMPTY_MEMORY, learnQuestion, learnTerms, type Memory } from '../lib/autocomplete';

// Its own file: it changes with every question, the settings rarely
const STORE_FILE = 'autocomplete.json';
const SAVE_DELAY_MS = 1500;

/** What autocompletion has learned, kept on this PC across restarts */
export function useMemory() {
  const [memory, setMemory] = useState<Memory>(EMPTY_MEMORY);
  const loaded = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        const store = await load(STORE_FILE);
        const saved = await store.get<Memory>('memory');
        if (saved) setMemory({ ...EMPTY_MEMORY, ...saved });
      } catch (error) {
        console.error('Failed to load autocomplete memory:', error);
      } finally {
        loaded.current = true;
      }
    })();
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
    const timer = window.setTimeout(async () => {
      try {
        const store = await load(STORE_FILE);
        await store.set('memory', memory);
        await store.save();
      } catch (error) {
        console.error('Failed to save autocomplete memory:', error);
      }
    }, SAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [memory]);

  const rememberQuestion = useCallback((question: string) => setMemory((m) => learnQuestion(m, question)), []);
  const rememberTerms = useCallback((text: string) => setMemory((m) => learnTerms(m, text)), []);

  return { memory, rememberQuestion, rememberTerms };
}
