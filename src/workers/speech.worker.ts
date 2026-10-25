// Speech to text on this PC, off the UI thread. The model ships with the app
// (see 'init'), so nothing is downloaded and audio never leaves the machine.
// The model loading and bundled-model cache come from ScreenPrompt (MIT).

import { AutoProcessor, AutoTokenizer, env, WhisperForConditionalGeneration } from '@huggingface/transformers';
import { prepareSpeech } from '../lib/speech/audio.ts';
import { SPEECH_MODEL, type SpeechMessage, type SpeechRequest } from '../lib/speech/protocol.ts';
import { whisperTranscribe, type WhisperParts } from '../lib/speech/whisper.ts';

env.allowLocalModels = false;
// transformers.js points the ONNX runtime at a CDN copy of its WebAssembly.
// Clear that so the runtime uses the copy bundled with the app.
const onnx = env.backends.onnx as { wasm?: { wasmPaths?: unknown; numThreads?: number } };
if (onnx.wasm) {
  onnx.wasm.wasmPaths = undefined;
  // Threads need SharedArrayBuffer, which cross-origin isolation enables (see
  // vite.config.ts). Leave a core or two for the rest of the PC.
  if (self.crossOriginIsolated) onnx.wasm.numThreads = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 2));
}

const post = (message: SpeechMessage, transfer: Transferable[] = []) => self.postMessage(message, { transfer });

// Once the files are in, the model should start within this. If the ONNX
// runtime can't start (e.g. its .wasm didn't load) the load never settles;
// say so rather than show "100%" forever.
const STARTUP_TIMEOUT_MS = 90_000;
let startupTimer: number | undefined;

// Load progress for the UI, totalled over the model's files
function onProgress() {
  const files = new Map<string, { loaded: number; total: number }>();
  return (info: { status: string; file?: string; loaded?: number; total?: number }) => {
    if (info.status !== 'progress' || !info.file) return;
    files.set(info.file, { loaded: info.loaded ?? 0, total: info.total ?? 0 });
    let loaded = 0;
    let total = 0;
    for (const f of files.values()) {
      loaded += f.loaded;
      total += f.total;
    }
    const progress = total > 0 ? (100 * loaded) / total : 0;
    post({ type: 'progress', progress });
    if (progress >= 100 && startupTimer === undefined) {
      startupTimer = self.setTimeout(() => post({ type: 'failed', error: 'The model loaded but its runtime did not start' }), STARTUP_TIMEOUT_MS);
    }
  };
}

// The library looks files up in its cache before downloading them. This cache
// answers for the bundled model from the app's own copy and passes anything
// else to the browser cache, so the model is never downloaded or stored twice.
// A bundled model's file that isn't in the bundle gets a local 404 (the library
// asks about files it never loads, to size its progress bar).
let bundledModels: string | null = null;
const hubPrefix = `${env.remoteHost.replace(/\/$/, '')}/${SPEECH_MODEL}/resolve/`;
let browserCache: Promise<Cache> | null = null;
const getBrowserCache = () => (browserCache ??= caches.open(env.cacheKey));
const keyUrl = (key: RequestInfo | URL) => (key instanceof Request ? key.url : String(key));

env.useCustomCache = true;
env.customCache = {
  async match(key: RequestInfo | URL) {
    const url = keyUrl(key);
    if (bundledModels && url.startsWith(hubPrefix)) {
      // <host>/<model>/resolve/<revision>/<file>
      const file = url.slice(hubPrefix.length).replace(/^[^/]+\//, '');
      const response = await fetch(`${bundledModels}${SPEECH_MODEL}/${file}`);
      return response.ok ? response : new Response(null, { status: 404 });
    }
    return (await getBrowserCache()).match(key);
  },
  async put(key: RequestInfo | URL, response: Response) {
    if (bundledModels && keyUrl(key).startsWith(hubPrefix)) return;
    await (await getBrowserCache()).put(key, response);
  },
};

type GpuNavigator = Navigator & { gpu?: { requestAdapter(): Promise<{ features: Set<string> } | null> } };

/** Whether the encoder can run on the GPU: WebGPU with 16-bit float shaders */
async function gpuCanEncode(): Promise<boolean> {
  try {
    const adapter = await (navigator as GpuNavigator).gpu?.requestAdapter();
    return Boolean(adapter?.features.has('shader-f16'));
  } catch {
    return false;
  }
}

// Whisper's encoder reads a full 30 s window however short the question, and
// is most of the work: about 3 s on the CPU, a fraction of that on even a
// laptop's built-in GPU. So it runs there (16-bit) when it can. The decoder,
// a few small steps per word, stays on the CPU in 8-bit, which benchmarked
// within half a point of full precision. Keep in sync with
// scripts/fetch-models.mjs.
async function loadModel(useGpu: boolean): Promise<WhisperParts> {
  const options = { progress_callback: onProgress() };
  const [processor, tokenizer, model] = await Promise.all([
    AutoProcessor.from_pretrained(SPEECH_MODEL, options),
    AutoTokenizer.from_pretrained(SPEECH_MODEL, options),
    WhisperForConditionalGeneration.from_pretrained(SPEECH_MODEL, {
      ...options,
      device: useGpu ? { encoder_model: 'webgpu', decoder_model_merged: 'wasm' } : 'wasm',
      dtype: { encoder_model: useGpu ? 'fp16' : 'q8', decoder_model_merged: 'q8' },
    }),
  ]);
  return {
    processor: processor as unknown as WhisperParts['processor'],
    tokenizer: tokenizer as unknown as WhisperParts['tokenizer'],
    model: model as unknown as WhisperParts['model'],
    multilingual: false,
  };
}

// The GPU until it fails once (to load or to run); then the CPU from then on
let gpuFailed = false;

async function loadBest(): Promise<WhisperParts> {
  if (!gpuFailed && (await gpuCanEncode())) {
    try {
      return await loadModel(true);
    } catch (error) {
      console.warn('Speech model on the GPU failed, using the CPU:', error);
      gpuFailed = true;
    }
  }
  return loadModel(false);
}

// One load, shared by every request; a failed load can be retried
let loading: Promise<WhisperParts> | null = null;
function getModel(): Promise<WhisperParts> {
  if (!loading) {
    post({ type: 'loading' });
    loading = loadBest().then(
      (parts) => {
        self.clearTimeout(startupTimer);
        post({ type: 'ready' });
        return parts;
      },
      (error: unknown) => {
        self.clearTimeout(startupTimer);
        startupTimer = undefined;
        loading = null;
        post({ type: 'failed', error: String(error) });
        throw error;
      },
    );
  }
  return loading;
}

self.onmessage = async ({ data: request }: MessageEvent<SpeechRequest>) => {
  try {
    switch (request.type) {
      case 'init':
        bundledModels = request.bundledModels;
        break;
      case 'load':
        await getModel();
        post({ type: 'result', id: request.id, result: null });
        break;
      case 'transcribe': {
        const speech = prepareSpeech(request.audio);
        let text = '';
        if (speech) {
          try {
            text = await whisperTranscribe(await getModel(), speech, request.prompt);
          } catch (error) {
            if (gpuFailed) throw error;
            // A GPU that loaded the model but can't run it (driver trouble): again on the CPU
            console.warn('Transcribing on the GPU failed, using the CPU:', error);
            gpuFailed = true;
            loading = null;
            text = await whisperTranscribe(await getModel(), speech, request.prompt);
          }
        }
        post({ type: 'result', id: request.id, result: text });
        break;
      }
    }
  } catch (error) {
    post({ type: 'error', id: request.id, error: String(error) });
  }
};
