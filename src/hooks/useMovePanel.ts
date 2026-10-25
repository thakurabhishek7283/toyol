import { useCallback, useEffect, useRef, useState } from 'react';
import { availableMonitors, currentMonitor, getCurrentWindow, LogicalSize, PhysicalPosition } from '@tauri-apps/api/window';
import { ARROW_KEYS, takeKeys } from '../lib/takeKeys';

const appWindow = getCurrentWindow();
const STEP = 10; // logical px per arrow press
const FAST_STEP = 40; // per repeat, once held a while
const FAST_AFTER_MS = 700;
const MIN_WIDTH = 280; // as in tauri.conf.json
const MIN_HEIGHT = 220;
// The arrows are taken from every app meanwhile, so give them back if forgotten
const IDLE_MS = 10_000;
// Esc ends moving, and while locked the keyboard hook also reads it as unlock
const ESC_GRACE_MS = 500;

export async function isOnAnyMonitor(x: number, y: number): Promise<boolean> {
  const monitors = await availableMonitors();
  return monitors.some((m) => x >= m.position.x && x < m.position.x + m.size.width && y >= m.position.y && y < m.position.y + m.size.height);
}

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

/**
 * Moving and resizing the panel without the mouse. `toggle` takes the arrow
 * keys system-wide until Enter or Esc (or a while with no key), so it works
 * locked and with another app in front: arrows move the panel (faster when
 * held), Shift+arrows send it to that edge of the screen, Ctrl+arrows resize it.
 */
export function useMovePanel(onStart: () => void) {
  const [moving, setMoving] = useState(false);
  const keysRef = useRef<Promise<() => void> | null>(null);
  const idleTimer = useRef<number | undefined>(undefined);
  const endedAt = useRef(0);
  const inFlight = useRef(false);

  const stop = useCallback(() => {
    const keys = keysRef.current;
    if (!keys) return;
    keysRef.current = null;
    endedAt.current = Date.now();
    window.clearTimeout(idleTimer.current);
    keys.then((release) => release());
    setMoving(false);
  }, []);

  // One window change at a time: a held key asks faster than the window answers
  const change = useCallback((task: () => Promise<void>) => {
    window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(stop, IDLE_MS);
    if (inFlight.current) return;
    inFlight.current = true;
    task()
      .catch((e: unknown) => console.error('Moving the panel failed:', e))
      .finally(() => {
        inFlight.current = false;
      });
  }, [stop]);

  const nudge = useCallback((dx: number, dy: number, held: number) => change(async () => {
    const [pos, size, scale] = await Promise.all([appWindow.outerPosition(), appWindow.outerSize(), appWindow.scaleFactor()]);
    const step = Math.round((held > FAST_AFTER_MS ? FAST_STEP : STEP) * scale);
    const x = pos.x + dx * step;
    const y = pos.y + dy * step;
    // Its middle stays on a screen, so it can't be lost off the edge
    if (!(await isOnAnyMonitor(x + size.width / 2, y + size.height / 2))) return;
    await appWindow.setPosition(new PhysicalPosition(x, y));
  }), [change]);

  const toEdge = useCallback((dx: number, dy: number) => change(async () => {
    const [monitor, pos, size] = await Promise.all([currentMonitor(), appWindow.outerPosition(), appWindow.outerSize()]);
    if (!monitor) return;
    const { position: area, size: areaSize } = monitor.workArea;
    const x = dx < 0 ? area.x : dx > 0 ? area.x + areaSize.width - size.width : pos.x;
    const y = dy < 0 ? area.y : dy > 0 ? area.y + areaSize.height - size.height : pos.y;
    await appWindow.setPosition(new PhysicalPosition(x, y));
  }), [change]);

  // Right and Down grow it, Left and Up shrink it; the top-left corner stays put
  const resize = useCallback((dx: number, dy: number, held: number) => change(async () => {
    const [monitor, size, scale] = await Promise.all([currentMonitor(), appWindow.innerSize(), appWindow.scaleFactor()]);
    const logical = size.toLogical(scale);
    const step = held > FAST_AFTER_MS ? FAST_STEP : STEP;
    const max = monitor ? monitor.workArea.size.toLogical(monitor.scaleFactor) : { width: Infinity, height: Infinity };
    const width = clamp(Math.round(logical.width + dx * step), MIN_WIDTH, max.width);
    const height = clamp(Math.round(logical.height + dy * step), MIN_HEIGHT, max.height);
    await appWindow.setSize(new LogicalSize(width, height));
  }), [change]);

  const start = useCallback(() => {
    if (keysRef.current) return;
    onStart();
    setMoving(true);
    idleTimer.current = window.setTimeout(stop, IDLE_MS);
    keysRef.current = takeKeys([
      { keys: ['Enter', 'Escape'], run: stop },
      ...ARROW_KEYS.flatMap(([key, dx, dy]) => [
        { keys: [key], repeat: true, run: (held: number) => nudge(dx, dy, held) },
        { keys: [`Shift+${key}`], run: () => toEdge(dx, dy) },
        { keys: [`Ctrl+${key}`], repeat: true, run: (held: number) => resize(dx, dy, held) },
      ]),
    ]);
  }, [onStart, stop, nudge, toEdge, resize]);

  const toggle = useCallback(() => {
    if (keysRef.current) stop();
    else start();
  }, [start, stop]);

  // Whether an Esc now was for moving, not for unlocking
  const escapeIsOurs = useCallback(() => keysRef.current !== null || Date.now() - endedAt.current < ESC_GRACE_MS, []);

  useEffect(() => stop, [stop]);

  return { moving, toggle, stop, escapeIsOurs };
}
