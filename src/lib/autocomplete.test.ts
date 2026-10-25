import { describe, expect, it } from 'vitest';
import { conversationTerms, EMPTY_MEMORY, learnQuestion, learnTerms, suggest, type SuggestContext } from './autocomplete';

const context = (over: Partial<SuggestContext> = {}): SuggestContext => ({
  memory: EMPTY_MEMORY,
  vocabulary: [],
  conversation: new Map(),
  ...over,
});

describe('suggest', () => {
  it('completes a question opening', () => {
    expect(suggest("what's the diff", context())[0].text).toBe("what's the difference between");
  });

  it('keeps the capital the user typed', () => {
    const top = suggest('Expl', context())[0];
    expect(top.text.startsWith('Expl')).toBe(true);
  });

  it('completes a word from the vocabulary in its own spelling', () => {
    const ctx = context({ vocabulary: ['gRPC', 'Kubernetes'] });
    expect(suggest('how does grp', ctx)[0].text).toBe('how does gRPC');
    expect(suggest('deploy to kube', ctx)[0].text).toBe('deploy to Kubernetes');
  });

  it('offers questions asked before, most recent first', () => {
    let memory = learnQuestion(EMPTY_MEMORY, 'How does Redis persistence work?');
    memory = learnQuestion(memory, 'How does Redis eviction work?');
    const list = suggest('how does red', context({ memory }));
    expect(list[0]).toMatchObject({ kind: 'question', text: 'How does Redis eviction work?' });
    expect(list[1]).toMatchObject({ kind: 'question', text: 'How does Redis persistence work?' });
  });

  it('predicts the next word it has seen follow', () => {
    let memory = EMPTY_MEMORY;
    memory = learnQuestion(memory, 'explain idempotency keys');
    memory = learnQuestion(memory, 'why use idempotency keys');
    expect(suggest('what are idempotency ', context({ memory }))[0]).toMatchObject({ kind: 'next', text: 'what are idempotency keys' });
  });

  it("doesn't guess the next word from a single sighting", () => {
    const memory = learnQuestion(EMPTY_MEMORY, 'explain zebra stripes');
    expect(suggest('zebra ', context({ memory }))).toEqual([]);
  });

  it("doesn't capitalize common words that started a sentence", () => {
    const memory = learnQuestion(EMPTY_MEMORY, 'Difference between threads and processes');
    expect(suggest('the diff', context({ memory }))[0].text).toBe('the difference');
  });

  it('suggests terms from the conversation', () => {
    const conversation = conversationTerms(['Use **idempotency keys** so retries are safe.']);
    expect(suggest('what about idem', context({ conversation }))[0].text).toBe('what about idempotency');
  });

  it('suggests nothing for an empty box or one letter', () => {
    expect(suggest('', context())).toEqual([]);
    expect(suggest('w', context())).toEqual([]);
  });
});

describe('learning', () => {
  it('keeps one copy of a repeated question, at the front', () => {
    let memory = learnQuestion(EMPTY_MEMORY, 'What is CAP?');
    memory = learnQuestion(memory, 'Other question');
    memory = learnQuestion(memory, 'what is cap?');
    expect(memory.questions).toEqual(['what is cap?', 'Other question']);
  });

  it('learns names and long terms from answers, not common words', () => {
    const memory = learnTerms(EMPTY_MEMORY, 'Put pgBouncer in front for the pooling of connections.');
    expect(memory.words.pgBouncer).toBeGreaterThan(0);
    expect(memory.words.the).toBeUndefined();
    expect(memory.words.front).toBeUndefined();
  });
});
