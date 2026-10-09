import { describe, expect, it } from 'vitest';
import { bandHeightFor, planFor } from './compose';
import { DEFAULT_GRID, FRAMER_IFRAME_HEIGHT, getGrid, gridConfigFromSearch, type GridConfig } from './grid';
import { GRID_BANNER_OPTIONS } from './options';

const DESKTOP = [1160, 1200, 1280, 1337.5, 1400];
const TABLET = [770, 850, 960, 1100, 1159];
const PHONE = [335, 350, 500, 769];
const WIDTHS = [...DESKTOP, ...TABLET, ...PHONE];
const EPS = 0.01;

// Every card-count override the URL accepts, plus a few column changes.
const OVERRIDES = ['', 'cards=1', 'cards=2', 'cards=4', 'cards=6', 'tcards=1', 'tcards=3', 'split=20&gutter=40', 'split=0.5&cardGap=60'];

const check = (config: GridConfig, w: number, optionIndex: number, strictDecrease: boolean) => {
  const option = GRID_BANNER_OPTIONS[optionIndex];
  const grid = getGrid(w, config);
  const band = bandHeightFor(w);
  const { shapes, snapLines } = planFor(option, grid);

  expect(band).toBeLessThanOrEqual(FRAMER_IFRAME_HEIGHT[grid.breakpoint]);
  expect(shapes.length).toBeGreaterThan(1);
  shapes.forEach((shape, i) => {
    expect(shape.width).toBeGreaterThan(0);
    expect(shape.x).toBeGreaterThanOrEqual(-EPS);
    expect(shape.x + shape.width).toBeLessThanOrEqual(w + EPS);
    expect(shape.y ?? 0).toBeGreaterThanOrEqual(-EPS);
    expect((shape.y ?? 0) + (shape.height ?? band)).toBeLessThanOrEqual(band + EPS);
    if (i > 0) {
      const prev = shapes[i - 1];
      expect(shape.x).toBeGreaterThanOrEqual(prev.x + prev.width - EPS);
      // Transpose falls in height, so equal widths are fine there.
      if (strictDecrease) expect(shape.width).toBeLessThanOrEqual(prev.width + EPS);
    }
  });

  const edges = shapes.flatMap((s) => [s.x, s.x + s.width]);
  expect(snapLines).toContain(w);
  snapLines.forEach((line) => {
    const nearest = Math.min(...edges.map((edge) => Math.abs(edge - line)));
    expect(nearest, `no edge on line ${line.toFixed(2)}`).toBeLessThan(EPS);
  });
};

describe.each(GRID_BANNER_OPTIONS.map((option, index) => ({ id: option.id, index })))('$id', ({ id, index }) => {
  it.each(WIDTHS)('is a clean row on its grid lines at w=%s', (w) => {
    check(DEFAULT_GRID, w, index, true);
  });

  it.each(OVERRIDES.flatMap((query) => WIDTHS.map((w) => [query, w] as const)))(
    'survives the "%s" override at w=%s',
    (query, w) => {
      check(gridConfigFromSearch(new URLSearchParams(query)), w, index, id !== 'transpose');
    }
  );
});
