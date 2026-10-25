import { useCallback, useEffect, useRef, useState } from 'react';
import { relaunch } from '@tauri-apps/plugin-process';
import { check, type Update } from '@tauri-apps/plugin-updater';

// Looked for at startup and then this often, from the latest GitHub release
// (tauri.conf.json > plugins > updater; published by scripts/release.mjs)
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

export type UpdatePhase = 'idle' | 'checking' | 'current' | 'available' | 'installing' | 'failed';

/**
 * A newer version, when there is one. It installs only when asked (`install`),
 * never in the middle of something: the panel closes for the installer and
 * comes back updated.
 */
export function useUpdater() {
  const [phase, setPhase] = useState<UpdatePhase>('idle');
  const [error, setError] = useState('');
  const updateRef = useRef<Update | null>(null);
  const [version, setVersion] = useState('');

  const look = useCallback(async (quiet: boolean) => {
    if (!quiet) setPhase('checking');
    try {
      const update = await check();
      if (update) {
        updateRef.current = update;
        setVersion(update.version);
        setPhase('available');
      } else if (!quiet) {
        setPhase('current');
      }
    } catch (e) {
      // Offline, or no release yet: say so only when asked
      console.warn('Update check failed:', e);
      if (!quiet) {
        setError(String(e));
        setPhase('failed');
      }
    }
  }, []);

  useEffect(() => {
    if (import.meta.env.DEV) return; // a development build isn't installed
    look(true);
    const timer = window.setInterval(() => look(true), CHECK_EVERY_MS);
    return () => window.clearInterval(timer);
  }, [look]);

  const install = useCallback(async () => {
    const update = updateRef.current;
    if (!update) return;
    setPhase('installing');
    try {
      // On Windows the installer closes the app itself; relaunch is for the rest
      await update.downloadAndInstall();
      await relaunch();
    } catch (e) {
      console.error('Update failed:', e);
      setError(String(e));
      setPhase('failed');
    }
  }, []);

  return { phase, version, error, check: () => look(false), install };
}
