import { useEffect, useRef } from 'react';
import { register, unregisterAll } from '@tauri-apps/plugin-global-shortcut';
import { comboFromEvent, formatAccelerator, HOTKEY_DEFS, type HotkeyId, type Hotkeys } from '../lib/hotkeys';

export type HotkeyHandlers = Record<Exclude<HotkeyId, 'voice'>, () => void> & {
  voiceDown: () => void;
  voiceUp: () => void;
};

// Registration passes run one at a time: when the shortcuts change, the effect
// re-runs while the previous pass may still be registering, and overlapping
// passes leave keys bound to a dead pass (from ScreenPrompt)
let queue: Promise<unknown> = Promise.resolve();
const enqueue = (task: () => Promise<unknown>) => {
  queue = queue.then(task, task);
};

/**
 * Registers the shortcuts: global ones with Windows (they work locked, hidden,
 * or with another app in front), focused ones as a keydown listener. Paused
 * while `suspended` (Settings is recording a new shortcut).
 */
export function useHotkeys(handlers: HotkeyHandlers, hotkeys: Hotkeys, suspended: boolean) {
  const handlersRef = useRef(handlers);
  const hotkeysRef = useRef(hotkeys);
  const suspendedRef = useRef(suspended);
  useEffect(() => {
    handlersRef.current = handlers;
    hotkeysRef.current = hotkeys;
    suspendedRef.current = suspended;
  });

  const bindingsKey = JSON.stringify(hotkeys);

  useEffect(() => {
    if (suspended) return;
    let live = true;
    const bindings: Hotkeys = JSON.parse(bindingsKey);
    const h = () => handlersRef.current;

    enqueue(async () => {
      if (!live) return;
      for (const def of HOTKEY_DEFS) {
        if (def.scope !== 'global') continue;
        try {
          // The plugin reports both Pressed and Released; only the voice key needs both
          await register(bindings[def.id], (event) => {
            if (!live) return;
            if (def.id === 'voice') {
              if (event.state === 'Pressed') h().voiceDown();
              else h().voiceUp();
            } else if (event.state === 'Pressed') {
              h()[def.id as Exclude<HotkeyId, 'voice'>]();
            }
          });
        } catch (error) {
          console.warn(`Couldn't register ${bindings[def.id]} (another app may use it):`, error);
        }
      }
    });

    return () => {
      live = false;
      enqueue(() => unregisterAll().catch((e) => console.error('Failed to unregister shortcuts:', e)));
    };
  }, [bindingsKey, suspended]);

  // Focused-only shortcuts: these combos mean something in other apps, so they
  // only act while the panel has focus. Capture phase, so the input box doesn't
  // also act on them.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (suspendedRef.current) return;
      const pressed = comboFromEvent(e);
      if (!pressed.code) return;
      const accelerator = formatAccelerator(pressed);
      const def = HOTKEY_DEFS.find((d) => d.scope === 'focused' && hotkeysRef.current[d.id] === accelerator);
      if (!def) return;
      e.preventDefault();
      e.stopPropagation();
      handlersRef.current[def.id as Exclude<HotkeyId, 'voice'>]();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);
}
