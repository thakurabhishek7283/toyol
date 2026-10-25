// Speech to text, on this PC (the speech worker) or with the AI service's
// transcription model. Both get the same audio clean-up and vocabulary prompt.

import { convertFileSrc } from '@tauri-apps/api/core';
import { resolveResource } from '@tauri-apps/api/path';
import { transcribeCloud, type AiSettings } from '../ai';
import { encodeWav, prepareSpeech } from './audio';
import type { SpeechMessage, SpeechRequest } from './protocol';
import { cleanTranscript } from './transcript';

export interface ModelStatus {
  state: 'idle' | 'loading' | 'ready' | 'failed';
  progress: number; // 0-100, while loading
}

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

let worker: Promise<Worker> | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

let status: ModelStatus = { state: 'idle', progress: 0 };
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

// Where the bundled models are served from (src-tauri/resources/models), for the
// worker, which can't call Tauri itself
async function bundledModelsUrl(): Promise<string | null> {
  try {
    // Forward slashes, and no \\?\ prefix, so the paths the library appends join cleanly
    const dir = (await resolveResource('models')).replace(/^\\\\\?\\/, '').replace(/\\/g, '/');
    return `${convertFileSrc(dir)}/`;
  } catch (error) {
    console.error('Bundled speech model not found:', error);
    return null;
  }
}

function getWorker(): Promise<Worker> {
  worker ??= bundledModelsUrl().then((bundledModels) => {
    const created = new Worker(new URL('../../workers/speech.worker.ts', import.meta.url), { type: 'module' });
    created.onmessage = ({ data: message }: MessageEvent<SpeechMessage>) => {
      switch (message.type) {
        case 'result':
        case 'error': {
          const request = pending.get(message.id);
          pending.delete(message.id);
          if (message.type === 'result') request?.resolve(message.result);
          else request?.reject(new Error(message.error));
          break;
        }
        case 'loading':
          setStatus({ state: 'loading', progress: 0 });
          break;
        case 'progress':
          setStatus({ state: 'loading', progress: message.progress });
          break;
        case 'ready':
          setStatus({ state: 'ready', progress: 100 });
          break;
        case 'failed':
          console.error('Speech model failed to load:', message.error);
          setStatus({ state: 'failed', progress: 0 });
          break;
      }
    };
    // Messages are handled in order, so this lands before any request
    created.postMessage({ type: 'init', id: 0, bundledModels } satisfies SpeechRequest);
    return created;
  });
  return worker;
}

async function request<T>(message: DistributiveOmit<SpeechRequest, 'id'>, transfer: Transferable[] = []): Promise<T> {
  const target = await getWorker();
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
    target.postMessage({ ...message, id }, transfer);
  });
}

/** Load the local model ahead of its first use */
export function preloadSpeechModel(): Promise<void> {
  return request({ type: 'load' });
}

export interface TranscribeOptions {
  engine: 'local' | 'cloud';
  prompt: string; // see buildPrompt
  ai: AiSettings; // for the cloud engine
  cloudModel: string;
}

/** What was said in `audio` (16 kHz mono); '' if nothing was */
export async function transcribe(audio: Float32Array, options: TranscribeOptions): Promise<string> {
  if (options.engine === 'local') {
    return request<string>({ type: 'transcribe', audio, prompt: options.prompt }, [audio.buffer]);
  }
  const speech = prepareSpeech(audio);
  if (!speech) return '';
  const joined = new Float32Array(speech.chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const chunk of speech.chunks) {
    joined.set(chunk, at);
    at += chunk.length;
  }
  const text = await transcribeCloud(options.ai, options.cloudModel, encodeWav(joined), options.prompt);
  return cleanTranscript(text, options.prompt);
}
