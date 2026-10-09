/**
 * Turns grid-aligned shapes (in iframe px) into SVG markup for
 * InteractiveHeroBanner.
 *
 * The viewBox stays a fixed 1440 units wide, like the original banner, so the
 * shatter physics (gravity, wall bounds, piece sizes) feel identical. Only
 * where the shapes sit inside it changes with the iframe width.
 */

import type { Grid } from './grid';

export const VIEWBOX_WIDTH = 1440;
/** The banner band is as tall as the original 1440x380 artwork, scaled to the width. */
export const BAND_RATIO = 380 / 1440;

/** The Grape Mist III ramp the live embed uses, left to right. */
export const PALETTE = ['#FAA16E', '#FAC26E', '#65C1CE', '#C76CDB', '#838383', '#E0DEDE'];

export interface BandShape {
  /** Left edge in iframe px. */
  x: number;
  /** Width in iframe px. */
  width: number;
  /** Top edge in px inside the band. Defaults to 0. */
  y?: number;
  /** Height in px. Defaults to the full band height. */
  height?: number;
  /** Defaults to the palette colour at this shape's position in the row. */
  fill?: string;
}

export interface BannerPlan {
  shapes: BandShape[];
  /** Grid lines some shape edge lands on exactly. Checked in tests, highlighted in the guides. */
  snapLines: number[];
}

export interface GridBannerOption {
  id: string;
  name: string;
  pitch: string;
  /** Which edges this option pins to grid lines, in plain words. */
  locks: string;
  plan: (grid: Grid, band: { height: number }) => BannerPlan;
}

const round = (value: number) => Math.round(value * 1000) / 1000;

export const bandHeightFor = (w: number) => w * BAND_RATIO;

export const planFor = (option: GridBannerOption, grid: Grid) => option.plan(grid, { height: bandHeightFor(grid.w) });

export const composeBannerSvg = (option: GridBannerOption, grid: Grid): string => {
  const bandHeight = bandHeightFor(grid.w);
  const { shapes } = planFor(option, grid);
  const scale = VIEWBOX_WIDTH / grid.w;
  const viewBoxHeight = round(VIEWBOX_WIDTH * BAND_RATIO);

  const rects = shapes
    .map((shape, i) => {
      const x = round(shape.x * scale);
      const y = round((shape.y ?? 0) * scale);
      const width = round(shape.width * scale);
      const height = round((shape.height ?? bandHeight) * scale);
      const radius = round(Math.min(width, height) / 2);
      const fill = shape.fill ?? PALETTE[i % PALETTE.length];
      return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" ry="${radius}" fill="${fill}"/>`;
    })
    .join('');

  return `<svg viewBox="0 0 ${VIEWBOX_WIDTH} ${viewBoxHeight}" fill="none" xmlns="http://www.w3.org/2000/svg">${rects}</svg>`;
};

/** The live banner's composition (1440-unit layout) scaled to w. Used as a phone fallback. */
export const CLASSIC_UNITS: Array<[number, number]> = [
  [0, 710],
  [730, 345],
  [1095, 152],
  [1267, 76],
  [1363, 38],
  [1421, 19],
];

export const classicLayout = (w: number): BandShape[] =>
  CLASSIC_UNITS.map(([x, width]) => ({ x: (x / VIEWBOX_WIDTH) * w, width: (width / VIEWBOX_WIDTH) * w }));
