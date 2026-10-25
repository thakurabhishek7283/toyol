// Speech recognition benchmark: which Whisper model, and how much the audio
// clean-up (src/lib/speech/audio.ts) and the vocabulary prompt help.
//
// Spoken questions are made with Windows' built-in voices, then degraded the
// ways a laptop mic degrades them: dead air around the speech, fan noise, other
// people talking, a quiet mic. Clips with no speech at all check that nothing
// is "heard" in silence or noise. Runs the same code as the app (the speech
// worker), on the CPU.
//
//   npm run bench:speech -- [models...]   (default: base.en small.en)

import { execFileSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline as streamPipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { AutoProcessor, AutoTokenizer, env, WhisperForConditionalGeneration } from '@huggingface/transformers';
import { findSpeech, normalize, prepareSpeech, SAMPLE_RATE, splitAtPauses } from '../src/lib/speech/audio.ts';
import { buildPrompt, cleanTranscript } from '../src/lib/speech/transcript.ts';
import { whisperTranscribe } from '../src/lib/speech/whisper.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'bench');
const MODEL_DIR = join(OUT, 'models');
// Models are fetched up front (below), with retries: the library's own download
// gives up when a long download drops
env.localModelPath = MODEL_DIR;
env.allowRemoteModels = false;

// What the voice says, and what a perfect transcript reads
const CLIPS = [
  { say: 'How would you design a rate limiter for a distributed API using Redis?', ref: 'How would you design a rate limiter for a distributed API using Redis?', terms: ['Redis', 'API'] },
  { say: "What's the difference between a Kubernetes deployment and a stateful set?", ref: "What's the difference between a Kubernetes deployment and a StatefulSet?", terms: ['Kubernetes', 'StatefulSet'] },
  { say: 'Can you explain how the use effect cleanup function works in React?', ref: 'Can you explain how the useEffect cleanup function works in React?', terms: ['useEffect', 'React'] },
  { say: "So, um, they're asking how the O Auth authorization code flow with pixie actually works.", ref: "So, um, they're asking how the OAuth authorization code flow with PKCE actually works.", terms: ['OAuth', 'PKCE'] },
  { say: 'Explain the trade-offs between Postgres and Mongo DB for a write heavy workload.', ref: 'Explain the trade-offs between Postgres and MongoDB for a write-heavy workload.', terms: ['Postgres', 'MongoDB'] },
  { say: 'What happens when you type a URL into the browser and press enter?', ref: 'What happens when you type a URL into the browser and press enter?', terms: ['URL'] },
  { say: 'How does G R P C compare to REST when you need streaming between micro services?', ref: 'How does gRPC compare to REST when you need streaming between microservices?', terms: ['gRPC', 'REST'] },
  { say: 'Walk me through how a transformer model uses self attention.', ref: 'Walk me through how a transformer model uses self-attention.', terms: ['self-attention'] },
  { say: 'Why would you choose Kafka over Rabbit M Q for event sourcing?', ref: 'Why would you choose Kafka over RabbitMQ for event sourcing?', terms: ['Kafka', 'RabbitMQ'] },
  { say: "What's the time complexity of building a heap from an unsorted array?", ref: "What's the time complexity of building a heap from an unsorted array?", terms: [] },
  { say: 'Tell me about a time you disagreed with your manager, and how you handled it.', ref: 'Tell me about a time you disagreed with your manager, and how you handled it.', terms: [] },
  { say: 'How do you prevent SQL injection in a Node JS application?', ref: 'How do you prevent SQL injection in a Node.js application?', terms: ['SQL', 'Node.js'] },
];

// The user's vocabulary (Settings › Voice): the clips' terms among others, as a real list would be
const VOCABULARY = [
  'Redis', 'Kubernetes', 'StatefulSet', 'useEffect', 'React', 'OAuth', 'PKCE', 'Postgres', 'MongoDB', 'gRPC',
  'Kafka', 'RabbitMQ', 'Node.js', 'TypeScript', 'GraphQL', 'Terraform', 'Docker', 'AWS Lambda', 'Elasticsearch', 'Next.js',
];

const MODELS = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ['base.en', 'small.en'];

// --- audio ----------------------------------------------------------------

function readWav(path) {
  const buf = readFileSync(path);
  let offset = 12;
  while (offset < buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === 'data') {
      const samples = new Float32Array(size / 2);
      for (let i = 0; i < samples.length; i++) samples[i] = buf.readInt16LE(offset + 8 + i * 2) / 32768;
      return samples;
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error(`No audio in ${path}`);
}

// Deterministic randomness, so every run hears the same noise
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;
}

const rms = (a) => Math.sqrt(a.reduce((n, x) => n + x * x, 0) / Math.max(1, a.length));
const silence = (seconds) => new Float32Array(Math.round(seconds * SAMPLE_RATE));
const concat = (...parts) => {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};

// Pink noise (Paul Kellet's filter): like a fan or air conditioning
function pinkNoise(length, seed) {
  const r = rng(seed);
  const out = new Float32Array(length);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < length; i++) {
    const w = r();
    b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
    out[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
  }
  return out;
}

function whiteNoise(length, level, seed) {
  const r = rng(seed);
  return Float32Array.from({ length }, () => r() * level);
}

// Other people talking: the other clips, layered and looped
function babble(length, voices, seed) {
  const r = rng(seed);
  const out = new Float32Array(length);
  for (let layer = 0; layer < 4; layer++) {
    const v = voices[Math.floor(((r() + 1) / 2) * voices.length) % voices.length];
    let at = -Math.floor(((r() + 1) / 2) * v.length);
    while (at < length) {
      for (let i = 0; i < v.length; i++) if (at + i >= 0 && at + i < length) out[at + i] += v[i];
      at += v.length + Math.floor(SAMPLE_RATE * 0.3);
    }
  }
  return out;
}

/** speech + noise scaled to `snrDb` against the speech's level */
function mix(speech, noise, snrDb) {
  const gain = rms(speech) / (rms(noise) * 10 ** (snrDb / 20));
  return speech.map((x, i) => x + noise[i] * gain);
}

const scale = (a, g) => a.map((x) => x * g);

// --- scoring --------------------------------------------------------------

const words = (s) => s.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(Boolean);

function wordErrors(ref, hyp) {
  const r = words(ref), h = words(hyp);
  const d = Array.from({ length: r.length + 1 }, (_, i) => [i, ...Array(h.length).fill(0)]);
  for (let j = 1; j <= h.length; j++) d[0][j] = j;
  for (let i = 1; i <= r.length; i++) {
    for (let j = 1; j <= h.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1));
    }
  }
  return { errors: d[r.length][h.length], total: r.length };
}

