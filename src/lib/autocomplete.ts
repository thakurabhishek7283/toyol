// Autocompletion for the question box: whole questions asked before, common
// question openings, the word being typed, and the likely next word. Learns
// from what's asked (and the answers' terms), so it gets better with use.
// Everything stays on this PC (useMemory saves it).

import { SEED_PHRASES, SEED_WORDS } from './words';

export interface Memory {
  questions: string[]; // asked before, most recent first
  words: Record<string, number>; // how often each word was typed (or met in answers)
  next: Record<string, Record<string, number>>; // word (lowercase) -> words typed after it -> count
}

export const EMPTY_MEMORY: Memory = { questions: [], words: {}, next: {} };

export interface Suggestion {
  text: string; // the whole input once accepted
  label: string; // what the list shows
  kind: 'question' | 'phrase' | 'word' | 'next';
}

const MAX_QUESTIONS = 300;
const MAX_WORDS = 5000;
const MAX_SUGGESTIONS = 5;
const MIN_QUESTION_PREFIX = 3; // characters before past questions are offered
const MIN_WORD_PREFIX = 2;

// A word: letters first, then letters, digits and the joiners in "Node.js",
// "C++", "C#", "don't", "self-attention" (not ending on a joiner)
const WORD = /[A-Za-z][A-Za-z0-9+#.'-]*[A-Za-z0-9+#]|[A-Za-z]/g;
const PARTIAL = /[A-Za-z][A-Za-z0-9+#.'-]*$/;

export const wordsIn = (text: string): string[] => text.match(WORD) ?? [];

// Seed words ranked by position: common words first
const SEED_RANK = new Map<string, number>();
SEED_WORDS.forEach((w, i) => {
  if (!SEED_RANK.has(w.toLowerCase())) SEED_RANK.set(w.toLowerCase(), 1 - i / SEED_WORDS.length);
});
const SEED_FORMS = new Map(SEED_WORDS.map((w) => [w.toLowerCase(), w]));

/**
 * A word as it should be remembered: a common word capitalized only because it
 * started a sentence ("The", "Process") goes back to lowercase; names and terms
 * ("Kubernetes", "gRPC") keep their spelling
 */
function wordForm(word: string): string {
  return /^[A-Z][a-z]+$/.test(word) && SEED_RANK.has(word.toLowerCase()) ? word.toLowerCase() : word;
}

// Next words from the seed phrases ("difference" -> "between")
const SEED_NEXT = new Map<string, Map<string, number>>();
for (const phrase of SEED_PHRASES) {
  const w = wordsIn(phrase);
  for (let i = 0; i + 1 < w.length; i++) {
    const after = SEED_NEXT.get(w[i].toLowerCase()) ?? new Map<string, number>();
    after.set(w[i + 1], (after.get(w[i + 1]) ?? 0) + 1);
    SEED_NEXT.set(w[i].toLowerCase(), after);
  }
}

export interface SuggestContext {
  memory: Memory;
  vocabulary: string[]; // the user's own terms (Settings), spelled their way
  conversation: Map<string, number>; // terms in the current conversation, with counts
}

/** Keep the user's capital at the start ("Diff" -> "Difference"), but a term's own casing ("grpc" -> "gRPC") */
function completeWord(partial: string, candidate: string): string {
  if (candidate !== candidate.toLowerCase()) return candidate;
  return partial + candidate.slice(partial.length);
}

/** Completions for `input` (the caret at its end), best first */
export function suggest(input: string, context: SuggestContext): Suggestion[] {
  const out: Suggestion[] = [];
  const seen = new Set<string>();
  const add = (s: Suggestion) => {
    if (s.text === input || seen.has(s.text.toLowerCase())) return;
    seen.add(s.text.toLowerCase());
    out.push(s);
  };
  const lower = input.toLowerCase();
  const trimmed = input.trimStart();

  // Whole questions asked before, most recent first
  if (trimmed.length >= MIN_QUESTION_PREFIX) {
    for (const q of context.memory.questions) {
      if (q.length > input.length && q.toLowerCase().startsWith(lower)) add({ text: q, label: q, kind: 'question' });
      if (out.length >= 2) break;
    }
  }

  // Question openings: "what's the diff" -> "what's the difference between"
  if (trimmed.length >= MIN_WORD_PREFIX && !/\s$/.test(input)) {
    for (const phrase of SEED_PHRASES) {
      if (phrase.length > lower.length && phrase.toLowerCase().startsWith(lower)) {
        add({ text: input + phrase.slice(input.length), label: phrase, kind: 'phrase' });
        break;
      }
    }
  }

  const partialMatch = PARTIAL.exec(input);
  const partial = partialMatch && !/\s$/.test(input) ? partialMatch[0] : '';
  if (partial.length >= MIN_WORD_PREFIX) {
    // The word being typed
    const head = input.slice(0, input.length - partial.length);
    for (const word of rankWords(partial, context)) {
      const completed = completeWord(partial, word);
      add({ text: head + completed, label: completed, kind: 'word' });
    }
  } else if (/\s$/.test(input)) {
    // The next word, from what usually follows the last one
    const previous = wordsIn(input).pop();
    if (previous) {
      for (const word of rankNext(previous, context)) add({ text: input + word, label: word, kind: 'next' });
    }
  }

  return out.slice(0, MAX_SUGGESTIONS);
}

function rankWords(partial: string, context: SuggestContext): string[] {
  const prefix = partial.toLowerCase();
  const scores = new Map<string, { word: string; score: number; source: number }>();
  // `source` ranks whose spelling is used when several offer the same word:
  // the user's vocabulary, then their own typing, then the conversation, then the seed list
  const offer = (word: string, score: number, source: number) => {
    const key = word.toLowerCase();
    // A letter or two left isn't worth a suggestion, except for the user's own terms ("grp" -> "gRPC")
    if (!key.startsWith(prefix) || key.length < prefix.length + (source >= 3 ? 1 : 2)) return;
    const current = scores.get(key);
    const form = current && current.source > source ? current.word : word;
    scores.set(key, { word: form, score: (current?.score ?? 0) + score, source: Math.max(source, current?.source ?? 0) });
  };
  for (const term of context.vocabulary) for (const w of term.includes(' ') ? [term] : wordsIn(term)) offer(w, 40, 4);
  for (const [w, n] of Object.entries(context.memory.words)) offer(w, 6 * Math.log2(1 + n), 3);
  for (const [w, n] of context.conversation) offer(w, 4 * Math.log2(1 + n), 2);
  for (const [key, rank] of SEED_RANK) if (key.startsWith(prefix)) offer(SEED_FORMS.get(key) ?? key, 3 * rank, 1);
  return [...scores.values()].sort((a, b) => b.score - a.score || a.word.length - b.word.length).slice(0, MAX_SUGGESTIONS).map((s) => s.word);
}

function rankNext(previous: string, context: SuggestContext): string[] {
  const scores = new Map<string, number>();
  for (const [w, n] of Object.entries(context.memory.next[previous.toLowerCase()] ?? {})) scores.set(w, (scores.get(w) ?? 0) + n * 2);
  for (const [w, n] of SEED_NEXT.get(previous.toLowerCase()) ?? []) scores.set(w, (scores.get(w) ?? 0) + n * 3);
  // Only a confident guess: something typed after it at least twice, or a set phrase
  return [...scores.entries()].filter(([, s]) => s >= 3).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([w]) => w);
}

/** `memory` with a question just asked learned from */
export function learnQuestion(memory: Memory, question: string): Memory {
  const q = question.replace(/\s+/g, ' ').trim();
  if (!q) return memory;
  const questions = [q, ...memory.questions.filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, MAX_QUESTIONS);
  const words = { ...memory.words };
  const next = { ...memory.next };
  const tokens = wordsIn(q).map(wordForm);
  tokens.forEach((w, i) => {
    words[w] = (words[w] ?? 0) + 1;
    if (i + 1 < tokens.length) {
      const key = w.toLowerCase();
      next[key] = { ...next[key], [tokens[i + 1]]: (next[key]?.[tokens[i + 1]] ?? 0) + 1 };
    }
  });
  return { questions, words: prune(words), next };
}

/** `memory` with an answer's terms (longer words, and names like "Kubernetes") added */
export function learnTerms(memory: Memory, text: string): Memory {
  const words = { ...memory.words };
  let added = 0;
  for (const w of new Set(wordsIn(text).map(wordForm))) {
    if (added >= 60) break;
    const term = w.length >= 7 || (w.length >= 3 && w !== w.toLowerCase() && !/^[A-Z][a-z]+$/.test(w));
    if (term && !SEED_RANK.has(w.toLowerCase())) {
      words[w] = (words[w] ?? 0) + 0.5;
      added++;
    }
  }
  return { ...memory, words: prune(words) };
}

function prune(words: Record<string, number>): Record<string, number> {
  const entries = Object.entries(words);
  if (entries.length <= MAX_WORDS) return words;
  return Object.fromEntries(entries.sort((a, b) => b[1] - a[1]).slice(0, MAX_WORDS));
}

/** Terms in a conversation's text, with counts, for completions while it lasts */
export function conversationTerms(texts: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const text of texts) {
    for (const w of wordsIn(text).map(wordForm)) {
      if (w.length >= 4) counts.set(w, (counts.get(w) ?? 0) + 1);
    }
  }
  return counts;
}
