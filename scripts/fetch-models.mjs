// Downloads the speech model bundled with the app into
// src-tauri/resources/models, which tauri.conf.json ships as resources. It's
// too big for git (~420 MB), so this runs before every `tauri dev` / `tauri
// build` (see package.json). Files are pinned to a model revision and checked
// against their SHA-256, so every build bundles exactly the same bytes; files
// already present and intact are skipped, and dropped downloads resume.
// Adapted from ScreenPrompt (MIT).

import { createHash } from 'node:crypto';
import { copyFileSync, createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'src-tauri', 'resources', 'models');
// The speech benchmark's copy (scripts/bench-speech.mjs), used if it's there
const BENCH_DIR = join(ROOT, 'bench', 'models');
const ATTEMPTS = 40; // each attempt resumes, so a flaky connection still gets there

// Keep in sync with SPEECH_MODEL in src/lib/speech/protocol.ts and the dtypes
// in src/workers/speech.worker.ts (q8 = the *_quantized.onnx files)
const MODELS = [
  {
    id: 'onnx-community/whisper-small.en', // ~420 MB
    revision: '482fb8ba081b6e906f92efe103622316b2a0cc69',
    files: {
      'config.json': '8825c4174cb86f94d9fa67614942f8aa17bfbbdf2fae5426d4adfd0bc5893c43',
      'generation_config.json': '5490747ca976d6b3765280a0697d66489020c2afa6e754244d9cd093e1639331',
      'preprocessor_config.json': 'a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d',
      'tokenizer.json': '5eb60cec1e77aeeb6869a2bb5a8e01a84c3fe5d072d75369343021fe6f5310d0',
      'tokenizer_config.json': '93879c3dccdd4b976f709acd85b44778873f30c275e67026f30ca1e4c975230c',
      'onnx/encoder_model_quantized.onnx': 'dae677b93ca77f911d858238e277026fa8f95a94cb899ea443ec78ee62726edf', // on the CPU
      'onnx/encoder_model_fp16.onnx': '719a2f2d4450fef5bba1cf9df585336ddd1fddcf2ed0011a274d89609b25ccd2', // on the GPU
      'onnx/decoder_model_merged_quantized.onnx': '29132c41903c252d0f2b9e59ee1e7d75f7d0b64d37f3e36d1ecc4a1a1af62953',
    },
  },
];

async function sha256(path) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

// Download to `<path>.partial`, resuming where an earlier attempt stopped
async function download(url, path) {
  const partial = `${path}.partial`;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const have = existsSync(partial) ? statSync(partial).size : 0;
    try {
      const response = await fetch(url, { headers: have ? { Range: `bytes=${have}-` } : {} });
      if (response.status === 416) break; // already complete
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      // 200 to a range request means the server is sending the whole file again
      const append = have > 0 && response.status === 206;
      await pipeline(Readable.fromWeb(response.body), createWriteStream(partial, { flags: append ? 'a' : 'w' }));
      break;
    } catch (error) {
      if (attempt === ATTEMPTS) throw new Error(`Failed to download ${url}: ${error.message}`);
      const now = existsSync(partial) ? statSync(partial).size : 0;
      console.warn(`  resuming at ${(now / 1e6).toFixed(0)} MB (${error.message})`);
    }
  }
  renameSync(partial, path);
}

for (const model of MODELS) {
  for (const [file, expected] of Object.entries(model.files)) {
    const path = join(OUT_DIR, model.id, file);
    if (existsSync(path) && (await sha256(path)) === expected) continue;
    mkdirSync(dirname(path), { recursive: true });

    const benchCopy = join(BENCH_DIR, model.id, file);
    if (existsSync(benchCopy) && (await sha256(benchCopy)) === expected) {
      copyFileSync(benchCopy, path);
      continue;
    }

    console.log(`Downloading ${model.id}/${file}`);
    await download(`https://huggingface.co/${model.id}/resolve/${model.revision}/${file}`, path);
    const actual = await sha256(path);
    if (actual !== expected) {
      rmSync(path);
      throw new Error(`${model.id}/${file}: SHA-256 is ${actual}, expected ${expected}`);
    }
  }
}
console.log('Bundled speech model is ready.');
