import { useEffect, useRef, useState } from 'react';
import { emitTo, listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { ScreenRect } from '../lib/capture';
import { rectBetween, snipClick, snipStep, type Point, type Rect, type SnipState } from '../lib/snip';
import '../styles/snip.css';

/** Sent to the panel when done: the region picked (physical px), or null if cancelled */
export const SNIP_EVENT = 'snip';
export interface SnipResult {
  rect: ScreenRect | null;
}
/** Sent to the snip window to cancel (Esc: this window never has focus, so the panel hears it) */
export const SNIP_CANCEL_EVENT = 'snip-cancel';
/** Sent to the snip window for the other keys the panel hears for it (useSnip) */
export const SNIP_KEY_EVENT = 'snip-key';
export type SnipKey =
  | { action: 'move'; dx: number; dy: number; held: number } // an arrow: the crosshair moves
  | { action: 'edge'; dx: number; dy: number } // Shift+arrow: to that edge of the screen
  | { action: 'pick' } // Enter: a corner where the crosshair is
  | { action: 'all' }; // Ctrl+A: the whole screen

const KEY_STEP_PX = 10;
const KEY_FAST_STEP_PX = 40; // once an arrow is held a while
const KEY_FAST_AFTER_MS = 700;

/**
 * The snip window (open_snip_window), over the monitor the mouse is on: click
 * one corner of the region, then the opposite one. Guide lines follow the
 * mouse; after the first click the region shows with everything else dimmed.
 * Esc or a right click cancels. Without the mouse, the arrows move the guide
 * lines and Enter picks a corner. It never takes focus, so the app being
 * snipped stays in front.
 */
function SnipOverlay() {
  const [state, setStateValue] = useState<SnipState>({ phase: 'first' });
  const [mouse, setMouseValue] = useState<Point | null>(null);
  // Mirrored for the keys' listener
  const stateRef = useRef(state);
  const mouseRef = useRef(mouse);
  const doneRef = useRef(false);

  const setState = (next: SnipState) => {
    stateRef.current = next;
    setStateValue(next);
  };
  const setMouse = (next: Point) => {
    mouseRef.current = next;
    setMouseValue(next);
  };

  const finish = async (region: Rect | null) => {
    if (doneRef.current) return;
    doneRef.current = true;
    const win = getCurrentWindow();
    let rect: ScreenRect | null = null;
    if (region) {
      // CSS px in this window -> physical screen px, as the capture takes them
      const origin = await win.outerPosition();
      const scale = window.devicePixelRatio;
      rect = {
        x: origin.x + Math.round(region.left * scale),
        y: origin.y + Math.round(region.top * scale),
        width: Math.round(region.width * scale),
        height: Math.round(region.height * scale),
      };
    }
    try {
      await emitTo('main', SNIP_EVENT, { rect } satisfies SnipResult);
    } finally {
      await win.close();
    }
  };

  useEffect(() => {
    const onKey = (key: SnipKey) => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      if (key.action === 'all') {
        finish({ left: 0, top: 0, width, height });
        return;
      }
      // The keyboard's crosshair starts where the mouse is, or in the middle
      const at = mouseRef.current ?? { x: Math.round(width / 2), y: Math.round(height / 2) };
      if (key.action === 'pick') {
        const step = snipClick(stateRef.current, at);
        if (step.done !== undefined) finish(step.done);
        else setState(step.state);
        setMouse(at);
      } else if (key.action === 'edge') {
        setMouse({
          x: key.dx < 0 ? 0 : key.dx > 0 ? width : at.x,
          y: key.dy < 0 ? 0 : key.dy > 0 ? height : at.y,
        });
      } else {
        const step = key.held > KEY_FAST_AFTER_MS ? KEY_FAST_STEP_PX : KEY_STEP_PX;
        setMouse({
          x: Math.max(0, Math.min(width, at.x + key.dx * step)),
          y: Math.max(0, Math.min(height, at.y + key.dy * step)),
        });
      }
    };
    const unlistenCancel = listen(SNIP_CANCEL_EVENT, () => finish(null));
    const unlistenKey = listen<SnipKey>(SNIP_KEY_EVENT, ({ payload }) => onKey(payload));
    return () => {
      unlistenCancel.then((fn) => fn());
      unlistenKey.then((fn) => fn());
    };
  }, []);

  const handle = (type: 'down' | 'up') => (e: React.PointerEvent) => {
    const step = snipStep(state, { type, at: { x: e.clientX, y: e.clientY }, button: e.button });
    if (step.done !== undefined) finish(step.done);
    else setState(step.state);
  };

  const region = state.phase === 'second' && mouse ? rectBetween(state.anchor, mouse) : null;
  const scale = window.devicePixelRatio;

  return (
    <div
      className={`snip${region ? ' selecting' : ''}`}
      onPointerDown={handle('down')}
      onPointerUp={handle('up')}
      onPointerMove={(e) => setMouse({ x: e.clientX, y: e.clientY })}
      onContextMenu={(e) => e.preventDefault()}
    >
      {mouse && !region && (
        <>
          <div className="snip-guide snip-guide-x" style={{ top: mouse.y }} />
          <div className="snip-guide snip-guide-y" style={{ left: mouse.x }} />
        </>
      )}
      {region && (
        <div className="snip-region" style={region}>
          <span className={`snip-size${region.top < 28 ? ' inside' : ''}`}>
            {Math.round(region.width * scale)} × {Math.round(region.height * scale)}
          </span>
        </div>
      )}
      <div className="snip-hint" role="status">
        {state.phase === 'first' ? 'Click one corner of the area' : 'Now click the opposite corner'}
        <span>
          Or arrows and Enter{state.phase === 'first' ? ' · Ctrl+A whole screen' : ''} · Esc or right-click cancels
        </span>
      </div>
    </div>
  );
}

export default SnipOverlay;
