// Picking a screen region with two clicks: one corner, then the opposite one.
// No holding the button down; a drag still works for those used to it.

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type SnipState =
  | { phase: 'first' } // waiting for the first corner
  // waiting for the opposite corner; `pressed` while the click that set the
  // anchor is still held (letting go far away finishes it as a drag)
  | { phase: 'second'; anchor: Point; pressed: boolean };

export interface SnipInput {
  type: 'down' | 'up';
  at: Point;
  button: number; // 0 left, 2 right
}

// Smaller than this (CSS px) on either side is a stray click, not a region
export const MIN_REGION_PX = 8;

export const rectBetween = (a: Point, b: Point): Rect => ({
  left: Math.min(a.x, b.x),
  top: Math.min(a.y, b.y),
  width: Math.abs(b.x - a.x),
  height: Math.abs(b.y - a.y),
});

const bigEnough = (r: Rect) => r.width >= MIN_REGION_PX && r.height >= MIN_REGION_PX;

/**
 * The next state after a click, and the outcome once there is one: the region,
 * or null if cancelled (a right click)
 */
export function snipStep(state: SnipState, input: SnipInput): { state: SnipState; done?: Rect | null } {
  if (input.button === 2) return input.type === 'down' ? { state, done: null } : { state };
  if (input.button !== 0) return { state };

  if (state.phase === 'first') {
    return input.type === 'down' ? { state: { phase: 'second', anchor: input.at, pressed: true } } : { state };
  }
  const region = rectBetween(state.anchor, input.at);
  if (input.type === 'up') {
    if (!state.pressed) return { state };
    // Let go far from where it went down: that was a drag
    return bigEnough(region) ? { state, done: region } : { state: { ...state, pressed: false } };
  }
  // The second click. Too close to the first (a double click) starts over from there.
  return bigEnough(region) ? { state, done: region } : { state: { phase: 'second', anchor: input.at, pressed: true } };
}
