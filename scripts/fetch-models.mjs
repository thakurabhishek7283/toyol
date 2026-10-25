// Downloads the speech model into src-tauri/resources/models, for development
// builds (and scripts/bench-speech.mjs). It's too big for git (~820 MB), so
// this runs before every `tauri dev` (see package.json). Installed copies
// download it themselves on first use instead (src-tauri/src/model.rs), so the
// installer stays small. The file is pinned to a revision and checked against
// its SHA-256; a file already present and intact is skipped, and a dropped
// download resumes.
// Adapted from ScreenPrompt (MIT).

import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'src-tauri', 'resources', 'models');
const ATTEMPTS = 40; // each attempt resumes, so a flaky connection still gets there

// Whisper medium.en for whisper.cpp, 8-bit. Chosen by benchmark
// (scripts/bench-speech.mjs): with the vocabulary prompt it got 17-18 of 18
// technical terms right through noise and chatter, where small.en got 17 and
// large-v3-turbo did worse with people talking in the background. 8-bit is
// near-lossless next to the 16-bit original and half its size. Keep in sync
// with src-tauri/src/model.rs.
const REVISION = '5359861c739e955e79d9a303bcbc70fb988958b1';
const MODELS = {
  'ggml-medium.en-q8_0.bin': '43fa2cd084de5a04399a896a9a7a786064e221365c01700cea4666005218f11c',
};

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

for (const [file, expected] of Object.entries(MODELS)) {
  const path = join(OUT_DIR, file);
  if (existsSync(path) && (await sha256(path)) === expected) continue;
  mkdirSync(OUT_DIR, { recursive: true });
  console.log(`Downloading ${file}`);
  await download(`https://huggingface.co/ggerganov/whisper.cpp/resolve/${REVISION}/${file}`, path);
  const actual = await sha256(path);
  if (actual !== expected) {
    rmSync(path);
    throw new Error(`${file}: SHA-256 is ${actual}, expected ${expected}`);
  }
}
console.log('Bundled speech model is ready.');
