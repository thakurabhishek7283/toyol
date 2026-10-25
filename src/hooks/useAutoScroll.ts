import { useEffect, useRef, type RefObject } from 'react';
import type { AutoScroll } from '../config';

// Reading pace, in lines a second
const SPEEDS: Record<Exclude<AutoScroll, 'off'>, number> = { slow: 0.6, medium: 1, fast: 1.6 };
// Once there's more of the answer below the panel, it waits as long as reading
// this many lines takes at the set pace (the question and the bold answer)
// before it starts moving
const START_DELAY_LINES = 5;
// The list's own scrolling (ours) lands within this of where it was put;
// anything further is the user scrolling (wheel, keys, the scroll shortcuts)
const OURS_PX = 4;

/**
 * A new answer is put at the top of the panel at once, wherever the panel was
 * scrolled (the latest turn is always tall enough for that: .turn:last-child),
 * then scrolled slowly as it's read: the question and the bold answer first,
 * then on down to the end at `speed`,
 * waiting for more while it's still being written. The user scrolling or
 * clicking in the list takes over until the next answer.
 */
export function useAutoScroll(scrollRef: RefObject<HTMLElement | null>, turnId: number | undefined, writing: boolean, speed: AutoScroll) {
  const writingRef = useRef(writing);
  const speedRef = useRef(speed);
  useEffect(() => {
    writingRef.current = writing;
    speedRef.current = speed;
  });

  useEffect(() => {
    const list = scrollRef.current;
    if (turnId === undefined || !list) return;
    list.querySelector<HTMLElement>(`[data-turn="${turnId}"]`)?.scrollIntoView({ block: 'start', behavior: 'instant' });

    let frame = 0;
    let readyAt: number | null = null; // when scrolling starts
    let position: number | null = null; // where it was put (fractional: the pace is under a pixel a frame)
    let last = performance.now();
    const takeOver = () => cancelAnimationFrame(frame);
    const onScroll = () => {
      if (position !== null && Math.abs(list.scrollTop - Math.round(position)) > OURS_PX) takeOver();
    };

    const tick = (now: number) => {
      const elapsed = Math.min(now - last, 100); // a hidden panel's frames pause; don't jump after
      last = now;
      const setting = speedRef.current;
      const bottom = list.scrollHeight - list.clientHeight;
      if (setting === 'off') return;
      if (list.scrollTop < bottom - 1) {
        readyAt ??= now + (START_DELAY_LINES / SPEEDS[setting]) * 1000;
        if (now >= readyAt) {
          const lineHeight = parseFloat(getComputedStyle(list).fontSize) * 1.5;
          position = Math.min(bottom, (position ?? list.scrollTop) + (SPEEDS[setting] * lineHeight * elapsed) / 1000);
          list.scrollTop = Math.round(position);
        }
      } else if (!writingRef.current) {
        return; // at the end, and there's no more coming
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    const options = { passive: true };
    list.addEventListener('wheel', takeOver, options);
    list.addEventListener('pointerdown', takeOver, options);
    list.addEventListener('keydown', takeOver);
    list.addEventListener('scroll', onScroll, options);
    return () => {
      cancelAnimationFrame(frame);
      list.removeEventListener('wheel', takeOver);
      list.removeEventListener('pointerdown', takeOver);
      list.removeEventListener('keydown', takeOver);
      list.removeEventListener('scroll', onScroll);
    };
  }, [scrollRef, turnId]);
}
