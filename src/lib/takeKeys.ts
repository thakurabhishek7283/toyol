import { register, unregister } from '@tauri-apps/plugin-global-shortcut';

// Plain keys taken system-wide for a moment: moving the panel, or picking a
// snip region without the mouse, while another app keeps focus. Windows
// hotkeys don't repeat while held (the plugin reports Pressed once, then
// Released when let go), so a held key repeats here.

const REPEAT_DELAY_MS = 300;
const REPEAT_MS = 30;

export const ARROW_KEYS = [
  ['ArrowLeft', -1, 0],
  ['ArrowRight', 1, 0],
  ['ArrowUp', 0, -1],
  ['ArrowDown', 0, 1],
] as const;

export interface TakenKey {
  keys: string[]; // accelerators, e.g. "Shift+ArrowLeft"
  run: (held: number) => void; // held: ms since the key went down (0 on the press itself)
  repeat?: boolean; // keep running while held
}

/** Takes the keys until the function it resolves to is called. A key another app holds is skipped. */
export async function takeKeys(bindings: TakenKey[]): Promise<() => void> {
  const taken: string[] = [];
  const timers = new Map<string, number>();
  const stopRepeat = (key: string) => {
    window.clearTimeout(timers.get(key));
    timers.delete(key);
  };

  for (const { keys, run, repeat } of bindings) {
    for (const key of keys) {
      try {
        await register(key, (event) => {
          if (event.state === 'Released') {
            stopRepeat(key);
            return;
          }
          run(0);
          if (!repeat) return;
          const pressedAt = Date.now();
          stopRepeat(key);
          const tick = () => {
            run(Date.now() - pressedAt);
            timers.set(key, window.setTimeout(tick, REPEAT_MS));
          };
          timers.set(key, window.setTimeout(tick, REPEAT_DELAY_MS));
        });
        taken.push(key);
      } catch (error) {
        console.warn(`Couldn't take ${key} (another app may use it):`, error);
      }
    }
  }

  return () => {
    for (const key of [...timers.keys()]) stopRepeat(key);
    if (taken.length) unregister(taken).catch(() => {});
  };
}
