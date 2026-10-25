// Speech to text, on this PC (whisper.cpp in the app, src-tauri/src/speech.rs,
// streamed by LiveTranscript) or with the AI service's transcription model.
// Both get the same audio clean-up and vocabulary prompt.

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { transcribeCloud, type AiSettings } from '../ai';
import { encodeWav, prepareSpeech } from './audio';
import type { SpeechPasses } from './live';
import { cleanTranscript } from './transcript';

export interface ModelStatus {
  // 'downloading' the first time only: the model isn't in the installer (src-tauri/src/model.rs)
  state: 'idle' | 'downloading' | 'loading' | 'ready' | 'failed';
  device: string; // what it runs on (a GPU's name, or "CPU"), once ready
  progress?: number; // 0-1, while downloading
  error?: string; // why it failed
}

let status: ModelStatus = { state: 'idle', device: '' };
const listeners = new Set<() => void>();
const setStatus = (next: ModelStatus) => {
  status = next;
  listeners.forEach((listener) => listener());
};

export const getModelStatus = () => status;
export function subscribeModelStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// One load, shared by every request; a failed load can be retried
let loading: Promise<void> | null = null;

/** Load the local model (a couple of seconds; the first time, a download), ahead of its first use */
export function loadSpeechModel(): Promise<void> {
  if (!loading) {
    const unlisten = listen<{ received: number; total: number }>('speech-download', ({ payload }) => {
      const progress = payload.total ? payload.received / payload.total : 0;
      setStatus(progress < 1 ? { state: 'downloading', device: '', progress } : { state: 'loading', device: '' });
    });
    loading = unlisten
      .then(() => invoke<string>('speech_load'))
      .then(
        (device) => setStatus({ state: 'ready', device }),
        (error: unknown) => {
          console.error('Speech model failed to load:', error);
          loading = null;
          setStatus({ state: 'failed', device: '', error: String(error) });
          throw new Error(String(error));
        },
      )
      .finally(() => unlisten.then((stop) => stop()));
    setStatus({ state: 'loading', device: '' });
  }
  return loading;
}

/** Recognition passes on this PC, for LiveTranscript */
export const localPasses: SpeechPasses = {
  async pass(audio, prompt, maxTokens, final) {
    await loadSpeechModel();
    // See speech_transcribe: the prompt's length, the prompt, then the samples
    const promptBytes = new TextEncoder().encode(prompt);
    const body = new Uint8Array(4 + promptBytes.length + audio.byteLength);
    new DataView(body.buffer).setUint32(0, promptBytes.length, true);
    body.set(promptBytes, 4);
    body.set(new Uint8Array(audio.buffer, audio.byteOffset, audio.byteLength), 4 + promptBytes.length);
    return invoke<string | null>('speech_transcribe', body, {
      headers: { 'x-max-tokens': String(maxTokens), 'x-final': final ? '1' : '0' },
    });
  },
  cancel: () => invoke('speech_cancel'),
};

/** What was said in `audio` (16 kHz mono), by the AI service; '' if nothing was */
export async function transcribeCloudSpeech(audio: Float32Array, ai: AiSettings, model: string, prompt: string): Promise<string> {
  const speech = prepareSpeech(audio);
  if (!speech) return '';
  const joined = new Float32Array(speech.chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const chunk of speech.chunks) {
    joined.set(chunk, at);
    at += chunk.length;
  }
  const text = await transcribeCloud(ai, model, encodeWav(joined), prompt);
  return cleanTranscript(text, prompt);
}
