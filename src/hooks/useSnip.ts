import { useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { emitTo, listen } from '@tauri-apps/api/event';
import { captureRegion } from '../lib/capture';
import { ARROW_KEYS, takeKeys } from '../lib/takeKeys';
import { SNIP_CANCEL_EVENT, SNIP_EVENT, SNIP_KEY_EVENT, type SnipKey, type SnipResult } from '../components/SnipOverlay';

/**
 * Screenshots of a region picked with two clicks (SnipOverlay). `snip` opens
 * the picker; `onImage` gets the screenshot as a data URL. The snip window
 * never has focus (so the app being snipped stays in front), so it can't hear
 * keys: Esc, Enter, the arrows and Ctrl+A are taken system-wide while it's
 * open, and passed on to it.
 */
export function useSnip(onImage: (image: string) => void, onError: (message: string) => void) {
  const callbacks = useRef({ onImage, onError });
  useEffect(() => {
    callbacks.current = { onImage, onError };
  });

  const keysRef = useRef<Promise<() => void> | null>(null);
  const releaseKeys = useCallback(() => {
    const keys = keysRef.current;
    keysRef.current = null;
    keys?.then((release) => release());
  }, []);

  const snip = useCallback(async () => {
    try {
      await invoke('open_snip_window');
    } catch (error) {
      console.error('Snip failed:', error);
      callbacks.current.onError("Couldn't start the screenshot");
      return;
    }
    if (keysRef.current) return;
    const send = (key: SnipKey) => emitTo('snip', SNIP_KEY_EVENT, key).catch(() => {});
    // A key another app holds is skipped: the mouse still works, and a right click cancels
    keysRef.current = takeKeys([
      {
        keys: ['Escape'],
        run: () => {
          releaseKeys();
          emitTo('snip', SNIP_CANCEL_EVENT).catch(() => {});
        },
      },
      { keys: ['Enter'], run: () => send({ action: 'pick' }) },
      { keys: ['Ctrl+KeyA'], run: () => send({ action: 'all' }) },
      ...ARROW_KEYS.flatMap(([key, dx, dy]) => [
        { keys: [key], repeat: true, run: (held: number) => send({ action: 'move', dx, dy, held }) },
        { keys: [`Shift+${key}`], run: () => send({ action: 'edge', dx, dy }) },
      ]),
    ]);
  }, [releaseKeys]);

  useEffect(() => {
    const unlisten = listen<SnipResult>(SNIP_EVENT, async ({ payload }) => {
      releaseKeys();
      if (!payload.rect) return;
      try {
        callbacks.current.onImage(await captureRegion(payload.rect));
      } catch (error) {
        console.error('Screen capture failed:', error);
        callbacks.current.onError("Couldn't take the screenshot");
      }
    });
    return () => {
      unlisten.then((fn) => fn());
      releaseKeys();
    };
  }, [releaseKeys]);

  return snip;
}
