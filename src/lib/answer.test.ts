import { describe, expect, it } from 'vitest';
import { parseAnswer } from './answer';

const FULL = `Q: How does a hash map handle collisions?

**With separate chaining or open addressing.**

- **Chaining**: each bucket holds a list.
- **Open addressing**: probe for the next free slot.

## Details
Chaining is simple; open addressing is cache-friendly.

## Follow-ups
- **What is the load factor?** Entries divided by buckets.
- **Why resize?** To keep lookups O(1)
  on average.`;

describe('parseAnswer', () => {
  it('splits a full reply into its parts', () => {
    const parsed = parseAnswer(FULL);
    expect(parsed.question).toBe('How does a hash map handle collisions?');
    expect(parsed.glance).toMatch(/^\*\*With separate chaining/);
    expect(parsed.glance).toMatch(/probe for the next free slot\.$/);
    expect(parsed.details).toBe('Chaining is simple; open addressing is cache-friendly.');
    expect(parsed.followUps).toEqual([
      { question: 'What is the load factor?', answer: 'Entries divided by buckets.' },
      { question: 'Why resize?', answer: 'To keep lookups O(1) on average.' },
    ]);
  });

  it('shows nothing while only the start of the Q line has arrived', () => {
    expect(parseAnswer('Q')).toMatchObject({ question: '', glance: '' });
    expect(parseAnswer('Q:')).toMatchObject({ question: '', glance: '' });
  });

  it('shows the question as it streams in', () => {
    expect(parseAnswer('Q: How does a ha').question).toBe('How does a ha');
  });

  it('hides a heading that is still arriving', () => {
    const parsed = parseAnswer('Q: x\n\n**Answer.**\n\n## Det');
    expect(parsed.glance).toBe('**Answer.**');
    expect(parsed.details).toBe('');
  });

  it('accepts a bold Q label and other heading levels', () => {
    const parsed = parseAnswer('**Q:** What is DNS?\n\n**Names to addresses.**\n\n### Details:\nMore.');
    expect(parsed.question).toBe('What is DNS?');
    expect(parsed.details).toBe('More.');
  });

  it('treats a reply without the format as the answer', () => {
    expect(parseAnswer('Just some text.')).toMatchObject({ question: '', glance: 'Just some text.' });
  });
});
