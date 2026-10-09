import { describe, expect, it } from 'vitest';
import { getGrid, gridConfigFromSearch } from './grid';

// Measured on gregorybauwens.com, converted to iframe-local px (page x - 20).
const MEASURED = [
  { viewport: 1200, w: 1160, columnEnd: 313.2, contentStart: 392.2, cards: [[392.2, 634.8], [654.8, 897.4], [917.4, 1160]] },
  { viewport: 1440, w: 1400, columnEnd: 378, contentStart: 457, cards: [[457, 758], [778, 1079], [1099, 1400]] },
  { viewport: 1000, w: 960, columnEnd: 336, contentStart: 376, cards: [[376, 660], [676, 960]] },
  { viewport: 810, w: 770, columnEnd: 269.5, contentStart: 309.5, cards: [[309.5, 531.8], [547.8, 770]] },
];

describe('getGrid', () => {
  it.each(MEASURED)('matches the live page at a $viewport px viewport', ({ w, columnEnd, contentStart, cards }) => {
    const grid = getGrid(w);
    expect(grid.columnEnd).toBeCloseTo(columnEnd, 1);
    expect(grid.contentStart).toBeCloseTo(contentStart, 1);
    expect(grid.cards).toHaveLength(cards.length);
    grid.cards.forEach(([left, right], i) => {
      expect(left).toBeCloseTo(cards[i][0], 1);
      expect(right).toBeCloseTo(cards[i][1], 1);
    });
  });

  it('switches breakpoints at the Framer widths', () => {
    expect(getGrid(1160).breakpoint).toBe('desktop');
    expect(getGrid(1159).breakpoint).toBe('tablet');
    expect(getGrid(770).breakpoint).toBe('tablet');
    expect(getGrid(769).breakpoint).toBe('phone');
    expect(getGrid(350)).toMatchObject({ hasColumns: false, lines: [0, 350] });
  });

  it('counts a classic scrollbar toward the breakpoint, like Framer’s media queries', () => {
    // A 1200px window with a 15px scrollbar leaves a 1145px iframe, but Framer is on desktop.
    expect(getGrid(1145).breakpoint).toBe('tablet');
    expect(getGrid(1145, undefined, 15).breakpoint).toBe('desktop');
    expect(getGrid(755, undefined, 15).breakpoint).toBe('tablet');
    // The grid itself still uses the iframe width.
    expect(getGrid(1145, undefined, 15).contentStart).toBeCloseTo(0.27 * 1145 + 79);
  });

  it('clamps URL overrides to usable values', () => {
    const config = gridConfigFromSearch(new URLSearchParams('split=1&gutter=-5&cards=1e7&cardGap=abc'));
    expect(config.desktop).toEqual({ split: 0.01, gutter: 0, cards: 6, cardGap: 20 });
    expect(gridConfigFromSearch(new URLSearchParams('split=95')).desktop.split).toBe(0.6);
    expect(gridConfigFromSearch(new URLSearchParams('tsplit=40&tcards=0')).tablet).toMatchObject({ split: 0.4, cards: 1 });
  });

  it('falls back to a single column when an override leaves no room for cards', () => {
    const config = gridConfigFromSearch(new URLSearchParams('split=60&gutter=200&cards=6&cardGap=80'));
    expect(getGrid(1160, config)).toMatchObject({ breakpoint: 'phone', hasColumns: false, lines: [0, 1160] });
  });

  it('reads grid overrides from the embed URL', () => {
    const config = gridConfigFromSearch(new URLSearchParams('split=30&gutter=60&cards=4'));
    const grid = getGrid(1200, config);
    expect(grid.columnEnd).toBeCloseTo(360);
    expect(grid.contentStart).toBeCloseTo(420);
    expect(grid.cards).toHaveLength(4);
  });
});
