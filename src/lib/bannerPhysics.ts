/**
 * Shared physics, color, and utility functions for interactive banner components.
 * Extracted from InteractiveHeroBanner to be reused by InteractiveTypeBanner.
 */

import { converter, formatHex } from 'culori';

// ============================================================================
// TYPES
// ============================================================================
export interface Shape {
  id: string;
  type: 'rect' | 'circle' | 'ellipse' | 'path' | 'polygon' | 'polyline' | 'line' | 'text';
  element: string;
  attrs: Record<string, string>;
  centroid: { x: number; y: number };
  bounds: { x: number; y: number; width: number; height: number };
  fill?: string;
  stroke?: string;
  opacity?: number;
  parentId?: string;
  generation?: number;
}

export interface ViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ShardFragment {
  id: string;
  shape: Shape;
  originalShape: Shape;
  offsetX: number;
  offsetY: number;
  rotation: number;
  vx: number;
  vy: number;
  vr: number;
  generation: number;
  spawnTime: number;
  spawnDelayMs: number;
  isExploding: boolean;
}

export interface PresetState {
  clickPoint: { x: number; y: number } | null;
  clickTime: number;
  shardFragments: ShardFragment[];
  shatteredShapeIds: Set<string>;
  isReturning: boolean;
  returnStartTime: number;
  returnMode: 'grid' | 'original';
  reorgPhase: 'none' | 'float' | 'settle' | 'reset';
  lastClickTime: number;
  lastExplosionTime: number;
  cachedGridTargets: { col: number; row: number }[] | null;
}

export interface ShapeTransform {
  x: number;
  y: number;
  scale: number;
  rotate: number;
  opacity: number;
  filterStrength: number;
  brightness: number;
}

export interface Controls {
  hoverStrength: number;
  hoverRadius: number;
  clickStrength: number;
  spring: number;
  damping: number;
  timeScale: number;
  shardSpread: number;
  settleTime: number;
  floatStrength: number;
  floatDrag: number;
  floatDurationMs: number;
  returnSpring: number;
  settleDamping: number;
  explosionForce: number;
  explosionSpin: number;
  explosionDurationMs: number;
  fractureStaggerMsMax: number;
  wallRestitution: number;
  wallFriction: number;
  wallSpinDamping: number;
  disableWalls?: boolean;
  disableReorg: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================
export const LOCKED_REORG_FLOAT_STRENGTH = 0.9;
export const LOCKED_REORG_FLOAT_DRAG = 0.6;
export const WALL_PADDING = 12;
export const MAX_TOTAL_FRAGMENTS = 320;
export const BURST_WINDOW_S = 0.6;
export const MAX_BURST_CLICKS = 9;
export const LOAD_FRAGMENT_THRESHOLD = 180;
export const LOAD_DT_THRESHOLD = 0.02;
export const LOAD_RECOVERY_THRESHOLD = 0.018;

export const DEFAULT_COLOR_STOPS = [
  "#ECB300",
  "#EB9F00",
  "#EF8A00",
  "#EB7800",
  "#E56100",
  "#E74C00",
];

export const DEFAULT_CONTROLS: Controls = {
  hoverStrength: 1.2,
  hoverRadius: 0.23,
  clickStrength: 1,
  spring: 1.2,
  damping: 1.5,
  timeScale: 1,
  shardSpread: 0.6,
  settleTime: 1.9,
  floatStrength: LOCKED_REORG_FLOAT_STRENGTH,
  floatDrag: LOCKED_REORG_FLOAT_DRAG,
  floatDurationMs: 200,
  returnSpring: 1.1,
  settleDamping: 2.0,
  explosionForce: 1.8,
  explosionSpin: 2.2,
  explosionDurationMs: 1300,
  fractureStaggerMsMax: 80,
  wallRestitution: 0.7,
  wallFriction: 0.2,
  wallSpinDamping: 0.1,
  disableReorg: 0,
};

// ============================================================================
// MATH UTILITIES
// ============================================================================
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
export const smoothstep = (t: number) => t * t * (3 - 2 * t);
export const distance = (x1: number, y1: number, x2: number, y2: number) =>
  Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);

export const seededRandom = (seed: number) => {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};

export const noise2D = (x: number, y: number, seed: number = 0) => {
  const n = seededRandom(x * 1.1 + y * 2.3 + seed);
  const m = seededRandom(x * 3.7 + y * 1.9 + seed + 100);
  return (n + m) / 2 - 0.5;
};

// ============================================================================
// COLOR UTILITIES
// ============================================================================
export const toHsv = converter('hsv');
export const hsvToHex = (color: { h?: number; s?: number; v?: number }) =>
  formatHex({ mode: 'hsv', h: color.h ?? 0, s: color.s ?? 0, v: color.v ?? 0 });

