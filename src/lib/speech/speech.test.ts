import { describe, expect, it } from 'vitest';
import { encodeWav, findSpeech, MAX_CHUNK_SECONDS, prepareSpeech, SAMPLE_RATE, splitAtPauses } from './audio';
import { buildPrompt, cleanTranscript, collapseRepeats, maxTokensFor, parseVocabulary } from './transcript';

// A tone standing in for speech, with quiet hiss around it
function clip(leadSeconds: number, toneSeconds: number, tailSeconds: number, amplitude = 0.3): Float32Array {
  const total = Math.round((leadSeconds + toneSeconds + tailSeconds) * SAMPLE_RATE);
  const start = Math.round(leadSeconds * SAMPLE_RATE);
  const end = start + Math.round(toneSeconds * SAMPLE_RATE);
  let seed = 1;
  const noise = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32 - 0.5) * 0.001;
  return Float32Array.from({ length: total }, (_, i) =>
    noise() + (i >= start && i < end ? amplitude * Math.sin((2 * Math.PI * 220 * i) / SAMPLE_RATE) : 0));
}

describe('audio', () => {
  it('finds speech and trims the silence around it, with padding', () => {
    const speech = findSpeech(clip(1, 2, 1.5))!;
    expect(speech.start / SAMPLE_RATE).toBeCloseTo(0.75, 1);
    expect(speech.end / SAMPLE_RATE).toBeCloseTo(3.25, 1);
  });

  it('finds no speech in silence', () => {
    expect(findSpeech(clip(3, 0, 0))).toBeNull();
    expect(prepareSpeech(clip(3, 0, 0))).toBeNull();
  });

  it('ignores a short click', () => {
    expect(prepareSpeech(clip(1, 0.05, 1))).toBeNull();
  });

  it('brings quiet speech up to a usable level', () => {
    const prepared = prepareSpeech(clip(0.5, 2, 0.5, 0.01))!;
    const peak = Math.max(...prepared.chunks[0].map(Math.abs));
    expect(peak).toBeGreaterThan(0.2);
  });

  it('splits long recordings into chunks Whisper can take', () => {
    const chunks = splitAtPauses(new Float32Array(70 * SAMPLE_RATE));
    expect(chunks.length).toBe(3);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(MAX_CHUNK_SECONDS * SAMPLE_RATE);
    expect(chunks.reduce((n, c) => n + c.length, 0)).toBe(70 * SAMPLE_RATE);
  });

  it('writes a WAV header', () => {
    const wav = new DataView(encodeWav(new Float32Array(160)));
    expect(String.fromCharCode(...new Uint8Array(wav.buffer, 0, 4))).toBe('RIFF');
    expect(wav.getUint32(24, true)).toBe(SAMPLE_RATE);
    expect(wav.byteLength).toBe(44 + 320);
  });
});

describe('transcript', () => {
  it('reads a vocabulary list', () => {
    expect(parseVocabulary('Redis, gRPC\nKubernetes;redis, ')).toEqual(['Redis', 'gRPC', 'Kubernetes']);
  });

  it('builds a punctuated prompt from vocabulary and context', () => {
    expect(buildPrompt(['Redis', 'gRPC'], 'What is CAP')).toBe('Redis, gRPC. What is CAP.');
    expect(buildPrompt([], '')).toBe('');
  });

  it('drops what Whisper hears in silence', () => {
    expect(cleanTranscript(' Thank you.')).toBe('');
    expect(cleanTranscript('[BLANK_AUDIO]')).toBe('');
    expect(cleanTranscript('(music) How does DNS work?')).toBe('How does DNS work?');
  });

  it('drops a transcript that only repeats the prompt', () => {
    expect(cleanTranscript('Redis, gRPC, Kubernetes.', 'Redis, gRPC, Kubernetes, Kafka.')).toBe('');
  });

  it('collapses loops but keeps a single repeat', () => {
    expect(collapseRepeats('the the the the cache')).toBe('the cache');
    expect(collapseRepeats('Is it fast? Is it fast? Is it fast? Is it fast?')).toBe('Is it fast?');
    expect(collapseRepeats('very very good')).toBe('very very good');
  });

  it('gives longer speech more tokens, up to a cap', () => {
    expect(maxTokensFor(2)).toBeLessThan(maxTokensFor(10));
    expect(maxTokensFor(60)).toBe(220);
  });
});