const termHits = (terms, hyp) => terms.filter((t) => hyp.toLowerCase().includes(t.toLowerCase())).length;

// --- models ---------------------------------------------------------------

const MODEL_FILES = [
  'config.json', 'generation_config.json', 'preprocessor_config.json', 'tokenizer.json', 'tokenizer_config.json',
  'onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx',
];

// Download to `<path>.partial`, resuming where a dropped attempt stopped
async function download(url, path) {
  const partial = `${path}.partial`;
  for (let attempt = 1; ; attempt++) {
    const have = existsSync(partial) ? statSync(partial).size : 0;
    try {
      const response = await fetch(url, { headers: have ? { Range: `bytes=${have}-` } : {} });
      if (response.status === 416) break; // already complete
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const append = have > 0 && response.status === 206;
      await streamPipeline(Readable.fromWeb(response.body), createWriteStream(partial, { flags: append ? 'a' : 'w' }));
      break;
    } catch (error) {
      if (attempt === 12) throw new Error(`Failed to download ${url}: ${error.message}`);
      console.warn(`  retrying ${url.split('/').pop()} (${error.message})`);
    }
  }
  renameSync(partial, path);
}

async function fetchModel(id) {
  for (const file of MODEL_FILES) {
    const path = join(MODEL_DIR, id, file);
    if (existsSync(path)) continue;
    mkdirSync(dirname(path), { recursive: true });
    console.log(`  downloading ${id}/${file}`);
    await download(`https://huggingface.co/${id}/resolve/main/${file}`, path);
  }
}

async function loadWhisper(name) {
  const id = `onnx-community/whisper-${name}`;
  await fetchModel(id);
  const [processor, tokenizer, model] = await Promise.all([
    AutoProcessor.from_pretrained(id),
    AutoTokenizer.from_pretrained(id),
    WhisperForConditionalGeneration.from_pretrained(id, { dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' } }),
  ]);
  return { processor, tokenizer, model, multilingual: !name.endsWith('.en') };
}

// ScreenPrompt's approach, for comparison: the raw recording, one 30 s window,
// no prompt, 64 tokens at most
async function baseline(parts, audio) {
  const { processor, tokenizer, model } = parts;
  const token = (n) => Number(tokenizer.convert_tokens_to_ids(n));
  const start = [token('<|startoftranscript|>'), ...(parts.multilingual ? [token('<|en|>'), token('<|transcribe|>')] : []), token('<|notimestamps|>')];
  const inputs = await processor(audio);
  const out = await model.generate({ ...inputs, decoder_input_ids: start, max_new_tokens: 64 });
  const ids = out.tolist()[0].map(Number);
  return cleanTranscript(tokenizer.decode(ids.slice(start.length), { skip_special_tokens: true }));
}

// BENCH_ABLATION=1: each clean-up step on its own (no prompt), to see which help
function partial({ trim, level }) {
  return async (parts, audio) => {
    let a = audio;
    if (trim) {
      const s = findSpeech(a);
      if (!s) return '';
      a = a.subarray(s.start, s.end);
    }
    if (level) a = normalize(a);
    return whisperTranscribe(parts, { chunks: splitAtPauses(a), seconds: a.length / SAMPLE_RATE }, '');
  };
}
const ABLATION = {
  'chunks only': partial({}),
  '+trim': partial({ trim: true }),
  '+trim+level': partial({ trim: true, level: true }),
};

const PIPELINES = process.env.BENCH_ABLATION ? ABLATION : {
  baseline: (parts, audio) => baseline(parts, audio),
  cleaned: async (parts, audio) => {
    const speech = prepareSpeech(audio);
    return speech ? whisperTranscribe(parts, speech, '') : '';
  },
  'cleaned+vocab': async (parts, audio) => {
    const speech = prepareSpeech(audio);
    return speech ? whisperTranscribe(parts, speech, buildPrompt(VOCABULARY)) : '';
  },
};

// --- run ------------------------------------------------------------------

mkdirSync(OUT, { recursive: true });
const ttsDir = join(OUT, 'tts');
if (!existsSync(join(ttsDir, `${String(CLIPS.length - 1).padStart(2, '0')}.wav`))) {
  const list = join(OUT, 'sentences.txt');
  writeFileSync(list, CLIPS.map((c) => c.say).join('\n'), 'utf8');
  console.log(execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(ROOT, 'scripts', 'bench-speech-tts.ps1'), list, ttsDir]).toString().trim());
}
const voices = CLIPS.map((_, i) => readWav(join(ttsDir, `${String(i).padStart(2, '0')}.wav`)));