export const interpolateHue = (a: number, b: number, t: number) => {
  const delta = ((b - a + 540) % 360) - 180;
  return (a + delta * t + 360) % 360;
};

export const getPaletteColor = (t: number, stops: string[]) => {
  if (stops.length === 0) return '#ECB300';
  if (stops.length === 1) return stops[0];
  const scaled = clamp(t, 0, 1) * (stops.length - 1);
  const index = Math.floor(scaled);
  const localT = scaled - index;
  const a = toHsv(stops[index]) ?? { h: 0, s: 0, v: 0 };
  const b = toHsv(stops[Math.min(index + 1, stops.length - 1)]) ?? { h: 0, s: 0, v: 0 };
  const h = interpolateHue(a.h ?? 0, b.h ?? 0, localT);
  const s = lerp(a.s ?? 0, b.s ?? 0, localT);
  const v = lerp(a.v ?? 0, b.v ?? 0, localT);
  return hsvToHex({ h, s, v });
};

export const applyFillToShape = (shape: Shape, color: string): Shape => {
  const updatedElement = shape.element.includes('fill=')
    ? shape.element.replace(/fill="[^"]*"/, `fill="${color}"`)
    : shape.element.replace(/<([^\s>]+)/, `<$1 fill="${color}"`);
  return {
    ...shape,
    fill: color,
    attrs: { ...shape.attrs, fill: color },
    element: updatedElement,
  };
};

// ============================================================================
// PHYSICS UTILITIES
// ============================================================================
export const constrainToBounds = (
  shape: { bounds: { x: number; y: number; width: number; height: number } },
  offsetX: number,
  offsetY: number,
  scale: number,
  viewBox: { x: number; y: number; width: number; height: number },
  padding: number = 0
): { x: number; y: number } => {
  const bounds = shape.bounds;
  const scaledWidth = bounds.width * scale;
  const scaledHeight = bounds.height * scale;

  const newLeft = bounds.x + offsetX + (bounds.width - scaledWidth) / 2;
  const newRight = newLeft + scaledWidth;
  const newTop = bounds.y + offsetY + (bounds.height - scaledHeight) / 2;
  const newBottom = newTop + scaledHeight;

  const containerLeft = viewBox.x + padding;
  const containerRight = viewBox.x + viewBox.width - padding;
  const containerTop = viewBox.y + padding;
  const containerBottom = viewBox.y + viewBox.height - padding;

  let constrainedX = offsetX;
  let constrainedY = offsetY;

  if (newLeft < containerLeft) {
    const overshoot = containerLeft - newLeft;
    constrainedX = offsetX + overshoot + overshoot * 0.2;
  } else if (newRight > containerRight) {
    const overshoot = newRight - containerRight;
    constrainedX = offsetX - overshoot - overshoot * 0.2;
  }

  if (newTop < containerTop) {
    const overshoot = containerTop - newTop;
    constrainedY = offsetY + overshoot + overshoot * 0.2;
  } else if (newBottom > containerBottom) {
    const overshoot = newBottom - containerBottom;
    constrainedY = offsetY - overshoot - overshoot * 0.2;
  }

  return { x: constrainedX, y: constrainedY };
};

export const bounceWithinBounds = (
  shape: { bounds: { x: number; y: number; width: number; height: number } },
  offsetX: number,
  offsetY: number,
  vx: number,
  vy: number,
  vr: number,
  viewBox: { x: number; y: number; width: number; height: number },
  padding: number = 0,
  restitution: number = 0.9,
  friction: number = 0.1,
  spinDamping: number = 0.1
): { x: number; y: number; vx: number; vy: number; vr: number } => {
  const bounds = shape.bounds;
  const scaledWidth = bounds.width;
  const scaledHeight = bounds.height;

  let x = offsetX;
  let y = offsetY;
  let nextVx = vx;
  let nextVy = vy;
  let nextVr = vr;

  const newLeft = bounds.x + x;
  const newRight = newLeft + scaledWidth;
  const newTop = bounds.y + y;
  const newBottom = newTop + scaledHeight;

  const containerLeft = viewBox.x + padding;
  const containerRight = viewBox.x + viewBox.width - padding;
  const containerTop = viewBox.y + padding;
  const containerBottom = viewBox.y + viewBox.height - padding;

  if (newLeft < containerLeft) {
    x += containerLeft - newLeft;
    nextVx = Math.abs(nextVx) * restitution;
    nextVy *= Math.max(0, 1 - friction);
    nextVr *= Math.max(0, 1 - spinDamping);
  } else if (newRight > containerRight) {
    x -= newRight - containerRight;
    nextVx = -Math.abs(nextVx) * restitution;
    nextVy *= Math.max(0, 1 - friction);
    nextVr *= Math.max(0, 1 - spinDamping);
  }

  if (newTop < containerTop) {
    y += containerTop - newTop;
    nextVy = Math.abs(nextVy) * restitution;
    nextVx *= Math.max(0, 1 - friction);
    nextVr *= Math.max(0, 1 - spinDamping);
  } else if (newBottom > containerBottom) {
    y -= newBottom - containerBottom;
    nextVy = -Math.abs(nextVy) * restitution;
    nextVx *= Math.max(0, 1 - friction);
    nextVr *= Math.max(0, 1 - spinDamping);
  }

  return { x, y, vx: nextVx, vy: nextVy, vr: nextVr };
};

