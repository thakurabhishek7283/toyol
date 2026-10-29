// Sends a few typical inputs (messy voice transcripts, topics, follow-ups) to
// the AI service in .env.local and shows how the replies parse, for tuning the
// instructions in src/lib/ai.ts.
//
//   node scripts/try-answers.mjs ["your own question"]
//
// MODE=interview answers as the candidate (BACKGROUND="..." for their experience).

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { streamAnswer, userMessage } from '../src/lib/ai.ts';
import { parseAnswer } from '../src/lib/answer.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  readFileSync(join(ROOT, '.env.local'), 'utf8').split('\n').filter((l) => /^\w+=/.test(l)).map((l) => {
    const at = l.indexOf('=');
    return [l.slice(0, at), l.slice(at + 1).trim()];
  }),
);
const settings = {
  endpoint: env.VITE_AI_ENDPOINT,
  model: env.VITE_AI_MODEL,
  apiKey: env.VITE_AI_API_KEY,
  mode: process.env.MODE === 'interview' ? 'interview' : 'assistant',
  background: process.env.BACKGROUND ?? '',
};

// Each case is a conversation: the inputs in order
const CASES = process.argv[2] ? [[['typed', process.argv[2]]]] : [
  [['voice', "so um the interviewer just asked me uh like how would you design a rate limiter for an API that's, you know, distributed across like many servers"]],
  [['typed', 'cap theorem']],
  [['voice', 'whats the difference between process and thread'], ['typed', 'example?']],
  [['voice', 'tell me about a time you had a conflict with a teammate']],
];

for (const inputs of CASES) {
  const history = [];
  for (const [source, input] of inputs) {
    const message = userMessage(input, source);
    const began = performance.now();
    let firstText = 0;
    const text = await streamAnswer(settings, [...history, message], () => { firstText ||= performance.now(); }, new AbortController().signal);
    const done = performance.now();
    history.push(message, { role: 'assistant', content: text });
    const parsed = parseAnswer(text);
    console.log('\n' + '='.repeat(80));
    console.log(`INPUT (${source}): ${input}`);
    console.log(`first text ${((firstText - began) / 1000).toFixed(1)}s, done ${((done - began) / 1000).toFixed(1)}s, ${text.split(/\s+/).length} words`);
    console.log(`-- question${parsed.depth ? ` (${parsed.depth})` : ''}: ${parsed.question || '(missing)'}`);
    console.log(`-- glance:\n${parsed.glance || '(missing)'}`);
    console.log(`-- details: ${parsed.details.split(/\s+/).filter(Boolean).length} words`);
    console.log(`-- follow-ups: ${parsed.followUps.map((f) => f.question).join(' | ') || '(none)'}`);
    if (process.env.FULL) console.log(`-- raw:\n${text}`);
  }
}
