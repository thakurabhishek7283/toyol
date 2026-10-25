// Whisper decoding on audio prepared by prepareSpeech. The model is called
// directly rather than through the library's pipeline, which can't take a
// prompt. Shared by the speech worker and scripts/bench-speech.mjs.

import { SAMPLE_RATE, type PreparedSpeech } from './audio.ts';
import { cleanTranscript, maxTokensFor } from './transcript.ts';

/** The loaded model's parts, as @huggingface/transformers returns them */
export interface WhisperParts {
  processor: (audio: Float32Array) => Promise<object>;
  tokenizer: {
    convert_tokens_to_ids(token: string): number | bigint;
    encode(text: string, options: { add_special_tokens: boolean }): number[];
    decode(ids: number[], options: { skip_special_tokens: boolean }): string;
  };
  model: { generate(options: object): Promise<unknown> };
  multilingual: boolean; // needs language and task tokens (not an .en model)
}

// Whisper's decoder holds 448 tokens: prompt, start markers and the transcript
const DECODER_LIMIT = 448;
const MAX_PROMPT_TOKENS = 200;
// Each chunk of a long recording also gets the end of the previous chunk's
// text as its prompt, as Whisper does with long audio, so sentences carry on
const CARRY_WORDS = 40;

async function decodeChunk(parts: WhisperParts, chunk: Float32Array, prompt: string): Promise<string> {
  const { processor, tokenizer, model } = parts;
  const token = (name: string) => Number(tokenizer.convert_tokens_to_ids(name));
  // The prompt's end matters most (the latest context), so a long one loses its start
  const promptIds = prompt ? tokenizer.encode(` ${prompt}`, { add_special_tokens: false }).slice(-MAX_PROMPT_TOKENS) : [];
  const start = [
    ...(promptIds.length > 0 ? [token('<|startofprev|>'), ...promptIds] : []),
    token('<|startoftranscript|>'),
    ...(parts.multilingual ? [token('<|en|>'), token('<|transcribe|>')] : []),
    token('<|notimestamps|>'),
  ];
  const seconds = chunk.length / SAMPLE_RATE;
  const inputs = await processor(chunk);
  const output = await model.generate({
    ...inputs,
    decoder_input_ids: start,
    max_new_tokens: Math.min(maxTokensFor(seconds), DECODER_LIMIT - start.length - 1),
  });
  // The output repeats the prompt and markers; keep only what was heard
  const ids = (output as { tolist(): (number | bigint)[][] }).tolist()[0].map(Number);
  return tokenizer.decode(ids.slice(start.length), { skip_special_tokens: true });
}

/** The text spoken in `speech`, with `prompt` (see buildPrompt) steering word choice */
export async function whisperTranscribe(parts: WhisperParts, speech: PreparedSpeech, prompt: string): Promise<string> {
  const pieces: string[] = [];
  for (const chunk of speech.chunks) {
    const carried = pieces.join(' ').split(/\s+/).slice(-CARRY_WORDS).join(' ');
    const chunkPrompt = [prompt, carried].filter(Boolean).join(' ');
    pieces.push(cleanTranscript(await decodeChunk(parts, chunk, chunkPrompt), chunkPrompt));
  }
  return pieces.filter(Boolean).join(' ').trim();
}
