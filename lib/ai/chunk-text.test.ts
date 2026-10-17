import { describe, expect, it } from 'vitest';
import { chunkText } from './chunk-text';

describe('chunkText()', () => {
  it('returns nothing for empty or whitespace-only text', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('  \n\n  ')).toEqual([]);
  });

  it('keeps short text as a single chunk', () => {
    expect(chunkText('One.\n\nTwo.')).toEqual(['One. Two.']);
  });

  it('never exceeds maxChars plus the overlap, and loses no words', () => {
    const words = Array.from({ length: 600 }, (_, i) => `word${i}`);
    const text = words.join(' ');
    const chunks = chunkText(text, { maxChars: 200, overlapChars: 40 });
    expect(chunks.length).toBeGreaterThan(5);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(260);
    const joined = chunks.join(' ');
    for (const word of words) expect(joined).toContain(word);
  });

  it('starts each chunk with text carried over from the end of the previous one', () => {
    const text = Array.from({ length: 80 }, (_, i) => `para${i} ${'x'.repeat(30)}`).join('\n\n');
    const [first, second] = chunkText(text, { maxChars: 300, overlapChars: 60 });
    const secondStart = second.split(' ')[0];
    expect(first.slice(-60)).toContain(secondStart);
  });

  it('cuts a single huge paragraph on whitespace', () => {
    const chunks = chunkText('a '.repeat(2000), { maxChars: 500, overlapChars: 0 });
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.every((c) => c.length <= 500)).toBe(true);
  });
});
