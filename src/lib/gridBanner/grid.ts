/**
 * The portfolio page grid, expressed in the banner iframe's own coordinates.
 *
 * The Framer page places the banner iframe between its 20px page margins, so
 * x = 0 and x = w (the iframe width) are the left and right margins. Everything
 * else was measured on gregorybauwens.com:
 *
 *   desktop  (viewport >= 1200, w = 1160..1400)  label column 27%, gutter 79, 3 cards / 20px gaps
 *   tablet   (viewport 810..1199, w = 770..1159) label column 35%, gutter 40, 2 cards / 16px gaps
 *   phone    (viewport < 810)                    single column, margins only
 *
 * Every value can be overridden from the embed URL (see gridConfigFromSearch)
 * so the banner can follow the Framer grid without a redeploy.
 *
 * Framer picks its breakpoint from the viewport, which includes a classic
 * (non-overlay) scrollbar, while the iframe width excludes it. Pass the
 * scrollbar width to getGrid so both agree on Windows and on Macs set to
 * always show scroll bars.
 */

export type Breakpoint = 'desktop' | 'tablet' | 'phone';

export interface ColumnSpec {
  /** Label column width as a fraction of w ("Projects", "Bio", the name). */
  split: number;
  /** Fixed gap between the label column and the content column. */
  gutter: number;
  /** Number of project-card columns in the content column. */
  cards: number;
  /** Gap between project cards. */
  cardGap: number;
}

export interface GridConfig {
  /** Smallest iframe width (plus scrollbar) that uses the desktop grid. */
  desktopMinWidth: number;
  /** Smallest iframe width (plus scrollbar) that uses the tablet grid. */
  tabletMinWidth: number;
  desktop: ColumnSpec;
  tablet: ColumnSpec;
}

export const DEFAULT_GRID: GridConfig = {
  desktopMinWidth: 1160,
  tabletMinWidth: 770,
  desktop: { split: 0.27, gutter: 79, cards: 3, cardGap: 20 },
  tablet: { split: 0.35, gutter: 40, cards: 2, cardGap: 16 },
};

/** Height of the banner iframe on each Framer breakpoint. */
export const FRAMER_IFRAME_HEIGHT: Record<Breakpoint, number> = { desktop: 435, tablet: 364, phone: 216 };

export interface Grid {
  w: number;
  breakpoint: Breakpoint;
  /** False on phone, where the page is a single column. */
  hasColumns: boolean;
  /** Right edge of the label column (C). 0 on phone. */
  columnEnd: number;
  /** Left edge of the content column (L): intro text, cards, bio. 0 on phone. */
  contentStart: number;
  gutter: number;
  cardGap: number;
  /** Project card columns as [left, right]. One full-width column on phone. */
  cards: Array<[number, number]>;
  /** Every vertical grid line, sorted and de-duplicated. */
  lines: number[];
}

const singleColumn = (w: number, config: GridConfig): Grid => ({
  w,
  breakpoint: 'phone',
  hasColumns: false,
  columnEnd: 0,
  contentStart: 0,
  gutter: 0,
  cardGap: config.tablet.cardGap,
  cards: [[0, w]],
  lines: [0, w],
});

export const getGrid = (w: number, config: GridConfig = DEFAULT_GRID, scrollbar = 0): Grid => {
  const viewportWidth = w + scrollbar;
  const breakpoint: Breakpoint =
    viewportWidth >= config.desktopMinWidth ? 'desktop' : viewportWidth >= config.tabletMinWidth ? 'tablet' : 'phone';
  if (breakpoint === 'phone') return singleColumn(w, config);

  const spec = config[breakpoint];
  const columnEnd = spec.split * w;
  const contentStart = columnEnd + spec.gutter;
  const count = Math.max(1, Math.round(spec.cards));
  const cardWidth = (w - contentStart - (count - 1) * spec.cardGap) / count;
  // An override that leaves no room for the cards degrades to the phone layout.
  if (cardWidth < 1) return singleColumn(w, config);
  const cards = Array.from({ length: count }, (_, i): [number, number] => {
    const left = contentStart + i * (cardWidth + spec.cardGap);
    // Pin the last card to w so float error never leaves a hairline.
    return [left, i === count - 1 ? w : left + cardWidth];
  });

  const lines = [0, columnEnd, contentStart, ...cards.flat(), w]
    .sort((a, b) => a - b)
    .filter((x, i, all) => i === 0 || x - all[i - 1] > 0.01);

  return {
    w,
    breakpoint,
    hasColumns: true,
    columnEnd,
    contentStart,
    gutter: spec.gutter,
    cardGap: spec.cardGap,
    cards,
    lines,
  };
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const readNumber = (params: URLSearchParams, key: string, fallback: number, min: number, max: number) => {
  const raw = params.get(key);
  if (raw === null || raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? clamp(value, min, max) : fallback;
};

/** Accepts 0.27 or 27 (percent) and keeps the label column under 60% of the width. */
const readSplit = (params: URLSearchParams, key: string, fallback: number) => {
  const value = readNumber(params, key, fallback, 0, 100);
  return clamp(value >= 1 ? value / 100 : value, 0, 0.6);
};

/** `prefix` is '' for the desktop keys (split, gutter…) and 't' for tablet (tsplit, tgutter…). */
const readSpec = (params: URLSearchParams, prefix: '' | 't', base: ColumnSpec): ColumnSpec => ({
  split: readSplit(params, `${prefix}split`, base.split),
  gutter: readNumber(params, `${prefix}gutter`, base.gutter, 0, 200),
  cards: Math.round(readNumber(params, `${prefix}cards`, base.cards, 1, 6)),
  cardGap: readNumber(params, `${prefix}cardGap`, base.cardGap, 0, 80),
});

/**
 * URL overrides, all optional and clamped to sane ranges:
 *   split, gutter, cards, cardGap        desktop grid (split as 0.27 or 27; cards 1-6)
 *   tsplit, tgutter, tcards, tcardGap    tablet grid
 *   desktopMin, tabletMin                breakpoint widths, in iframe px
 */
export const gridConfigFromSearch = (params: URLSearchParams, base: GridConfig = DEFAULT_GRID): GridConfig => ({
  desktopMinWidth: readNumber(params, 'desktopMin', base.desktopMinWidth, 0, 4000),
  tabletMinWidth: readNumber(params, 'tabletMin', base.tabletMinWidth, 0, 4000),
  desktop: readSpec(params, '', base.desktop),
  tablet: readSpec(params, 't', base.tablet),
});

/** Width of a classic scrollbar on this system; 0 where scrollbars overlay content. */
export const measureScrollbarWidth = () => {
  if (typeof document === 'undefined') return 0;
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;top:-9999px;width:100px;height:100px;overflow:scroll;';
  document.body.appendChild(probe);
  const width = probe.offsetWidth - probe.clientWidth;
  probe.remove();
  return width;
};
