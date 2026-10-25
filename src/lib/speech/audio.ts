// Audio conditioning before speech recognition. Whisper hears 30 s windows and
// "hears" words in silence and noise (it was trained on subtitled video), so the
// recording is cleaned up first: silence trimmed from both ends (no speech at
// all means nothing is sent), the level evened out, and long recordings split
// at pauses. Pure functions on 16 kHz mono samples, shared by the app and the
// benchmark. (A high-pass filter was tried too: it didn't help, and with the
// level evened out it made speech over chatter worse; scripts/bench-speech.mjs.)

export const SAMPLE_RATE = 16000; // what Whisper expects

const FRAME = 320; // 20 ms analysis frames
// Speech is padded by this much on each side after trimming, so soft word
// starts and endings ("h" in "how", final "s") survive
export const PAD_SECONDS = 0.25;
// A gap between words at least this long is a pause: somewhere to cut
const MIN_PAUSE_SECONDS = 0.3;
// Shorter than this isn't a question, it's a click or a breath
export const MIN_SPEECH_SECONDS = 0.3;
// Whisper's window is 30 s; chunks stay a little under it
export const MAX_CHUNK_SECONDS = 28;
// Where a long recording may be cut: the quietest moment in this many seconds
// before the chunk limit
const CUT_SEARCH_SECONDS = 6;
// Normalization: the loud end of the speech is brought to this level, with at
// most this much gain (more would just amplify the room)
const TARGET_PEAK = 0.9;
const MAX_GAIN = 30;

/** Loudness (RMS) of each 20 ms frame */
export function frameLevels(samples: Float32Array): Float32Array {
  const frames = Math.floor(samples.length / FRAME);
  const levels = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let i = f * FRAME; i < (f + 1) * FRAME; i++) sum += samples[i] * samples[i];
    levels[f] = Math.sqrt(sum / FRAME);
  }
  return levels;
}

function percentile(values: Float32Array, p: number): number {
  if (values.length === 0) return 0;
  const sorted = Float32Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

/** The frame level above which it's speech, or null if nothing stands out (see findSpeech) */
function speechThreshold(levels: Float32Array): number | null {
  if (levels.length === 0) return null;
  const floor = percentile(levels, 0.1);
  const loud = percentile(levels, 0.95);
  // Nothing stands out from the floor (silence, or steady noise): no speech.
  // 0.004 is about -48 dBFS, below any voice on a working microphone.
  if (loud < 0.004 || loud < floor * 3) return null;
  return Math.max(floor * 2.5, floor + (loud - floor) * 0.12, 0.002);
}

/**
 * The middle of the last pause in samples [from, to) (an offset), or null if
 * there's none: where speech can be cut without cutting a word in two. Speech
 * must come before and after the pause. The level that counts as speech is
 * judged on all of `samples`.
 */
export function findPause(samples: Float32Array, from = 0, to = samples.length): number | null {
  const levels = frameLevels(samples);
  const threshold = speechThreshold(levels);
  if (threshold === null) return null;
  const minFrames = Math.ceil((MIN_PAUSE_SECONDS * SAMPLE_RATE) / FRAME);
  const first = Math.ceil(from / FRAME);
  const last = Math.min(levels.length, Math.floor(to / FRAME)) - 1;
  let quiet = 0; // quiet frames in a row, ending at f - 1
  for (let f = last; f >= first; f--) {
    if (levels[f] < threshold) {
      quiet++;
      continue;
    }
    // A loud frame: the quiet run after it is a pause if it's long enough and
    // isn't the tail end of the search
    const after = f + 1;
    if (quiet >= minFrames && after + quiet <= last) return (after + quiet / 2) * FRAME;
    quiet = 0;
  }
  return null;
}

/**
 * Where speech is, as sample offsets [start, end), or null if there's none.
 * The threshold adapts to the room: a frame is speech when it's well above the
 * recording's own noise floor (its quietest frames), so it works for a quiet
 * headset and a laptop mic next to a fan alike.
 */
export function findSpeech(samples: Float32Array): { start: number; end: number } | null {
  const levels = frameLevels(samples);
  const threshold = speechThreshold(levels);
  if (threshold === null) return null;

  let first = -1;
  let last = -1;
  let voiced = 0;
  for (let f = 0; f < levels.length; f++) {
    if (levels[f] >= threshold) {
      if (first === -1) first = f;
      last = f;
      voiced++;
    }
  }
  if (first === -1 || voiced * FRAME < MIN_SPEECH_SECONDS * SAMPLE_RATE * 0.5) return null;

  const pad = Math.round(PAD_SECONDS * SAMPLE_RATE);
  return {
    start: Math.max(0, first * FRAME - pad),
    end: Math.min(samples.length, (last + 1) * FRAME + pad),
  };
}

/** Bring the speech's loud end to TARGET_PEAK (a robust peak: clicks don't count) */
export function normalize(samples: Float32Array): Float32Array {
  const abs = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) abs[i] = Math.abs(samples[i]);
  const peak = percentile(abs, 0.999);
  if (peak <= 0) return samples;
  const gain = Math.min(MAX_GAIN, TARGET_PEAK / peak);
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = Math.max(-1, Math.min(1, samples[i] * gain));
  return out;
}

/**
 * Split audio longer than MAX_CHUNK_SECONDS into chunks Whisper can take, each
 * cut at the quietest moment shortly before the limit, so no word is cut in two
 */
export function splitAtPauses(samples: Float32Array): Float32Array[] {
  const max = MAX_CHUNK_SECONDS * SAMPLE_RATE;
  const chunks: Float32Array[] = [];
  let start = 0;
  while (samples.length - start > max) {
    const searchFrom = start + max - CUT_SEARCH_SECONDS * SAMPLE_RATE;
    const window = samples.subarray(searchFrom, start + max);
    const levels = frameLevels(window);
    let quietest = levels.length - 1;
    for (let f = 0; f < levels.length; f++) if (levels[f] < levels[quietest]) quietest = f;
    const cut = searchFrom + quietest * FRAME + FRAME / 2;
    chunks.push(samples.subarray(start, cut));
    start = cut;
  }
  chunks.push(samples.subarray(start));
  return chunks;
}

export interface PreparedSpeech {
  chunks: Float32Array[]; // ready for Whisper, each under 30 s
  seconds: number; // of speech, after trimming
}

/** Clean up a recording for recognition; null if there's no speech in it */
export function prepareSpeech(raw: Float32Array): PreparedSpeech | null {
  const speech = findSpeech(raw);
  if (!speech) return null;
  const trimmed = raw.subarray(speech.start, speech.end);
  const seconds = trimmed.length / SAMPLE_RATE;
  if (seconds < MIN_SPEECH_SECONDS) return null;
  return { chunks: splitAtPauses(normalize(trimmed)), seconds };
}

/** 16-bit PCM WAV of the samples, for a cloud transcription service */
export function encodeWav(samples: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const text = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}
