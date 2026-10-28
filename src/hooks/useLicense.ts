import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

/** What src-tauri/src/license.rs says about this PC */
export interface LicenseStatus {
  licensed: boolean;
  machineCode: string; // this PC's code, to send for a key
  name: string; // who it's licensed to
  expires: number | null; // Unix seconds; null: never
  message: string; // why it isn't licensed, when there's a reason
}

/**
 * Whether toyol is licensed on this PC: checked at startup, and until it is,
 * the panel shows Activation instead
 */
export function useLicense() {
  const [status, setStatus] = useState<LicenseStatus | null>(null); // null while checking
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    invoke<LicenseStatus>('license_status')
      .then(setStatus)
      .catch((e: unknown) => setStatus({ licensed: false, machineCode: '', name: '', expires: null, message: String(e) }));
  }, []);

  const activate = useCallback(async (key: string) => {
    setBusy(true);
    setError('');
    try {
      setStatus(await invoke<LicenseStatus>('license_activate', { key }));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  return { status, busy, error, licensed: status?.licensed === true, activate };
}
