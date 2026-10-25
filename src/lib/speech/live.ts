// Live transcription: text while the user talks, and next to nothing left to
// do when they stop. Whisper doesn't stream (it hears whole windows of audio),
// so the unsettled part of the recording is transcribed again and again as it
// grows: each pass takes about a quarter of a second on a GPU. Once that part
// gets long, it's settled at a pause: transcribed one last time, and passes
// carry on from there with its text as context. When the user stops, only what
// came after the last settled pause is left, and if the latest pass already
// heard all of it, nothing is. No Tauri here, so the benchmark can run it too.

import { findPause, findSpeech, MAX_CHUNK_SECONDS, PAD_SECONDS, prepareSpeech, SAMPLE_RATE, splitAtPauses } from './audio.ts';
import { cleanTranscript, maxTokensFor } from './transcript.ts';

/** Recognition passes, by the speech engine (speech_transcribe in the app) */
export interface SpeechPasses {
  /** The text in `audio` (16 kHz mono, under 30 s), or null if cancelled */
  pass(audio: Float32Array, prompt: string, maxTokens: number, final: boolean): Promise<string | null>;
  /** Stop the passes already started */
  cancel(): Promise<void>;
}

// A live pass once there's this much new audio since the last
const STEP_SECONDS = 0.3;
// Unsettled audio longer than this is settled at its last pause...
const SETTLE_AFTER_SECONDS = 12;
// ...if the pause is at least this far from the end (so speech after it
// isn't cut off from what it follows) and this far from the start
const SETTLE_GAP_SECONDS = 1.5;
const MIN_SETTLED_SECONDS = 3;
// The latest live pass stands as the final text if it went on this long after
// the last word ended (it heard all of it)
const HEARD_AFTER_SECONDS = 0.3;
// Each pass also gets the end of the settled text as its prompt, so sentences
// carry on across settled pauses (as Whisper does with long audio)
const CARRY_WORDS = 40;

const s = (seconds: number) => Math.round(seconds * SAMPLE_RATE);

export class LiveTranscript {
  private engine: SpeechPasses;
  private prompt: string;
  private onText: (text: string) => void;
  private audio: Float32Array = new Float32Array(0); // the recording so far
  private settled: string[] = [];
  private settledEnd = 0; // where the unsettled audio starts
  // The latest live pass: unsettled audio up to `end` (absolute), and its text
  private heard = { end: 0, text: '' };
  private running: Promise<void> | null = null;
  private live = false; // a live pass (cancellable) is running
  private stopped = false;

  /**
   * `prompt` steers recognition (see buildPrompt); `onText` gets the text so
   * far, settled and live, after each pass.
   */
  constructor(engine: SpeechPasses, prompt: string, onText: (text: string) => void) {
    this.engine = engine;
    this.prompt = prompt;
    this.onText = onText;
  }

  /** The recording so far, all of it: starts a pass if one is due */
  update(audio: Float32Array): void {
    this.audio = audio;
    if (this.running || this.stopped || audio.length - Math.max(this.heard.end, this.settledEnd) < s(STEP_SECONDS)) return;
    this.running = this.step()
      .catch((error: unknown) => console.error('Live transcription pass failed:', error))
      .finally(() => (this.running = null));
  }

  /** The whole recording, once it's stopped: resolves to what was said */
  async finish(audio: Float32Array): Promise<string> {
    this.stopped = true;
    // A live pass is about to be replaced: stop it rather than wait for it
    if (this.live) await this.engine.cancel();
    await this.running;
    const rest = audio.subarray(this.settledEnd);
    const speech = findSpeech(rest);
    if (!speech) {
      this.heard = { end: audio.length, text: '' };
    } else if (this.heard.end < this.settledEnd + speech.end - s(PAD_SECONDS) + s(HEARD_AFTER_SECONDS)) {
      this.heard = { end: audio.length, text: (await this.transcribe(rest, true)) ?? '' };
    }
    return this.text();
  }

  private text(): string {
    return [...this.settled, this.heard.text].filter(Boolean).join(' ');
  }

  private async step(): Promise<void> {
    const audio = this.audio;
    const cut = this.settlePoint(audio);
    if (cut !== null) {
      const text = await this.transcribe(audio.subarray(this.settledEnd, cut), true);
      if (text) this.settled.push(text);
      this.settledEnd = cut;
      this.heard = { end: cut, text: '' };
    } else {
      this.live = true;
      const text = await this.transcribe(audio.subarray(this.settledEnd), false).finally(() => (this.live = false));
      if (text === null) return; // cancelled
      this.heard = { end: audio.length, text };
    }
    if (!this.stopped) this.onText(this.text());
  }

  /** Where to settle the unsettled audio, if it's time to */
  private settlePoint(audio: Float32Array): number | null {
    const unsettled = audio.length - this.settledEnd;
    if (unsettled < s(SETTLE_AFTER_SECONDS)) return null;
    const pause = findPause(audio.subarray(this.settledEnd), s(MIN_SETTLED_SECONDS), unsettled - s(SETTLE_GAP_SECONDS));
    if (pause !== null) return this.settledEnd + pause;
    // No pause in a long stretch of talk: cut at the quietest moment before
    // Whisper's window is full
    if (unsettled > s(MAX_CHUNK_SECONDS)) return this.settledEnd + splitAtPauses(audio.subarray(this.settledEnd))[0].length;
    return null;
  }

  /** The text in `audio` (cleaned up), '' if there's no speech, or null if cancelled */
  private async transcribe(audio: Float32Array, final: boolean): Promise<string | null> {
    const speech = prepareSpeech(audio);
    if (!speech) return '';
    const pieces: string[] = [];
    for (const chunk of speech.chunks) {
      const carried = [...this.settled, ...pieces].join(' ').split(/\s+/).slice(-CARRY_WORDS).join(' ');
      const prompt = [this.prompt, carried].filter(Boolean).join(' ');
      const text = await this.engine.pass(chunk, prompt, maxTokensFor(chunk.length / SAMPLE_RATE), final);
      if (text === null) return null;
      pieces.push(cleanTranscript(text, prompt));
    }
    return pieces.filter(Boolean).join(' ');
  }
}
