import { describe, expect, it } from 'vitest';
import { findPause, SAMPLE_RATE } from './audio';
import { LiveTranscript, type SpeechPasses } from './live';

// Tones standing in for speech: [quiet, tone, quiet, tone, ...] in seconds, with hiss throughout
function speech(...seconds: number[]): Float32Array {
  const total = Math.round(seconds.reduce((a, b) => a + b, 0) * SAMPLE_RATE);
  const loud: [number, number][] = [];
  let at = 0;
  seconds.forEach((length, i) => {
    const end = at + Math.round(length * SAMPLE_RATE);
    if (i % 2 === 1) loud.push([at, end]);
    at = end;
  });
  let seed = 1;
  const noise = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32 - 0.5) * 0.001;
  return Float32Array.from({ length: total }, (_, i) =>
    noise() + (loud.some(([a, b]) => i >= a && i < b) ? 0.3 * Math.sin((2 * Math.PI * 220 * i) / SAMPLE_RATE) : 0));
}

// An engine that "hears" how long the audio is, and records each pass
function fakeEngine(hold = false) {
  const passes: { seconds: number; final: boolean; prompt: string }[] = [];
  let release: ((text: string | null) => void) | null = null;
  const engine: SpeechPasses = {
    pass(audio, prompt, _maxTokens, final) {
      const seconds = audio.length / SAMPLE_RATE;
      passes.push({ seconds, final, prompt });
      const text = `heard ${seconds.toFixed(1)}`;
      // A held pass is running until cancelled (or the next is let through)
      if (hold && !final) return new Promise((resolve) => (release = resolve));
      return Promise.resolve(text);
    },
    async cancel() {
      release?.(null);
      release = null;
    },
  };
  return { engine, passes };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

// The recording growing 0.1 s at a time, each step's passes done before the next
async function feed(live: LiveTranscript, audio: Float32Array, untilSeconds = audio.length / SAMPLE_RATE) {
  const step = SAMPLE_RATE / 10;
  for (let n = step; n <= untilSeconds * SAMPLE_RATE; n += step) {
    live.update(audio.subarray(0, n));
    await tick();
  }
}

describe('pauses', () => {
  it('finds the pause between two bursts of speech', () => {
    const pause = findPause(speech(0.5, 2, 0.6, 2, 0.5))!;
    expect(pause / SAMPLE_RATE).toBeGreaterThan(2.5);
    expect(pause / SAMPLE_RATE).toBeLessThan(3.1);
  });

  it("doesn't take the silence at the end, or a short gap, for a pause", () => {
    expect(findPause(speech(0.5, 3, 2))).toBeNull();
    expect(findPause(speech(0.5, 2, 0.1, 2, 0.5))).toBeNull();
  });
});

describe('live transcript', () => {
  it('shows text while speech comes in', async () => {
    const { engine, passes } = fakeEngine();
    const shown: string[] = [];
    const live = new LiveTranscript(engine, 'Redis.', (text) => shown.push(text));
    await feed(live, speech(0.5, 2, 1));
    expect(passes.length).toBeGreaterThan(3);
    expect(passes.every((p) => !p.final && p.prompt === 'Redis.')).toBe(true);
    expect(shown.at(-1)).toMatch(/^heard/);
  });

  it("uses the latest pass when it already heard everything, so there's no wait", async () => {
    const { engine, passes } = fakeEngine();
    const audio = speech(0.5, 2, 1);
    const live = new LiveTranscript(engine, '', () => {});
    await feed(live, audio);
    const before = passes.length;
    const text = await live.finish(audio);
    expect(passes.length).toBe(before);
    expect(text).toBe(`heard ${passes.at(-1)!.seconds.toFixed(1)}`);
  });

  it('transcribes the end once more when speech went on after the latest pass', async () => {
    const { engine, passes } = fakeEngine();
    const audio = speech(0.5, 2, 1);
    const live = new LiveTranscript(engine, '', () => {});
    await feed(live, audio, 1.5); // stopped mid-word
    await live.finish(audio);
    expect(passes.at(-1)!.final).toBe(true);
    expect(passes.at(-1)!.seconds).toBeCloseTo(2.5, 1); // the speech, padded
  });

  it('settles long speech at a pause, so only the rest is left at the end', async () => {
    const { engine, passes } = fakeEngine();
    // Words with short gaps (not pauses), a pause after 9.8 s, then more words
    const words = (n: number) => Array.from({ length: n }, () => [0.9, 0.15]).flat().slice(0, -1);
    const audio = speech(0.5, ...words(9), 0.6, ...words(6), 0.3);
    const live = new LiveTranscript(engine, 'Kafka.', () => {});
    await feed(live, audio, 15); // stopped as the last word ends
    const settled = passes.find((p) => p.final)!;
    expect(settled.seconds).toBeCloseTo(9.8, 0); // 9.3 s of words, padded
    const text = await live.finish(audio);
    const last = passes.at(-1)!;
    expect(last.seconds).toBeLessThan(7); // not the whole recording again
    expect(last.prompt).toBe(`Kafka. heard ${settled.seconds.toFixed(1)}`); // the settled text carries on
    expect(text.startsWith(`heard ${settled.seconds.toFixed(1)} heard`)).toBe(true);
  });

  it('cancels a live pass on stopping rather than waiting for it', async () => {
    const { engine, passes } = fakeEngine(true);
    const audio = speech(0.5, 2, 1);
    const live = new LiveTranscript(engine, '', () => {});
    await feed(live, audio, 1.5); // one pass, still running
    expect(passes.length).toBe(1);
    const text = await live.finish(audio);
    expect(passes.at(-1)!.final).toBe(true);
    expect(text).toBe(`heard ${passes.at(-1)!.seconds.toFixed(1)}`);
  });

  it('finds nothing to send when nothing was said', async () => {
    const { engine, passes } = fakeEngine();
    const audio = speech(3);
    const live = new LiveTranscript(engine, '', () => {});
    await feed(live, audio);
    expect(await live.finish(audio)).toBe('');
    expect(passes).toHaveLength(0);
  });
});