// ============================================================================
// FRAGMENT CREATION
// ============================================================================
export const createFragmentsFromShape = (
  shape: Shape,
  clickPoint: { x: number; y: number },
  viewBox: ViewBox,
  controls: Controls,
  generation: number,
  currentTime: number,
  shatterScale: number,
  overrideFragmentCount?: number
): ShardFragment[] => {
  const bounds = shape.bounds;
  const fragments: ShardFragment[] = [];
  const shapeArea = bounds.width * bounds.height;
  const viewBoxArea = viewBox.width * viewBox.height;
  const areaRatio = viewBoxArea > 0 ? shapeArea / viewBoxArea : 0;
  const sizeMultiplier = 1 + Math.min(areaRatio * 10, 2);
  const baseCount = Math.round(2 + Math.random() * 2 * sizeMultiplier);
  const scaledCount = Math.round(baseCount * shatterScale);
  const firstClickBonus = generation === 1 && areaRatio > 0.1 ? 2 : 0;
  const fragmentCount = overrideFragmentCount ?? Math.max(2, Math.min(scaledCount + firstClickBonus, 10));

  const createSegmentSizes = (total: number, count: number, seed: number) => {
    const weights = Array.from({ length: count }, (_, idx) => {
      const r = seededRandom(seed * 11 + idx * 17);
      return 0.25 + r ** 1.8;
    });
    const bigIndex = Math.floor(seededRandom(seed * 13) * count);
    weights[bigIndex] += 1.2;
    const sum = weights.reduce((acc, v) => acc + v, 0);
    const sizes = weights.map((w) => (w / sum) * total);
    const minSize = total * 0.08;
    let totalShort = 0;
    sizes.forEach((size, idx) => {
      if (size < minSize) {
        totalShort += minSize - size;
        sizes[idx] = minSize;
      }
    });
    if (totalShort > 0) {
      let remaining = totalShort;
      const order = sizes
        .map((size, idx) => ({ size, idx }))
        .sort((a, b) => b.size - a.size);
      order.forEach(({ idx }) => {
        if (remaining <= 0) return;
        const reducible = Math.max(0, sizes[idx] - minSize);
        const take = Math.min(reducible, remaining);
        sizes[idx] -= take;
        remaining -= take;
      });
    }
    const scale = total / sizes.reduce((acc, v) => acc + v, 0);
    return sizes.map((size) => size * scale);
  };

  const needsGridSplit = (bounds.width / viewBox.width > 0.6) ||
                         (bounds.height / viewBox.height > 0.6);

  let cols: number, rows: number;
  if (needsGridSplit) {
    const aspect = bounds.width / bounds.height;
    cols = Math.max(1, Math.round(Math.sqrt(fragmentCount * aspect)));
    rows = Math.max(1, Math.ceil(fragmentCount / cols));
    while (cols * rows < fragmentCount) cols++;
  } else {
    const isHorizontalShape = bounds.width > bounds.height;
    cols = isHorizontalShape ? fragmentCount : 1;
    rows = isHorizontalShape ? 1 : fragmentCount;
  }

  const seedBase = Date.now() * 0.001 + fragmentCount;
  const colSizes = createSegmentSizes(bounds.width, cols, seedBase);
  const rowSizes = createSegmentSizes(bounds.height, rows, seedBase + 99);

  let fragIndex = 0;
  let cursorY = bounds.y;
  for (let r = 0; r < rows; r++) {
    let cursorX = bounds.x;
    for (let c = 0; c < cols; c++) {
      if (fragIndex >= fragmentCount) break;

      const fragBounds = {
        x: cursorX,
        y: cursorY,
        width: colSizes[c],
        height: rowSizes[r],
      };
      cursorX += colSizes[c];

      const seed = Date.now() + fragIndex * 1000 + Math.random() * 1000;

      const jitterX = (seededRandom(seed) - 0.5) * fragBounds.width * 0.1;
      const jitterY = (seededRandom(seed * 2) - 0.5) * fragBounds.height * 0.1;

      const fragCentroid = {
        x: fragBounds.x + fragBounds.width / 2 + jitterX,
        y: fragBounds.y + fragBounds.height / 2 + jitterY,
      };

      const clickX = clickPoint.x * viewBox.width;
      const clickY = clickPoint.y * viewBox.height;
      const angleFromClick = Math.atan2(
        fragCentroid.y - clickY,
        fragCentroid.x - clickX
      );

      const angleVariation = (seededRandom(seed * 3) - 0.5) * 1.2;
      const finalAngle = angleFromClick + angleVariation;

      const baseSpeed = controls.explosionForce * 0.75;
      const speedVariation = 0.7 + seededRandom(seed * 4) * 1.0;
      const speed = baseSpeed * speedVariation * controls.shardSpread * shatterScale;

      const distFromClick = distance(fragCentroid.x / viewBox.width, fragCentroid.y / viewBox.height, clickPoint.x, clickPoint.y);
      const impulse = Math.max(0.8, 2.0 - distFromClick * 2.5) * (0.75 + shatterScale * 0.25);

      const fragArea = Math.max(1, fragBounds.width * fragBounds.height);
      const refArea = Math.max(1, bounds.width * bounds.height / fragmentCount);
      const massFactor = clamp(Math.sqrt(refArea / fragArea), 0.6, 1.5);

      const rx = parseFloat(shape.attrs.rx || '0');
      const ry = parseFloat(shape.attrs.ry || rx.toString());
      const scaledRx = Math.min(rx, fragBounds.width / 2, fragBounds.height / 2);
      const scaledRy = Math.min(ry, fragBounds.width / 2, fragBounds.height / 2);

      const fragElement = `<rect x="${fragBounds.x}" y="${fragBounds.y}" width="${fragBounds.width}" height="${fragBounds.height}" rx="${scaledRx}" ry="${scaledRy}" fill="${shape.fill || '#ECB300'}"/>`;

      const fragShape: Shape = {
        id: `frag-${shape.id}-${generation}-${fragIndex}-${Date.now()}`,
        type: 'rect',
        element: fragElement,
        attrs: {
          x: fragBounds.x.toString(),
          y: fragBounds.y.toString(),
          width: fragBounds.width.toString(),
          height: fragBounds.height.toString(),
          rx: scaledRx.toString(),
          ry: scaledRy.toString(),
          fill: shape.fill || '#ECB300',
        },
        centroid: fragCentroid,
        bounds: fragBounds,
        fill: shape.fill,
        parentId: shape.id,
        generation,
      };

      const explosionVx = Math.cos(finalAngle) * speed * impulse * viewBox.width * 0.5 * massFactor;
      const explosionVy = Math.sin(finalAngle) * speed * impulse * viewBox.height * 0.8 * massFactor;

      const spinDirection = seededRandom(seed * 5) > 0.5 ? 1 : -1;
      const spinMagnitude = controls.explosionSpin * 150 * (0.5 + seededRandom(seed * 6) * 0.5);
      const explosionVr = spinDirection * spinMagnitude * impulse * clamp(1 / massFactor, 0.7, 1.4);

      const staggerBase = Math.max(0, controls.fractureStaggerMsMax);
      const staggerNoise = seededRandom(seed * 9) * 0.35;
      const staggerMs = staggerBase > 0
        ? staggerBase * (0.25 + 0.75 * distFromClick) * (0.9 + staggerNoise)
        : 0;

      fragments.push({
        id: fragShape.id,
        shape: fragShape,
        originalShape: shape.parentId ? shape : shape,
        offsetX: 0,
        offsetY: 0,
        rotation: 0,
        vx: explosionVx,
        vy: explosionVy,
        vr: explosionVr,
        generation,
        spawnTime: currentTime,
        spawnDelayMs: staggerMs,
        isExploding: true,
      });

      fragIndex++;
    }
    cursorY += rowSizes[r];
  }

  return fragments;
};

// ============================================================================
// STATE FACTORY
// ============================================================================
export const createInitialState = (): PresetState => ({
  clickPoint: null,
  clickTime: 0,
  shardFragments: [],
  shatteredShapeIds: new Set(),
  isReturning: false,
  returnStartTime: 0,
  returnMode: 'grid',
  reorgPhase: 'none',
  lastClickTime: 0,
  lastExplosionTime: 0,
  cachedGridTargets: null,
});
