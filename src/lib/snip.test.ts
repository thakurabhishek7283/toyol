import { describe, expect, it } from 'vitest';
import { snipStep, type SnipInput, type SnipState } from './snip';

const down = (x: number, y: number, button = 0): SnipInput => ({ type: 'down', at: { x, y }, button });
const up = (x: number, y: number, button = 0): SnipInput => ({ type: 'up', at: { x, y }, button });

function run(inputs: SnipInput[]) {
  let state: SnipState = { phase: 'first' };
  for (const input of inputs) {
    const step = snipStep(state, input);
    if (step.done !== undefined) return step.done;
    state = step.state;
  }
  return state;
}

describe('snipStep', () => {
  it('takes the region between two clicks', () => {
    expect(run([down(100, 50), up(100, 50), down(300, 200), up(300, 200)])).toEqual({ left: 100, top: 50, width: 200, height: 150 });
  });

  it('works whichever corner comes first', () => {
    expect(run([down(300, 200), up(300, 200), down(100, 50)])).toEqual({ left: 100, top: 50, width: 200, height: 150 });
  });

  it('still takes a drag', () => {
    expect(run([down(10, 10), up(110, 60)])).toEqual({ left: 10, top: 10, width: 100, height: 50 });
  });

  it('waits for the second corner after a small wobble on the first click', () => {
    expect(run([down(10, 10), up(12, 11)])).toMatchObject({ phase: 'second', pressed: false });
  });

  it('starts over from a second click on (nearly) the same spot', () => {
    expect(run([down(10, 10), up(10, 10), down(12, 12)])).toMatchObject({ phase: 'second', anchor: { x: 12, y: 12 } });
  });

  it('cancels on a right click, at either step', () => {
    expect(run([down(5, 5, 2)])).toBeNull();
    expect(run([down(10, 10), up(10, 10), down(50, 50, 2)])).toBeNull();
  });

  it('needs some width and height', () => {
    // A thin line isn't a region: the second click starts over
    expect(run([down(10, 10), up(10, 10), down(400, 12)])).toMatchObject({ phase: 'second' });
  });
});
