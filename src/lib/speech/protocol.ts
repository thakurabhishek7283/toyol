// Messages between the speech worker (workers/speech.worker.ts) and its
// client (lib/speech/engine.ts)

// Bundled with the app (scripts/fetch-models.mjs). Chosen by benchmark
// (scripts/bench-speech.mjs): with the audio clean-up and a vocabulary prompt,
// small.en made 1.4-4.2% word errors on spoken questions where base.en made
// 2.8-8.3%, the gap widest with people talking in the background.
export const SPEECH_MODEL = 'onnx-community/whisper-small.en';

export type SpeechRequest =
  // First message: where the bundled models are served from (an asset-protocol
  // URL ending in '/'), or null if they can't be found
  | { type: 'init'; id: number; bundledModels: string | null }
  | { type: 'load'; id: number }
  | { type: 'transcribe'; id: number; audio: Float32Array; prompt: string };

export type SpeechMessage =
  | { type: 'result'; id: number; result: unknown }
  | { type: 'error'; id: number; error: string }
  | { type: 'loading' | 'ready' }
  | { type: 'progress'; progress: number }
  | { type: 'failed'; error: string };
