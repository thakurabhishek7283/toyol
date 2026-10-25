// What goes into Whisper besides the audio (a prompt that steers it to the
// right words), and the clean-up of what comes out.

// Whisper takes up to 224 tokens of "previous text" as a prompt. Words it has
// "just heard" are spelled the same way again: a list of names and jargon
// stops "Kubernetes" coming out as "Cooper Netties". Kept well under the limit:
// a long prompt makes it more likely to echo the prompt on unclear audio.
export const MAX_PROMPT_CHARS = 600;

/** Words from a comma- or newline-separated list, without duplicates */
export function parseVocabulary(text: string): string[] {
  const seen = new Set<string>();
  const words: string[] = [];
  for (const raw of text.split(/[,\n;]+/)) {
    const word = raw.trim();
    if (word && !seen.has(word.toLowerCase())) {
      seen.add(word.toLowerCase());
      words.push(word);
    }
  }
  return words;
}

/**
 * The prompt for Whisper: the user's own vocabulary, then what the
 * conversation is about (the last question), as text it "heard before". Ends
 * in a full stop: a punctuated prompt gets punctuated, capitalized output.
 */
export function buildPrompt(vocabulary: string[], context = ''): string {
  const parts: string[] = [];
  if (vocabulary.length > 0) parts.push(`${vocabulary.join(', ')}.`);
  const recent = context.replace(/\s+/g, ' ').trim();
  if (recent) parts.push(/[.?!]$/.test(recent) ? recent : `${recent}.`);
  let prompt = parts.join(' ');
  // Over the limit: keep the start (the vocabulary matters most), at a word break
  if (prompt.length > MAX_PROMPT_CHARS) prompt = prompt.slice(0, prompt.lastIndexOf(' ', MAX_PROMPT_CHARS));
  return prompt;
}

// What Whisper tends to "hear" in silence and noise. Only dropped when it's
// the whole transcript: "thank you" inside a real question stays.
const SILENCE_PHRASES = new Set([
  'you', 'thank you', 'thank you.', 'thanks for watching', 'thanks for watching!', 'thank you for watching',
  'bye', 'bye.', 'okay', 'oh', 'so', 'please subscribe', 'subtitles by the amara.org community',
]);

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Collapse a phrase repeated three or more times in a row down to one: Whisper's
 * other failure mode is looping ("the the the the", or one sentence over and
 * over). Twice is left alone; people do repeat themselves.
 */
export function collapseRepeats(text: string): string {
  const words = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let i = 0;
  while (i < words.length) {
    let collapsed = false;
    for (let n = Math.min(12, Math.floor((words.length - i) / 3)); n >= 1; n--) {
      const unit = norm(words.slice(i, i + n).join(' '));
      if (!unit) continue;
      let reps = 1;
      while (i + (reps + 1) * n <= words.length && norm(words.slice(i + reps * n, i + (reps + 1) * n).join(' ')) === unit) reps++;
      if (reps >= 3) {
        out.push(...words.slice(i, i + n));
        i += reps * n;
        collapsed = true;
        break;
      }
    }
    if (!collapsed) out.push(words[i++]);
  }
  return out.join(' ');
}

/** Whisper's output made ready to send: noise tags out, loops collapsed; empty if nothing was said */
export function cleanTranscript(text: string, prompt = ''): string {
  let cleaned = text
    .replace(/\[[^\]]*\]|\(\s*(?:music|silence|noise|inaudible|blank_audio|laughs?|applause|coughs?)[^)]*\)/gi, ' ')
    .replace(/[♪♫]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  cleaned = collapseRepeats(cleaned);
  // Leading "-" or "..." from subtitle style
  cleaned = cleaned.replace(/^[-–—.…\s]+/, '').trim();

  const plain = norm(cleaned);
  if (!plain || SILENCE_PHRASES.has(plain) || SILENCE_PHRASES.has(cleaned.toLowerCase())) return '';
  // On unclear audio Whisper can just repeat its prompt back: that's not speech
  if (prompt && plain.length > 12 && norm(prompt).includes(plain)) return '';
  return cleaned;
}

/**
 * Most tokens to let Whisper write for `seconds` of speech. People say about
 * 2.5-3 words a second (~4 tokens); generous room on top, but a cap, so a
 * looping decode stops early instead of filling the window.
 */
export function maxTokensFor(seconds: number): number {
  return Math.min(220, Math.ceil(seconds * 6) + 24);
}
