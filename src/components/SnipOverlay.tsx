import { useEffect, useRef, useState } from 'react';
import { emitTo, listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { ScreenRect } from '../lib/capture';
import { rectBetween, snipStep, type Point, type Rect, type SnipState } from '../lib/snip';
import '../styles/snip.css';

/** Sent to the panel when done: the region picked (physical px), or null if cancelled */
export const SNIP_EVENT = 'snip';
export interface SnipResult {
  rect: ScreenRect | null;
}
/** Sent to the snip window to cancel (Esc: this window never has focus, so the panel hears it) */
export const SNIP_CANCEL_EVENT = 'snip-cancel';

/**
 * The snip window (open_snip_window), over the monitor the mouse is on: click
 * one corner of the region, then the opposite one. Guide lines follow the
 * mouse; after the first click the region shows with everything else dimmed.
 * Esc or a right click cancels. It never takes focus, so the app being
 * snipped stays in front.
 */
function SnipOverlay() {
  const [state, setState] = useState<SnipState>({ phase: 'first' });
  const [mouse, setMouse] = useState<Point | null>(null);
  const doneRef = useRef(false);

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
    const unlisten = listen(SNIP_CANCEL_EVENT, () => finish(null));
    return () => {
      unlisten.then((fn) => fn());
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
        <span>Esc or right-click to cancel</span>
      </div>
    </div>
  );
}

export default SnipOverlay;
