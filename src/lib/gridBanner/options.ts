/**
 * Grid-aligned layouts for the bubble banner. Each option is served at
 * /#/embed-grid/<id> and compared side by side at /#/grid-options.
 *
 * Layouts work in iframe px against the measured page grid (see grid.ts):
 * C = label column end, L = content line, cards = project card columns.
 * They key off the number of card columns rather than the breakpoint name, so
 * the cards/tcards URL overrides keep working.
 */

import { CLASSIC_UNITS, classicLayout, type BandShape, type BannerPlan, type GridBannerOption } from './compose';
import { getGrid, type Grid } from './grid';

// ============================================================================
// HELPERS
// ============================================================================

const EPS = 0.01;

/** Places shapes left to right from `start`, `gap` apart. */
const row = (start: number, widths: number[], gap: number): BandShape[] => {
  let x = start;
  return widths.map((width) => {
    const shape = { x, width };
    x += width + gap;
    return shape;
  });
};

/** `count` widths, each half the last, that exactly fill `span` with `gap` between them. */
const halvingFill = (span: number, count: number, gap: number) => {
  const series = 2 - 2 ** (1 - count); // 1 + 1/2 + … + 1/2^(count-1)
  const first = (span - (count - 1) * gap) / series;
  return Array.from({ length: count }, (_, i) => first / 2 ** i);
};

/**
 * The ratio q > 1 for which base/q + base/q² + … + base/qⁿ equals target
 * (bisection). Targets outside the bracket clamp; guard() catches the result.
 */