// Each clip as recorded: key pressed a moment before speaking, released after
const recorded = (v, seed) => {
  const a = concat(silence(0.8), v, silence(1.2));
  const hiss = whiteNoise(a.length, 0.0006, seed); // mic self-noise, about -65 dB
  return a.map((x, i) => x + hiss[i]);
};

const CONDITIONS = {
  clean: (v, i) => recorded(v, i),
  fan: (v, i) => { const a = concat(silence(0.8), v, silence(1.2)); return mix(a, pinkNoise(a.length, 100 + i), 5); },
  chatter: (v, i) => { const a = concat(silence(0.8), v, silence(1.2)); return mix(a, babble(a.length, voices.filter((_, j) => j !== i), 200 + i), 8); },
  quiet: (v, i) => scale(recorded(v, i), 0.04), // a mic far away or turned down: about -35 dB
};

const tests = [];
for (const [condition, make] of Object.entries(CONDITIONS)) {
  voices.forEach((v, i) => tests.push({ condition, clip: CLIPS[i], audio: make(v, i) }));
}
// A long, rambling question past Whisper's 30 s window
const longIdx = [3, 0, 4, 8, 6, 1];
tests.push({
  condition: 'long',
  clip: { ref: longIdx.map((i) => CLIPS[i].ref).join(' '), terms: longIdx.flatMap((i) => CLIPS[i].terms) },
  audio: recorded(concat(...longIdx.flatMap((i) => [voices[i], silence(0.7)])), 999),
});
// Nothing said: the key held in a quiet room, next to a fan, in a busy office
const empty = { ref: '', terms: [] };
tests.push({ condition: 'no-speech', clip: empty, audio: whiteNoise(4 * SAMPLE_RATE, 0.0006, 7) });
tests.push({ condition: 'no-speech', clip: empty, audio: scale(pinkNoise(4 * SAMPLE_RATE, 8), 0.02) });
tests.push({ condition: 'no-speech', clip: empty, audio: scale(babble(4 * SAMPLE_RATE, voices, 9), 0.05) });

const results = [];
for (const name of MODELS) {
  process.stdout.write(`Loading whisper-${name}... `);
  const parts = await loadWhisper(name);
  console.log('ready');
  for (const [pipeline, run] of Object.entries(PIPELINES)) {
    const score = {};
    let ms = 0;
    for (const t of tests) {
      const began = performance.now();
      const hyp = await run(parts, t.audio);
      ms += performance.now() - began;
      const s = (score[t.condition] ??= { errors: 0, total: 0, terms: 0, termTotal: 0, heard: 0, samples: [] });
      if (t.condition === 'no-speech') {
        if (hyp) { s.heard++; s.samples.push(hyp); }
        s.total++;
        continue;
      }
      const e = wordErrors(t.clip.ref, hyp);
      s.errors += e.errors; s.total += e.total;
      s.terms += termHits(t.clip.terms, hyp); s.termTotal += t.clip.terms.length;
      if (e.errors > 0 && s.samples.length < 3) s.samples.push(hyp);
    }
    results.push({ model: name, pipeline, score, seconds: ms / 1000 / tests.length });
    const row = Object.entries(score).map(([c, s]) =>
      c === 'no-speech' ? `${c}: ${s.heard}/${s.total} hallucinated` : `${c}: WER ${((100 * s.errors) / s.total).toFixed(1)}% terms ${s.terms}/${s.termTotal}`);
    console.log(`  ${pipeline.padEnd(14)} ${(ms / 1000 / tests.length).toFixed(2)}s/clip | ${row.join(' | ')}`);
  }
}
writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2));
console.log(`\nDetails (incl. sample mistakes): ${join(OUT, 'results.json')}`);
