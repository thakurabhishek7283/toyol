import { useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { emitTo, listen } from '@tauri-apps/api/event';
import { register, unregister } from '@tauri-apps/plugin-global-shortcut';
import { captureRegion } from '../lib/capture';
import { SNIP_CANCEL_EVENT, SNIP_EVENT, type SnipResult } from '../components/SnipOverlay';

// The snip window never has focus (so the app being snipped stays in front),
// so it can't hear keys: Esc is taken system-wide while it's open
const CANCEL_KEY = 'Escape';

/**
 * Screenshots of a region picked with two clicks (SnipOverlay). `snip` opens
 * the picker; `onImage` gets the screenshot as a data URL.
 */
export function useSnip(onImage: (image: string) => void, onError: (message: string) => void) {
  const callbacks = useRef({ onImage, onError });
  useEffect(() => {
    callbacks.current = { onImage, onError };
  });

  const cancelKeyHeld = useRef(false);
  const releaseCancelKey = useCallback(() => {
    if (!cancelKeyHeld.current) return;
    cancelKeyHeld.current = false;
    unregister(CANCEL_KEY).catch(() => {});
  }, []);

  const snip = useCallback(async () => {
    try {
      await invoke('open_snip_window');
    } catch (error) {
      console.error('Snip failed:', error);
      callbacks.current.onError("Couldn't start the screenshot");
      return;
    }
    if (cancelKeyHeld.current) return;
    cancelKeyHeld.current = true;
    try {
      await register(CANCEL_KEY, (event) => {
        if (event.state !== 'Pressed') return;
        releaseCancelKey();
        emitTo('snip', SNIP_CANCEL_EVENT).catch(() => {});
      });
    } catch (error) {
      // Another app holds Esc: a right click still cancels
      cancelKeyHeld.current = false;
      console.warn('Failed to register Esc for the snip:', error);
    }
  }, [releaseCancelKey]);

  useEffect(() => {
    const unlisten = listen<SnipResult>(SNIP_EVENT, async ({ payload }) => {
      releaseCancelKey();
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
      releaseCancelKey();
    };
  }, [releaseCancelKey]);

  return snip;
}