const solveRatio = (base: number, count: number, target: number) => {
  const sum = (q: number) => {
    let total = 0;
    for (let k = 1; k <= count; k++) total += base / q ** k;
    return total;
  };
  let lo = 1.0001;
  let hi = 10;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (sum(mid) > target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
};

/** Centres shapes of the given heights on the band's midline. */
const centerOn = (bandHeight: number, shapes: BandShape[], heights: number[]): BandShape[] =>
  shapes.map((shape, i) => ({ ...shape, height: heights[i], y: (bandHeight - heights[i]) / 2 }));

const classicPlan = (grid: Grid): BannerPlan => ({ shapes: classicLayout(grid.w), snapLines: [0, grid.w] });

/**
 * Falls back to today's banner if a plan is not a clean left-to-right row or
 * misses a line it claims to lock. Only reachable through extreme URL overrides.
 */
const guard = (grid: Grid, plan: BannerPlan): BannerPlan => {
  const { shapes, snapLines } = plan;
  const clean = shapes.every((shape, i) => {
    const prev = shapes[i - 1];
    return (
      shape.width > 0 &&
      shape.x >= -EPS &&
      shape.x + shape.width <= grid.w + EPS &&
      (!prev || shape.x >= prev.x + prev.width - EPS)
    );
  });
  const edges = shapes.flatMap((shape) => [shape.x, shape.x + shape.width]);
  const locked = snapLines.every((line) => edges.some((edge) => Math.abs(edge - line) < EPS));
  return clean && locked ? plan : classicPlan(grid);
};

const width = ([left, right]: [number, number]) => right - left;

// ============================================================================
// A. COLUMN SNAP
// ============================================================================

/**
 * The halving tail fills the last card and the yellow is the card before it;
 * the pill runs from the margin to the card before that (card 1 on desktop).
 * With two cards (tablet) the pill and yellow form a 2:1 pair ending on card 1.
 */
const columnSnapPlan = (grid: Grid): BannerPlan => {
  const { cards, cardGap: g, w } = grid;
  const n = cards.length;
  if (!grid.hasColumns || n < 2) return classicPlan(grid);

  const last = cards[n - 1];
  const tail = row(last[0], halvingFill(width(last), 4, g), g);

  if (n === 2) {
    const yellow = (cards[0][1] - g) / 3;
    return guard(grid, {
      shapes: [...row(0, [2 * yellow, yellow], g), ...tail],
      snapLines: [0, cards[0][1], last[0], w],
    });
  }

  const yellow = cards[n - 2];
  return guard(grid, {
    shapes: [{ x: 0, width: cards[n - 3][1] }, { x: yellow[0], width: width(yellow) }, ...tail],
    snapLines: [0, cards[n - 3][1], ...yellow, last[0], w],
  });
};

const columnSnap: GridBannerOption = {
  id: 'column-snap',
  name: 'A. Column Snap',
  pitch:
    'Today’s banner, cut where the project cards are cut. The pill ends on Seekr’s right edge, the yellow is exactly the Verizon column, and the halving tail fills the adidas column. Every gap is the 20px card gutter.',
  locks: 'Left margin, card 1 right, both edges of card 2, card 3 left, right margin.',
  plan: columnSnapPlan,
};

// ============================================================================
// B. CIRCLE MODULE
// ============================================================================

/** Column Snap with every shape as tall as the yellow is wide, so the yellow is a true circle. */
const circleModule: GridBannerOption = {
  id: 'circle-module',
  name: 'B. Circle Module',
  pitch:
    'Column Snap, locked vertically too. Every shape is exactly one card tall, so the yellow is a perfect circle the size of the Verizon thumbnail, and the pill’s end cap is card 1’s inscribed circle, touching the content line.',
  locks: 'Same as Column Snap, plus shape height = card width (the yellow is a circle at every width).',
  plan: (grid, band) => {
    const { shapes, snapLines } = columnSnapPlan(grid);
    const height = Math.min(shapes[1].width, band.height);
    return { shapes: centerOn(band.height, shapes, shapes.map(() => height)), snapLines };
  },
};

// ============================================================================
// C. THRESHOLD
// ============================================================================

const THRESHOLD_COLORS = ['#FAA16E', '#FAC26E', '#65C1CE', '#C76CDB', '#838383', '#B2B1B1', '#E0DEDE'];

const thresholdPlan = (grid: Grid): BannerPlan => {
  const { cards, contentStart: L, cardGap: g, w } = grid;
  let plan: BannerPlan;

  const yellow = cards[0][1] - L - g;
  // The yellow-closes-card-1 rule needs card 1 narrower than the pill, true for the real grid.
  if (grid.breakpoint === 'desktop' && cards.length >= 2 && yellow < L) {
    // Pill stops on L, yellow closes card 1, the rest fall by one ratio from card 2 to the margin.
    const tailStart = cards[1][0];
    const q = solveRatio(yellow, 5, w - tailStart - 4 * g);
    plan = {
      shapes: [{ x: 0, width: L }, { x: L + g, width: yellow }, ...row(tailStart, [1, 2, 3, 4, 5].map((k) => yellow / q ** k), g)],
      snapLines: [0, L, cards[0][1], tailStart, w],
    };
  } else if (grid.hasColumns) {
    // Pill stops on L, then six capsules fall by one ratio to the margin.
    const r = solveRatio(L, 6, w - L - g - 5 * g);
    plan = {
      shapes: [{ x: 0, width: L }, ...row(L + g, [1, 2, 3, 4, 5, 6].map((k) => L / r ** k), g)],
      snapLines: [0, L, w],
    };
  } else {
    // Phone: the 1160px desktop layout, scaled down.
    const k = w / 1160;
    plan = {
      shapes: thresholdPlan(getGrid(1160)).shapes.map((shape) => ({ x: shape.x * k, width: shape.width * k })),
      snapLines: [0, w],
    };
  }

  const guarded = guard(grid, plan);
  return guarded === plan
    ? { ...plan, shapes: plan.shapes.map((shape, i) => ({ ...shape, fill: THRESHOLD_COLORS[i] })) }
    : guarded;
};

const threshold: GridBannerOption = {
  id: 'threshold',
  name: 'C. Threshold',
  pitch:
    'The pill stops exactly on your content line (412px on the page at 1200), where the intro and the cards begin. The yellow closes card 1, the teal opens card 2, and from the yellow on each capsule is about 0.7 of the last, all the way to the right margin.',
  locks: 'Left margin, content line (pill end), card 1 right, card 2 left, right margin.',
  plan: thresholdPlan,
};

// ============================================================================
// D. INDENT
// ============================================================================

const indent: GridBannerOption = {
  id: 'indent',
  name: 'D. Indent',
  pitch:
    'Today’s banner with every ratio untouched, scaled to sit between the content line and the right margin. The left column stays empty, like the Projects and Bio rows below. The first gap lands on the middle card’s centre axis.',
  locks: 'Content line (pill start), right margin. Tablet: the pill is exactly card 1, the tail exactly card 2.',
  plan: (grid, band) => {
    const { cards, contentStart: L, w } = grid;
    if (!grid.hasColumns) return classicPlan(grid);

    let plan: BannerPlan;
    let k: number;
    if (grid.breakpoint === 'tablet' && cards.length === 2) {
      // Pill exactly fills card 1; the tail, scaled to match, exactly fills card 2.
      const [first, second] = cards;
      k = width(first) / CLASSIC_UNITS[0][1];
      const tailOrigin = CLASSIC_UNITS[1][0];
      plan = {
        shapes: [
          { x: L, width: width(first) },
          ...CLASSIC_UNITS.slice(1).map(([x, w0]) => ({ x: second[0] + (x - tailOrigin) * k, width: w0 * k })),
        ],
        snapLines: [L, first[1], second[0], w],
      };
    } else {
      k = (w - L) / 1440;
      plan = { shapes: CLASSIC_UNITS.map(([x, w0]) => ({ x: L + x * k, width: w0 * k })), snapLines: [L, w] };
    }

    const guarded = guard(grid, plan);
    if (guarded !== plan) return guarded;
    return { ...plan, shapes: centerOn(band.height, plan.shapes, plan.shapes.map(() => Math.min(380 * k, band.height))) };
  },
};

// ============================================================================
// E. TRANSPOSE
// ============================================================================

const transpose: GridBannerOption = {
  id: 'transpose',
  name: 'E. Transpose',
  pitch:
    'The idea turned 90°. Each grid column gets one capsule, so every edge is a grid line, and the fall moves into height: a full-height near-circle in the name column, then one capsule over each project card, each exactly half as tall.',
  locks: 'Every edge: margins, label column, content line and every card edge.',
  plan: (grid, band) => {
    const H = band.height;
    const { columnEnd: C, w } = grid;

    if (!grid.hasColumns) {
      const g = (20 / 1440) * w;
      const p = (w - H - 3 * g) / 3;
      const shapes = [{ x: 0, width: H }, ...row(H + g, [p, p, p], g)];
      return guard(grid, { shapes: centerOn(H, shapes, [H, H / 2, H / 4, H / 8]), snapLines: [0, w] });
    }

    const shapes = [{ x: 0, width: C }, ...grid.cards.map(([left, right]) => ({ x: left, width: right - left }))];
    return guard(grid, { shapes: centerOn(H, shapes, shapes.map((_, i) => H / 2 ** i)), snapLines: grid.lines });
  },
};

// ============================================================================
// REGISTRY
// ============================================================================

/** The live banner, run through the grid pipeline. Should match /#/embed exactly. */
const classic: GridBannerOption = {
  id: 'classic',
  name: 'Current',
  pitch: 'Today’s banner, unchanged, for comparison.',
  locks: 'Left and right margins only.',
  plan: classicPlan,
};

export const GRID_BANNER_OPTIONS: GridBannerOption[] = [columnSnap, circleModule, threshold, indent, transpose, classic];

export const getGridBannerOption = (id: string | undefined): GridBannerOption =>
  GRID_BANNER_OPTIONS.find((option) => option.id === id) ?? classic;
