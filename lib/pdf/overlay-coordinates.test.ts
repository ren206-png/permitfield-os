import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { fillOverlay, layoutOverlayText } from './overlay-coordinates';

const measure = (text: string) => text.length * 4; // 4pt per character

describe('layoutOverlayText()', () => {
  it('keeps one line when there is no width limit', () => {
    expect(layoutOverlayText('a long description', { maxWidth: null, maxLines: null, measure })).toEqual(['a long description']);
  });

  it('wraps words to the width', () => {
    expect(layoutOverlayText('new partitions and lighting', { maxWidth: 60, maxLines: null, measure })).toEqual([
      'new partitions',
      'and lighting',
    ]);
  });

  it('cuts to maxLines and ends with ...', () => {
    const lines = layoutOverlayText('one two three four five six seven eight', { maxWidth: 40, maxLines: 2, measure });
    expect(lines).toHaveLength(2);
    expect(lines[1].endsWith('...')).toBe(true);
    expect(measure(lines[1])).toBeLessThanOrEqual(40);
  });
});

describe('fillOverlay()', () => {
  it('draws text the standard font cannot encode as "?" instead of failing', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const { filledCount } = await fillOverlay(await doc.save(), [{ page: 1, x: 50, y: 700, value: 'Zoë 李' }]);
    expect(filledCount).toBe(1);
  });
});
