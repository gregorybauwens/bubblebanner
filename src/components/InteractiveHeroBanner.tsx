/**
 * InteractiveHeroBanner
 * 
 * A production-ready interactive SVG banner with 4 physics-based presets.
 * 
 * HOW TO USE:
 * 1. Replace STARTER_SVG below with your SVG markup, OR
 * 2. Pass svgMarkup prop: <InteractiveHeroBanner svgMarkup={yourSvgString} />
 * 
 * HOW TO ADD MORE PRESETS:
 * 1. Add new preset key to PresetKey type
 * 2. Add preset config to PRESETS object with initClick, update, shapeTransform functions
 * 3. Add preset-specific controls to the control panel
 */

import React, { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { converter, formatHex } from 'culori';

// Memoized SVG inner element to avoid re-parsing dangerouslySetInnerHTML on every render
const ShapeElement = memo(({ html }: { html: string }) => (
  <g dangerouslySetInnerHTML={{ __html: html }} />
));

// ============================================================================
// PASTE YOUR SVG MARKUP HERE (or pass via svgMarkup prop)
// ============================================================================
const STARTER_SVG = `<svg width="1312" height="312" viewBox="0 0 1312 312" fill="none" xmlns="http://www.w3.org/2000/svg">
<rect width="648" height="312" rx="140" fill="#ECB300"/>
<rect x="664" width="315" height="312" rx="120" fill="#EB9F00"/>
<rect x="995" width="149" height="312" rx="70" fill="#EF8A00"/>
<rect x="1160" width="64" height="312" rx="32" fill="#EB7800"/>
<rect x="1240" width="34" height="312" rx="17" fill="#E56100"/>
<rect x="1290" width="22" height="312" rx="11" fill="#E74C00"/>
</svg>`;

export const DEFAULT_COLOR_STOPS = [
  "#ECB300",
  "#EB9F00",
  "#EF8A00",
  "#EB7800",
  "#E56100",
  "#E74C00",
];

// ============================================================================
// TYPES
// ============================================================================
interface Shape {
  id: string;
  type: 'rect' | 'circle' | 'ellipse' | 'path' | 'polygon' | 'polyline' | 'line';
  element: string; // Original SVG element as string
  attrs: Record<string, string>;
  centroid: { x: number; y: number };
  bounds: { x: number; y: number; width: number; height: number };
  fill?: string;
  stroke?: string;
  opacity?: number;
  // For fragmented shapes
  parentId?: string;
  generation?: number;
}

interface ViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

type PresetKey = 'voronoi';

// Fragment tracks each piece after shattering

// Fragment tracks each piece after shattering
interface ShardFragment {
  id: string;
  shape: Shape; // The actual shape data for this fragment
  originalShape: Shape; // Reference to the original parent shape
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


interface PresetState {
  clickPoint: { x: number; y: number } | null;
  clickTime: number;
  // Voronoi shatter state - fragments replace original shapes
  shardFragments: ShardFragment[];
  shatteredShapeIds: Set<string>; // Track which original shapes have been shattered
  isReturning: boolean;
  returnStartTime: number;
  returnMode: 'grid' | 'original';
  reorgPhase: 'none' | 'float' | 'settle' | 'reset';
  lastClickTime: number;
  lastExplosionTime: number;
  cachedGridTargets: { col: number; row: number }[] | null;
}

interface ShapeTransform {
  x: number;
  y: number;
  scale: number;
  rotate: number;
  opacity: number;
  filterStrength: number;
  brightness: number;
}

interface Controls {
  hoverStrength: number;
  hoverRadius: number;
  clickStrength: number;
  spring: number;
  damping: number;
  timeScale: number;
  // Voronoi specific
  shardSpread: number;
  settleTime: number; // Delay after last shatter before returning
  floatStrength: number; // Gentle pull toward grid targets
  floatDrag: number; // Drag during float phase
  floatDurationMs: number; // Duration of float phase before settle
  returnSpring: number;
  settleDamping: number; // Higher = less bouncy, quicker settle
  // Explosion controls
  explosionForce: number; // How hard fragments explode outward
  explosionSpin: number; // How much fragments rotate on explosion
  explosionDurationMs: number; // Time in explosion phase after spawn
  fractureStaggerMsMax: number; // Max micro-stagger delay for fracture
  // Wall interaction controls
  wallRestitution: number; // Energy retained on bounce
  wallFriction: number; // Tangential damping on collision
  wallSpinDamping: number; // Spin damping on impact
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const smoothstep = (t: number) => t * t * (3 - 2 * t);
const toHsv = converter('hsv');
const hsvToHex = (color: { h?: number; s?: number; v?: number }) =>
  formatHex({ mode: 'hsv', h: color.h ?? 0, s: color.s ?? 0, v: color.v ?? 0 });

const interpolateHue = (a: number, b: number, t: number) => {
  const delta = ((b - a + 540) % 360) - 180;
  return (a + delta * t + 360) % 360;
};

const getPaletteColor = (t: number, stops: string[]) => {
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

const applyFillToShape = (shape: Shape, color: string): Shape => {
  const updatedElement = shape.element.includes('fill=')
    ? shape.element.replace(/fill="[^"]*"/, `fill="${color}"`)
    : shape.element.replace(/<([^\\s>]+)/, `<$1 fill="${color}"`);
  return {
    ...shape,
    fill: color,
    attrs: { ...shape.attrs, fill: color },
    element: updatedElement,
  };
};
const BURST_WINDOW_S = 0.6;
const MAX_BURST_CLICKS = 9;
const MAX_TOTAL_FRAGMENTS = 320;
const MAX_TOTAL_CRACK_LINES = 180;
const LOAD_FRAGMENT_THRESHOLD = 180;
const LOAD_DT_THRESHOLD = 0.02;
const LOAD_RECOVERY_THRESHOLD = 0.018;
const SHOW_LOAD_INDICATOR = false;
const CONTROLS_STORAGE_KEY = 'bubblebanner.controls.v3';

// Locked controls (Reorg)
const LOCKED_REORG_FLOAT_STRENGTH = 0.9;
const LOCKED_REORG_FLOAT_DRAG = 0.6;
const WALL_PADDING = 12;

const DEFAULT_CONTROLS: Controls = {
  hoverStrength: 1.2,
  hoverRadius: 0.2,
  clickStrength: 1,
  spring: 1.2,
  damping: 1.5,
  timeScale: 1,
  shardSpread: 1.7,
  settleTime: 1.9,
  floatStrength: LOCKED_REORG_FLOAT_STRENGTH,
  floatDrag: LOCKED_REORG_FLOAT_DRAG,
  floatDurationMs: 200,
  returnSpring: 1.1,
  settleDamping: 2.0,
  explosionForce: 2.4,
  explosionSpin: 2.2,
  explosionDurationMs: 1300,
  fractureStaggerMsMax: 20,
  wallRestitution: 0.7,
  wallFriction: 0.2,
  wallSpinDamping: 0.1,
};
const distance = (x1: number, y1: number, x2: number, y2: number) =>
  Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);

// Simple seeded random for deterministic behavior
const seededRandom = (seed: number) => {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};

// Simplex-like noise approximation
const noise2D = (x: number, y: number, seed: number = 0) => {
  const n = seededRandom(x * 1.1 + y * 2.3 + seed);
  const m = seededRandom(x * 3.7 + y * 1.9 + seed + 100);
  return (n + m) / 2 - 0.5;
};

// Constrain transform to keep shape within viewBox boundaries
// Returns adjusted x, y offsets that respect container bounds
const constrainToBounds = (
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
  
  // Calculate where the shape would be after transform
  const newLeft = bounds.x + offsetX + (bounds.width - scaledWidth) / 2;
  const newRight = newLeft + scaledWidth;
  const newTop = bounds.y + offsetY + (bounds.height - scaledHeight) / 2;
  const newBottom = newTop + scaledHeight;
  
  // Container bounds
  const containerLeft = viewBox.x + padding;
  const containerRight = viewBox.x + viewBox.width - padding;
  const containerTop = viewBox.y + padding;
  const containerBottom = viewBox.y + viewBox.height - padding;
  
  let constrainedX = offsetX;
  let constrainedY = offsetY;
  
  // Constrain horizontally with bounce-back effect
  if (newLeft < containerLeft) {
    const overshoot = containerLeft - newLeft;
    constrainedX = offsetX + overshoot + overshoot * 0.2; // Slight bounce
  } else if (newRight > containerRight) {
    const overshoot = newRight - containerRight;
    constrainedX = offsetX - overshoot - overshoot * 0.2;
  }
  
  // Constrain vertically with bounce-back effect
  if (newTop < containerTop) {
    const overshoot = containerTop - newTop;
    constrainedY = offsetY + overshoot + overshoot * 0.2;
  } else if (newBottom > containerBottom) {
    const overshoot = newBottom - containerBottom;
    constrainedY = offsetY - overshoot - overshoot * 0.2;
  }
  
  return { x: constrainedX, y: constrainedY };
};

const bounceWithinBounds = (
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
// SVG PARSER
// ============================================================================
const parseSVG = (svgMarkup: string): { shapes: Shape[]; viewBox: ViewBox } => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgMarkup, 'image/svg+xml');
  const svg = doc.querySelector('svg');
  
  if (!svg) {
    return { shapes: [], viewBox: { x: 0, y: 0, width: 1312, height: 312 } };
  }

  // Parse viewBox
  const viewBoxAttr = svg.getAttribute('viewBox');
  let viewBox: ViewBox = { x: 0, y: 0, width: 1312, height: 312 };
  if (viewBoxAttr) {
    const parts = viewBoxAttr.split(/\s+/).map(Number);
    if (parts.length === 4) {
      viewBox = { x: parts[0], y: parts[1], width: parts[2], height: parts[3] };
    }
  } else {
    const w = svg.getAttribute('width');
    const h = svg.getAttribute('height');
    if (w && h) {
      viewBox.width = parseFloat(w);
      viewBox.height = parseFloat(h);
    }
  }

  const shapes: Shape[] = [];
  const shapeTypes = ['rect', 'circle', 'ellipse', 'path', 'polygon', 'polyline', 'line'];
  
  let shapeId = 0;
  shapeTypes.forEach(type => {
    svg.querySelectorAll(type).forEach((el) => {
      const attrs: Record<string, string> = {};
      for (const attr of Array.from(el.attributes)) {
        attrs[attr.name] = attr.value;
      }
      
      // Calculate bounds and centroid
      const bounds = calculateBounds(type, attrs);
      const centroid = {
        x: bounds.x + bounds.width / 2,
        y: bounds.y + bounds.height / 2,
      };

      shapes.push({
        id: `shape-${shapeId++}`,
        type: type as Shape['type'],
        element: el.outerHTML,
        attrs,
        centroid,
        bounds,
        fill: attrs.fill,
        stroke: attrs.stroke,
        opacity: attrs.opacity ? parseFloat(attrs.opacity) : 1,
      });
    });
  });

  return { shapes, viewBox };
};
const calculateBounds = (type: string, attrs: Record<string, string>) => {
  switch (type) {
    case 'rect':
      return {
        x: parseFloat(attrs.x || '0'),
        y: parseFloat(attrs.y || '0'),
        width: parseFloat(attrs.width || '0'),
        height: parseFloat(attrs.height || '0'),
      };
    case 'circle': {
      const cx = parseFloat(attrs.cx || '0');
      const cy = parseFloat(attrs.cy || '0');
      const r = parseFloat(attrs.r || '0');
      return { x: cx - r, y: cy - r, width: r * 2, height: r * 2 };
    }
    case 'ellipse': {
      const cx = parseFloat(attrs.cx || '0');
      const cy = parseFloat(attrs.cy || '0');
      const rx = parseFloat(attrs.rx || '0');
      const ry = parseFloat(attrs.ry || '0');
      return { x: cx - rx, y: cy - ry, width: rx * 2, height: ry * 2 };
    }
    default:
      return { x: 0, y: 0, width: 100, height: 100 };
  }
};

// ============================================================================
// FRAGMENT CREATION - Creates child shapes from a parent
// ============================================================================
const createFragmentsFromShape = (
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
  const sizeMultiplier = 1 + Math.min(areaRatio * 10, 2); // 1x to 3x
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

  // Determine if 2D grid splitting is needed (shape too large relative to viewBox)
  const needsGridSplit = (bounds.width / viewBox.width > 0.6) ||
                         (bounds.height / viewBox.height > 0.6);

  let cols: number, rows: number;
  if (needsGridSplit) {
    // Distribute fragment count into a grid proportional to shape aspect ratio
    const aspect = bounds.width / bounds.height;
    cols = Math.max(1, Math.round(Math.sqrt(fragmentCount * aspect)));
    rows = Math.max(1, Math.ceil(fragmentCount / cols));
    // Ensure we have enough cells
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

      // Add some randomness to the slice
      const jitterX = (seededRandom(seed) - 0.5) * fragBounds.width * 0.1;
      const jitterY = (seededRandom(seed * 2) - 0.5) * fragBounds.height * 0.1;

      const fragCentroid = {
        x: fragBounds.x + fragBounds.width / 2 + jitterX,
        y: fragBounds.y + fragBounds.height / 2 + jitterY,
      };

      // Calculate explosion direction from click point
      const clickX = clickPoint.x * viewBox.width;
      const clickY = clickPoint.y * viewBox.height;
      const angleFromClick = Math.atan2(
        fragCentroid.y - clickY,
        fragCentroid.x - clickX
      );

      // Add some spread - wider angle variation for more chaotic explosion
      const angleVariation = (seededRandom(seed * 3) - 0.5) * 1.2;
      const finalAngle = angleFromClick + angleVariation;

      // Explosion force calculation - much more intense burst
      const baseSpeed = controls.explosionForce * 0.75;
      const speedVariation = 0.7 + seededRandom(seed * 4) * 1.0; // More variation
      const speed = baseSpeed * speedVariation * controls.shardSpread * shatterScale;

      // Distance-based impulse - closer = stronger explosion
      const distFromClick = distance(fragCentroid.x / viewBox.width, fragCentroid.y / viewBox.height, clickPoint.x, clickPoint.y);
      const impulse = Math.max(0.8, 2.0 - distFromClick * 2.5) * (0.75 + shatterScale * 0.25); // Higher base impulse

      const fragArea = Math.max(1, fragBounds.width * fragBounds.height);
      const refArea = Math.max(1, bounds.width * bounds.height / fragmentCount);
      const massFactor = clamp(Math.sqrt(refArea / fragArea), 0.6, 1.5);

      // Create SVG element for the fragment (clipped rect)
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

      // Calculate powerful initial velocity - dramatic burst effect
      const explosionVx = Math.cos(finalAngle) * speed * impulse * viewBox.width * 0.5 * massFactor;
      const explosionVy = Math.sin(finalAngle) * speed * impulse * viewBox.height * 0.8 * massFactor;

      // Spin based on explosion direction and control setting
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
        originalShape: shape.parentId ? shape : shape, // Keep reference to root shape
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
// PRESET ENGINE
// ============================================================================
const createInitialState = (): PresetState => ({
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

const PRESETS: Record<PresetKey, {
  name: string;
  description: string;
  initClick: (state: PresetState, point: { x: number; y: number }, controls: Controls, shapes?: Shape[], viewBox?: ViewBox, clickedShapeId?: string | null) => PresetState;
  update: (state: PresetState, dt: number, pointer: { x: number; y: number } | null, controls: Controls, shapes: Shape[], viewBox: ViewBox) => PresetState;
  shapeTransform: (shape: Shape, state: PresetState, pointer: { x: number; y: number } | null, controls: Controls, viewBox: ViewBox) => ShapeTransform;
}> = {
  // -------------------------------------------------------------------------
  // VORONOI SHATTER
  // Click on a shape to shatter it into pieces. Click pieces to shatter further.
  // After a delay, all pieces spring back together.
  // -------------------------------------------------------------------------
  voronoi: {
    name: 'Voronoi Shatter',
    description: 'Click shapes to shatter them into pieces',
    initClick: (state, point, controls, _shapes, viewBox, clickedShapeId) => {
      // This is handled specially in the component - see handleVoronoiClick
      return { 
        ...state, 
        clickPoint: point, 
        clickTime: state.clickTime, // Don't reset
        lastClickTime: state.clickTime,
      };
    },
    update: (state, dt, _pointer, controls, shapes, viewBox) => {
      const newClickTime = state.clickTime + dt;
      const settleDelay = controls.settleTime; // Delay after last click before returning
      
      // Check if we should start settling (no clicks for a while)
      const timeSinceLastClick = newClickTime - state.lastClickTime;
      const shouldStartSettling = timeSinceLastClick > settleDelay &&
                                  state.shardFragments.length > 0 &&
                                  !state.isReturning;

      let nextReorgPhase = state.reorgPhase;
      let nextReturnStartTime = state.returnStartTime;
      if (shouldStartSettling) {
        nextReorgPhase = 'float';
        nextReturnStartTime = newClickTime;
      } else if (!state.isReturning) {
        nextReorgPhase = 'none';
      } else if (state.returnMode === 'grid' && state.reorgPhase === 'float') {
        const floatElapsed = newClickTime - state.returnStartTime;
        if (floatElapsed * 1000 >= controls.floatDurationMs) {
          nextReorgPhase = 'settle';
          nextReturnStartTime = newClickTime;
        }
      }
      
      let newState = { 
        ...state, 
        clickTime: newClickTime,
        isReturning: state.isReturning || shouldStartSettling,
        returnStartTime: nextReturnStartTime,
        returnMode: shouldStartSettling ? 'grid' : state.returnMode,
        reorgPhase: nextReorgPhase,
      };
      
      // Calculate grid dimensions (needed every frame for target-to-pixel conversion)
      const gutter = 16;
      const fragmentCount = state.shardFragments.length;
      const cols = Math.ceil(Math.sqrt(fragmentCount * (viewBox.width / viewBox.height)));
      const rows = Math.ceil(fragmentCount / cols);
      const cellWidth = (viewBox.width - gutter * (cols + 1)) / cols;
      const cellHeight = (viewBox.height - gutter * (rows + 1)) / rows;
      
      // Cache grid target assignments — compute once when entering return phase,
      // then reuse on subsequent frames to prevent target flip-flopping / twitching
      let finalTargets = newState.cachedGridTargets;
      if (!finalTargets || shouldStartSettling) {
        // Assign each fragment to nearest grid cell based on current position
        const fragmentGridTargets: { col: number; row: number }[] = [];
        
        state.shardFragments.forEach((frag, index) => {
          const currentX = frag.shape.centroid.x + frag.offsetX;
          const currentY = frag.shape.centroid.y + frag.offsetY;
          
          let bestCol = Math.round((currentX - gutter - cellWidth / 2) / (cellWidth + gutter));
          let bestRow = Math.round((currentY - gutter - cellHeight / 2) / (cellHeight + gutter));
          
          bestCol = Math.max(0, Math.min(cols - 1, bestCol));
          bestRow = Math.max(0, Math.min(rows - 1, bestRow));
          
          fragmentGridTargets[index] = { col: bestCol, row: bestRow };
        });
        
        // Resolve conflicts - if multiple fragments want the same cell, use spiral search
        const occupiedCells = new Set<string>();
        const computedTargets: { col: number; row: number }[] = [];
        
        fragmentGridTargets.forEach((target, index) => {
          const { col, row } = target;
          const key = `${col},${row}`;
          
          if (!occupiedCells.has(key)) {
            occupiedCells.add(key);
            computedTargets[index] = { col, row };
          } else {
            let found = false;
            for (let radius = 1; radius < Math.max(cols, rows) && !found; radius++) {
              for (let dc = -radius; dc <= radius && !found; dc++) {
                for (let dr = -radius; dr <= radius && !found; dr++) {
                  if (Math.abs(dc) !== radius && Math.abs(dr) !== radius) continue;
                  const newCol = col + dc;
                  const newRow = row + dr;
                  if (newCol >= 0 && newCol < cols && newRow >= 0 && newRow < rows) {
                    const newKey = `${newCol},${newRow}`;
                    if (!occupiedCells.has(newKey)) {
                      occupiedCells.add(newKey);
                      computedTargets[index] = { col: newCol, row: newRow };
                      found = true;
                    }
                  }
                }
              }
            }
            if (!found) {
              computedTargets[index] = { col, row };
            }
          }
        });
        
        finalTargets = computedTargets;
        newState = { ...newState, cachedGridTargets: computedTargets };
      }
      
      // Update fragment physics
      const updatedFragments = state.shardFragments.map((frag, index) => {
        const rawElapsed = newClickTime - frag.spawnTime;
        const delaySec = (frag.spawnDelayMs ?? 0) / 1000;
        if (rawElapsed < delaySec) {
          return { ...frag, isExploding: false };
        }
        const explosionElapsed = rawElapsed - delaySec;
        const isExplodingNow = explosionElapsed * 1000 < controls.explosionDurationMs;
        if (newState.isReturning) {
          const targetX = newState.returnMode === 'original' ? 0 : (() => {
          const { col, row } = finalTargets[index] || { col: 0, row: 0 };
          const targetCenterX = gutter + col * (cellWidth + gutter) + cellWidth / 2;
            return targetCenterX - frag.shape.centroid.x;
          })();
          const targetY = newState.returnMode === 'original' ? 0 : (() => {
            const { col, row } = finalTargets[index] || { col: 0, row: 0 };
          const targetCenterY = gutter + row * (cellHeight + gutter) + cellHeight / 2;
            return targetCenterY - frag.shape.centroid.y;
          })();
          
          const diffX = targetX - frag.offsetX;
          const diffY = targetY - frag.offsetY;

          let newVx = frag.vx;
          let newVy = frag.vy;
          let newVr = frag.vr;

          if (newState.returnMode === 'grid' && newState.reorgPhase === 'float') {
            const floatDrag = Math.max(0, 1 - controls.floatDrag * dt);
            newVx = frag.vx * floatDrag + diffX * controls.floatStrength * dt * 60;
            newVy = frag.vy * floatDrag + diffY * controls.floatStrength * dt * 60;
            newVr = frag.vr * floatDrag;
          } else {
            // Spring towards target (grid or original position)
            const returnElapsed = Math.max(0, newClickTime - state.returnStartTime);
            const returnEase = smoothstep(clamp(returnElapsed / 0.6, 0, 1));
            const springForce = controls.returnSpring * 6 * returnEase;
            // settleDamping: 0 = very bouncy (0.95), 1 = critically damped (0.7), 2 = overdamped (0.5)
            const damping = Math.max(0.5, 0.95 - controls.settleDamping * 0.225);
            newVx = frag.vx * damping + diffX * springForce * dt * 60;
            newVy = frag.vy * damping + diffY * springForce * dt * 60;
            newVr = frag.vr * damping - frag.rotation * springForce * dt * 30;
          }
          
          // Check if fragment has settled (close to target with low velocity)
          // Use generous thresholds because spring can oscillate significantly
          const speed = Math.hypot(newVx, newVy);
          const distToTarget = Math.hypot(diffX, diffY);
          const isSettled = newState.returnMode === 'grid' && 
                           newState.reorgPhase === 'settle' && 
                           distToTarget < 80 && 
                           speed < 400;
          
          if (isSettled) {
            // Snap to target and zero velocities
            return {
              ...frag,
              vx: 0,
              vy: 0,
              vr: 0,
              offsetX: targetX,
              offsetY: targetY,
              rotation: 0,
              isExploding: false,
            };
          }

          const nextOffsetX = frag.offsetX + newVx * dt;
          const nextOffsetY = frag.offsetY + newVy * dt;
          const bounced = bounceWithinBounds(
            frag.shape,
            nextOffsetX,
            nextOffsetY,
            newVx,
            newVy,
            newVr,
            viewBox,
            WALL_PADDING,
            controls.wallRestitution,
            controls.wallFriction,
            controls.wallSpinDamping
          );
          return {
            ...frag,
            vx: bounced.vx,
            vy: bounced.vy,
            vr: bounced.vr,
            offsetX: bounced.x,
            offsetY: bounced.y,
            rotation: frag.rotation + newVr * dt,
            isExploding: isExplodingNow,
          };
        } else if (isExplodingNow) {
          // Explosion phase with damping
          const damping = 0.97;
          const nextOffsetX = frag.offsetX + frag.vx * dt;
          const nextOffsetY = frag.offsetY + frag.vy * dt;
          const nextVx = frag.vx * damping;
          const nextVy = frag.vy * damping;
          const nextVr = frag.vr * damping;
          const bounced = bounceWithinBounds(
            frag.shape,
            nextOffsetX,
            nextOffsetY,
            nextVx,
            nextVy,
            nextVr,
            viewBox,
            WALL_PADDING,
            controls.wallRestitution,
            controls.wallFriction,
            controls.wallSpinDamping
          );
          return {
            ...frag,
            vx: bounced.vx,
            vy: bounced.vy,
            vr: bounced.vr,
            offsetX: bounced.x,
            offsetY: bounced.y,
            rotation: frag.rotation + frag.vr * dt,
            isExploding: isExplodingNow,
          };
        }
        return {
          ...frag,
          isExploding: isExplodingNow,
        };
      });
      
      // No automatic reset - fragments stay on grid until reset button is pressed
      
      const hasExploding = updatedFragments.some(frag => frag.isExploding);
      const returnElapsed = Math.max(0, newClickTime - state.returnStartTime);
      const isResetting = state.returnMode === 'original';
      const shouldFinalizeReset = isResetting && updatedFragments.length > 0 &&
        (returnElapsed > 1 || updatedFragments.every(frag => {
          const speed = Math.hypot(frag.vx, frag.vy) + Math.abs(frag.vr);
          return Math.abs(frag.offsetX) < 0.5 && Math.abs(frag.offsetY) < 0.5 && speed < 5;
        }));
      
      newState.shardFragments = updatedFragments;
      newState.lastExplosionTime = hasExploding ? newClickTime : state.lastExplosionTime;
      if (isResetting && !newState.isReturning) {
        newState.isReturning = true;
      }
      if (shouldFinalizeReset) {
        newState = {
          ...newState,
          shardFragments: [],
          shatteredShapeIds: new Set(),
          isReturning: false,
          returnStartTime: 0,
          returnMode: 'grid',
          reorgPhase: 'none',
          cachedGridTargets: null,
        };
      }
      return newState;
    },
    shapeTransform: (shape, state, pointer, controls, viewBox) => {
      let x = 0;
      let y = 0;
      const scale = 1;
      const rotate = 0;
      const opacity = 1;

      // Hover parallax - only when pointer is present
      if (pointer) {
        const shapeNormX = shape.centroid.x / viewBox.width;
        const shapeNormY = shape.centroid.y / viewBox.height;
        const hoverDist = distance(shapeNormX, shapeNormY, pointer.x, pointer.y);
        const hoverInfluence = Math.max(0, 1 - hoverDist / controls.hoverRadius) * controls.hoverStrength;
        x += (pointer.x - shapeNormX) * hoverInfluence * viewBox.width * 0.25;
        y += (pointer.y - shapeNormY) * hoverInfluence * viewBox.height * 0.25;
      }

      const constrained = constrainToBounds(shape, x, y, scale, viewBox);

      return { 
        x: constrained.x, 
        y: constrained.y, 
        scale, 
        rotate, 
        opacity, 
        filterStrength: 0, 
        brightness: 1 
      };
    },
  },
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================
interface ControlPanelProps {
  activePreset: PresetKey;
  controls: Controls;
  updateControl: (key: keyof Controls, value: number) => void;
  onReset: () => void;
  isPaused: boolean;
  setIsPaused: (paused: boolean) => void;
}

interface InteractiveHeroBannerProps {
  svgMarkup?: string;
  className?: string;
  renderControls?: (props: ControlPanelProps) => React.ReactNode;
  colorStops?: string[];
  onFirstInteraction?: () => void;
  onResetComplete?: () => void;
  initialControls?: Partial<Controls>;
  persistControls?: boolean;
}

const InteractiveHeroBanner: React.FC<InteractiveHeroBannerProps> = ({
  svgMarkup = STARTER_SVG,
  className = '',
  renderControls,
  colorStops,
  onFirstInteraction,
  onResetComplete,
  initialControls,
  persistControls = true,
}) => {
  const prefersReducedMotion = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const [activePreset] = useState<PresetKey>('voronoi');
  const [isPaused, setIsPaused] = useState(false);
  const clickBurstRef = useRef<number[]>([]);
  const hasInteractedRef = useRef(false);
  const resetInFlightRef = useRef(false);
  
  // Parse SVG
  const { shapes, viewBox } = useMemo(() => {
    const parsed = parseSVG(svgMarkup);
    const stops = colorStops && colorStops.length > 0 ? colorStops : DEFAULT_COLOR_STOPS;
    if (svgMarkup === STARTER_SVG && parsed.shapes.length > 0) {
      // Map stops -> shapes left-to-right (discrete), so each stop reliably affects a shape.
      // This avoids "dead" stops when using continuous interpolation and the shape count is small.
      const ordered = parsed.shapes
        .slice()
        .sort((a, b) => a.centroid.x - b.centroid.x);
      const n = ordered.length;
      const k = Math.max(1, stops.length);
      const coloredShapes = ordered.map((shape, i) => {
        const stopIndex =
          n === 1 ? 0 : Math.round((i * (k - 1)) / (n - 1));
        const color = stops[Math.min(k - 1, Math.max(0, stopIndex))] ?? stops[0];
        return applyFillToShape(shape, color);
      });
      return { shapes: coloredShapes, viewBox: parsed.viewBox };
    }
    return parsed;
  }, [svgMarkup, colorStops]);
  // Controls state
  const [controls, setControls] = useState<Controls>(() => {
    const baseControls: Controls = {
      ...DEFAULT_CONTROLS,
      ...(initialControls ?? {}),
      // Locked controls (cannot be overridden by props / presets)
      floatStrength: LOCKED_REORG_FLOAT_STRENGTH,
      floatDrag: LOCKED_REORG_FLOAT_DRAG,
    };
    if (!persistControls) return baseControls;
    if (typeof window === 'undefined') return baseControls;
    try {
      const saved = window.localStorage.getItem(CONTROLS_STORAGE_KEY);
      if (!saved) return baseControls;
      const parsed = JSON.parse(saved) as Partial<Controls>;
      return {
        ...baseControls,
        ...parsed,
        // Locked controls (cannot be overridden by localStorage)
        floatStrength: LOCKED_REORG_FLOAT_STRENGTH,
        floatDrag: LOCKED_REORG_FLOAT_DRAG,
      };
    } catch {
      return baseControls;
    }
  });

  // Animation state
  const [presetState, setPresetState] = useState<PresetState>(createInitialState());
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const [isUnderLoad, setIsUnderLoad] = useState(false);
  
  const lastTimeRef = useRef<number>(0);
  const animationRef = useRef<number>();
  const avgDtRef = useRef<number>(0.016);
  const presetStateRef = useRef<PresetState>(presetState);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const smoothPointerRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    presetStateRef.current = presetState;
  }, [presetState]);

  useEffect(() => {
    pointerRef.current = pointer;
  }, [pointer]);

  const effectiveControls = useMemo(() => {
    if (!isUnderLoad) return controls;
    return {
      ...controls,
      hoverStrength: 0,
      hoverRadius: 0.0001,
    };
  }, [controls, isUnderLoad]);

  const getBurstMetrics = (now: number, includeNow: boolean) => {
    const recent = clickBurstRef.current.filter((t) => now - t <= BURST_WINDOW_S);
    if (includeNow) recent.push(now);
    clickBurstRef.current = recent;
    const burstClicks = Math.min(recent.length, MAX_BURST_CLICKS);
    const burstFactor = clamp(1 + Math.max(0, burstClicks - 1) * 0.425, 1, 3.825);
    const cursorScale = clamp(1 + (burstFactor - 1) * 0.35, 1, 1.3);
    return { burstFactor, cursorScale };
  };

  const getPressureFactor = (event: React.PointerEvent | null) => {
    if (!event || event.pointerType === 'mouse') return 1;
    if (typeof event.pressure !== 'number' || event.pressure <= 0) return 1;
    return clamp(0.85 + event.pressure * 0.75, 0.85, 1.6);
  };

  // Pointer handlers
  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setPointer({
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    });
  }, []);

  const handlePointerLeave = useCallback(() => {
    setPointer(null);
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (!hasInteractedRef.current) {
      hasInteractedRef.current = true;
      onFirstInteraction?.();
    }
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const clientX = e.clientX;
    const clientY = e.clientY;
    const point = {
      x: (clientX - rect.left) / rect.width,
      y: (clientY - rect.top) / rect.height,
    };

    const now = performance.now() / 1000;
    const { burstFactor, cursorScale } = getBurstMetrics(now, true);
    const pressureFactor = getPressureFactor(e);
    const shatterScale = clamp(burstFactor * pressureFactor, 0.85, 2.4);

    if (presetState.returnMode === 'original') {
      return;
    }
    
    // Convert to viewBox coordinates for hit testing
    const clickX = point.x * viewBox.width;
    const clickY = point.y * viewBox.height;
    
    // Cursor radius in viewBox coordinates (50px cursor, scaled to viewBox)
    // Oversized hit area to err on the side of interaction (58px total).
    const cursorRadiusPx = 29 * cursorScale; // 58px click area
    const cursorRadiusX = (cursorRadiusPx / rect.width) * viewBox.width;
    const cursorRadiusY = (cursorRadiusPx / rect.height) * viewBox.height;
    const cursorRadius = Math.max(cursorRadiusX, cursorRadiusY);
    
    // Special handling for voronoi preset - detect which shape was clicked
    if (activePreset === 'voronoi') {
      // Get all clickable shapes in render order (shapes first, fragments on top)
      const clickableShapes: Shape[] = [];
      
      // Add original shapes that haven't been shattered
      shapes.forEach(shape => {
        if (!presetState.shatteredShapeIds.has(shape.id)) {
          const transform = shapeTransforms.get(shape.id);
          const offsetX = transform?.x ?? 0;
          const offsetY = transform?.y ?? 0;
          clickableShapes.push({
            ...shape,
            bounds: {
              x: shape.bounds.x + offsetX,
              y: shape.bounds.y + offsetY,
              width: shape.bounds.width,
              height: shape.bounds.height,
            },
            centroid: {
              x: shape.centroid.x + offsetX,
              y: shape.centroid.y + offsetY,
            },
          });
        }
      });

      // Add fragments (rendered last, so on top)
      const hitSmoothedPtr = smoothPointerRef.current;
      presetState.shardFragments.forEach(frag => {
        let hoverX = 0;
        let hoverY = 0;
        if (hitSmoothedPtr && !isUnderLoad) {
          const fragNormX = (frag.shape.centroid.x + frag.offsetX) / viewBox.width;
          const fragNormY = (frag.shape.centroid.y + frag.offsetY) / viewBox.height;
          const hoverDist = distance(fragNormX, fragNormY, hitSmoothedPtr.x, hitSmoothedPtr.y);
          const hoverInfluence = Math.max(0, 1 - hoverDist / effectiveControls.hoverRadius) * effectiveControls.hoverStrength;
          hoverX = (hitSmoothedPtr.x - fragNormX) * hoverInfluence * viewBox.width * 0.25;
          hoverY = (hitSmoothedPtr.y - fragNormY) * hoverInfluence * viewBox.height * 0.25;
        }

        const adjustedBounds = {
          x: frag.shape.bounds.x + frag.offsetX + hoverX,
          y: frag.shape.bounds.y + frag.offsetY + hoverY,
          width: frag.shape.bounds.width,
          height: frag.shape.bounds.height,
        };
        clickableShapes.push({
          ...frag.shape,
          bounds: adjustedBounds,
          centroid: {
            x: frag.shape.centroid.x + frag.offsetX + hoverX,
            y: frag.shape.centroid.y + frag.offsetY + hoverY,
          },
        });
      });
      
      // Find all shapes within the cursor radius (topmost last)
      const hitShapes: Shape[] = [];
      for (let i = clickableShapes.length - 1; i >= 0; i -= 1) {
        const shape = clickableShapes[i];
        const b = shape.bounds;
        // Check if cursor circle overlaps with shape rectangle
        // Find closest point on rectangle to cursor center
        const closestX = clamp(clickX, b.x, b.x + b.width);
        const closestY = clamp(clickY, b.y, b.y + b.height);
        const dist = distance(clickX, clickY, closestX, closestY);
        
        if (dist <= cursorRadius) {
          hitShapes.push(shape);
        }
      }
      
      if (hitShapes.length > 0) {
        const maxHitShapes = isUnderLoad ? 2 : 4;
        const limitedHitShapes = hitShapes.slice(0, maxHitShapes);
        const fragmentsToRemove = new Set<string>();
        let combinedNewFragments: ShardFragment[] = [];
        const newShatteredIds = new Set(presetState.shatteredShapeIds);
        const loadScale = clamp(1 - presetState.shardFragments.length / MAX_TOTAL_FRAGMENTS, 0.35, 1);
        const effectiveShatterScale = shatterScale * loadScale * (isUnderLoad ? 0.7 : 1);

        limitedHitShapes.forEach((hitShape) => {
          const isFragment = hitShape.id.startsWith('frag-');
        let fragmentToRemove: ShardFragment | null = null;
        
        if (isFragment) {
            fragmentToRemove = presetState.shardFragments.find(f => f.shape.id === hitShape.id) || null;
            if (!fragmentToRemove) return;
          } else {
            newShatteredIds.add(hitShape.id);
        }
        
        const generation = isFragment && fragmentToRemove ? fragmentToRemove.generation + 1 : 1;
        const newFragments = createFragmentsFromShape(
          hitShape,
          point,
          viewBox,
          controls,
          generation,
          presetState.clickTime,
          effectiveShatterScale
        );
        
          if (fragmentToRemove) {
            fragmentsToRemove.add(fragmentToRemove.id);
          }
          combinedNewFragments = combinedNewFragments.concat(newFragments);
        });

        setPresetState(prev => {
          const updatedFragments = fragmentsToRemove.size
            ? prev.shardFragments.filter(f => !fragmentsToRemove.has(f.id))
            : prev.shardFragments;

          let nextFragments = [...updatedFragments, ...combinedNewFragments];
          if (nextFragments.length > MAX_TOTAL_FRAGMENTS) {
            nextFragments = nextFragments
              .slice()
              .sort((a, b) => b.spawnTime - a.spawnTime)
              .slice(0, MAX_TOTAL_FRAGMENTS);
          }
          
          return {
            ...prev,
            shardFragments: nextFragments,
            shatteredShapeIds: newShatteredIds,
            clickPoint: point,
            lastClickTime: prev.clickTime,
            lastExplosionTime: prev.clickTime,
            isReturning: false,
            reorgPhase: 'none',
            cachedGridTargets: null,
          };
        });
        return;
      }
    }
    
    // Default click handling for other presets
    const preset = PRESETS[activePreset];
    setPresetState(prev => preset.initClick(prev, point, controls, shapes, viewBox, null));
  }, [activePreset, controls, shapes, viewBox, presetState]);

  const handleReset = useCallback(() => {
    setPresetState(prev => {
      if (prev.returnMode === 'original' && prev.isReturning) {
        return prev;
      }
      if (prev.shardFragments.length === 0) {
        resetInFlightRef.current = true;
        return createInitialState();
      }

      resetInFlightRef.current = true;
      return {
        ...prev,
        isReturning: true,
        returnStartTime: prev.clickTime,
        returnMode: 'original',
        lastExplosionTime: prev.clickTime,
        lastClickTime: prev.clickTime,
        shatteredShapeIds: new Set(),
        reorgPhase: 'reset',
        cachedGridTargets: null,
      };
    });
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'r') {
        if (event.repeat) {
          return;
        }
        handleReset();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleReset]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.data === 'RESET_BANNER') {
        handleReset();
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [handleReset]);

  useEffect(() => {
    const resetComplete =
      presetState.returnMode === 'grid' &&
      presetState.isReturning === false &&
      presetState.shardFragments.length === 0;
    if (resetInFlightRef.current && resetComplete) {
      resetInFlightRef.current = false;
      hasInteractedRef.current = false;
      onResetComplete?.();
    }
  }, [presetState.returnMode, presetState.isReturning, presetState.shardFragments.length, onResetComplete]);

  // Animation loop - uses refs for pointer to avoid effect restarts on mouse move
  useEffect(() => {
    if (prefersReducedMotion || isPaused) return;

    const animate = (time: number) => {
      const dt = lastTimeRef.current ? Math.min((time - lastTimeRef.current) / 1000, 0.1) : 0.016;
      lastTimeRef.current = time;

      const preset = PRESETS[activePreset];
      
      // Update preset state - use pointerRef to avoid stale closure
      setPresetState(prev => preset.update(prev, dt * controls.timeScale, pointerRef.current, effectiveControls, shapes, viewBox));

      // Smooth the pointer for fragment hover (spring-like feel)
      const currentPointer = pointerRef.current;
      if (currentPointer) {
        if (smoothPointerRef.current) {
          const lerpFactor = 1 - Math.pow(0.001, dt); // ~0.12 at 60fps
          smoothPointerRef.current = {
            x: smoothPointerRef.current.x + (currentPointer.x - smoothPointerRef.current.x) * lerpFactor,
            y: smoothPointerRef.current.y + (currentPointer.y - smoothPointerRef.current.y) * lerpFactor,
          };
        } else {
          smoothPointerRef.current = { ...currentPointer };
        }
      } else {
        smoothPointerRef.current = null;
      }

      const fragmentCount = presetStateRef.current.shardFragments.length;
      avgDtRef.current = avgDtRef.current * 0.9 + dt * 0.1;
      const overload = fragmentCount > LOAD_FRAGMENT_THRESHOLD || avgDtRef.current > LOAD_DT_THRESHOLD;
      const recovered = fragmentCount < LOAD_FRAGMENT_THRESHOLD * 0.8 && avgDtRef.current < LOAD_RECOVERY_THRESHOLD;
      if (!isUnderLoad && overload) {
        setIsUnderLoad(true);
      } else if (isUnderLoad && recovered) {
        setIsUnderLoad(false);
      }
      
      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [activePreset, controls.timeScale, effectiveControls, shapes, prefersReducedMotion, isPaused, isUnderLoad, viewBox]);

  // Calculate transforms - memoized to avoid extra state update cycle
  const shapeTransforms = useMemo(() => {
    const preset = PRESETS[activePreset];
    const transforms = new Map<string, ShapeTransform>();
    shapes.forEach(shape => {
      const transform = preset.shapeTransform(shape, presetState, pointer, effectiveControls, viewBox);
      transforms.set(shape.id, transform);
    });
    return transforms;
  }, [activePreset, presetState, pointer, effectiveControls, shapes, viewBox]);

  // Control updater
  const updateControl = (key: keyof Controls, value: number) => {
    if (key === 'floatStrength' || key === 'floatDrag') return;
    setControls(prev => ({ ...prev, [key]: value }));
  };

  useEffect(() => {
    if (!persistControls) return;
    try {
      window.localStorage.setItem(CONTROLS_STORAGE_KEY, JSON.stringify(controls));
    } catch {
      // Ignore storage failures
    }
  }, [controls, persistControls]);

  const { cursorScale } = getBurstMetrics(performance.now() / 1000, false);
  const cursorSize = Math.round(50 * cursorScale);
  const cursorHotspot = Math.round(cursorSize / 2);
  const cursorSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cursorSize}" height="${cursorSize}" viewBox="0 0 50 50"><circle cx="25" cy="25" r="24" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.4)" stroke-width="1"/></svg>`;
  const customCursor = `url("data:image/svg+xml,${encodeURIComponent(cursorSvg)}") ${cursorHotspot} ${cursorHotspot}, crosshair`;

  const resetProgress = presetState.returnMode === 'original'
    ? clamp((presetState.clickTime - presetState.returnStartTime) / 0.25, 0, 1)
    : 0;

  return (
    <div className={`relative w-full ${className}`} style={{ maxWidth: 1312 }}>
      {/* Main Banner */}
      <div
        ref={containerRef}
        className="relative w-full overflow-hidden rounded-2xl"
        style={{ 
          aspectRatio: `${viewBox.width} / ${viewBox.height}`,
          background: 'transparent',
          cursor: customCursor,
        }}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        onPointerDown={handlePointerDown}
      >
        {/* SVG Container */}
        <svg
          width="100%"
          height="100%"
          viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
          preserveAspectRatio="xMidYMid meet"
          style={{ display: 'block', willChange: 'transform' }}
        >
          {/* Filters for effects */}
          <defs>
            <filter id="displacement-filter" x="-50%" y="-50%" width="200%" height="200%">
              <feTurbulence type="turbulence" baseFrequency="0.02" numOctaves="3" seed="1" result="turbulence" />
              <feDisplacementMap in="SourceGraphic" in2="turbulence" scale="0" xChannelSelector="R" yChannelSelector="G" />
            </filter>
            <filter id="glow-filter" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="4" result="coloredBlur" />
              <feMerge>
                <feMergeNode in="coloredBlur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Render shapes - for voronoi, hide shattered shapes unless resetting */}
          {shapes.map((shape) => {
            // For voronoi preset, hide shapes that have been shattered into fragments
            if (activePreset === 'voronoi' && presetState.shatteredShapeIds.has(shape.id) && presetState.returnMode !== 'original') {
              return null;
            }
            
            const transform = shapeTransforms.get(shape.id) || { x: 0, y: 0, scale: 1, rotate: 0, opacity: 1, filterStrength: 0, brightness: 1 };
            const centerX = shape.centroid.x;
            const centerY = shape.centroid.y;
            
            return (
              <motion.g
                key={shape.id}
                initial={false}
                animate={{
                  x: transform.x,
                  y: transform.y,
                  scale: transform.scale,
                  rotate: transform.rotate,
                  opacity: transform.opacity * (presetState.returnMode === 'original' ? resetProgress : 1),
                }}
                transition={{
                  type: 'spring',
                  stiffness: 300 * controls.spring,
                  damping: 30 * controls.damping,
                }}
                style={{
                  transformOrigin: `${centerX}px ${centerY}px`,
                  filter: transform.brightness !== 1 
                    ? `brightness(${transform.brightness})`
                    : undefined,
                }}
              >
                <ShapeElement html={shape.element} />
              </motion.g>
            );
          })}
          
          {/* Render voronoi fragments with direct SVG transforms (no framer-motion overhead) */}
          {activePreset === 'voronoi' && presetState.shardFragments.map((frag) => {
            const centerX = frag.shape.centroid.x;
            const centerY = frag.shape.centroid.y;
            
            // Calculate hover offset for this fragment (uses smoothed pointer for spring-like feel)
            let hoverX = 0, hoverY = 0;
            const smoothPtr = smoothPointerRef.current;
            if (smoothPtr && !isUnderLoad) {
              const fragNormX = (frag.shape.centroid.x + frag.offsetX) / viewBox.width;
              const fragNormY = (frag.shape.centroid.y + frag.offsetY) / viewBox.height;
              const hoverDist = distance(fragNormX, fragNormY, smoothPtr.x, smoothPtr.y);
              const hoverInfluence = Math.max(0, 1 - hoverDist / effectiveControls.hoverRadius) * effectiveControls.hoverStrength;
              hoverX = (smoothPtr.x - fragNormX) * hoverInfluence * viewBox.width * 0.25;
              hoverY = (smoothPtr.y - fragNormY) * hoverInfluence * viewBox.height * 0.25;
            }
            
            const tx = frag.offsetX + hoverX;
            const ty = frag.offsetY + hoverY;
            const fragOpacity = presetState.returnMode === 'original' ? 1 - resetProgress : 1;
            
            return (
              <g
                key={frag.id}
                transform={`translate(${tx}, ${ty}) rotate(${frag.rotation}, ${centerX}, ${centerY})`}
                opacity={fragOpacity}
              >
                <ShapeElement html={frag.shape.element} />
              </g>
            );
          })}
        </svg>

        {/* Subtle gradient overlay for depth */}
        <div 
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'radial-gradient(ellipse at 30% 40%, transparent 0%, rgba(0,0,0,0.02) 100%)',
          }}
        />
        {SHOW_LOAD_INDICATOR && (
          <div className="absolute top-2 right-2 rounded-full px-2 py-1 text-[10px] uppercase tracking-wider bg-black/40 text-white">
            {isUnderLoad ? 'Perf: Low' : 'Perf: High'}
          </div>
        )}
      </div>

      {/* Render external controls if provided */}
      {renderControls && renderControls({
        activePreset,
        controls,
        updateControl,
        onReset: handleReset,
        isPaused,
        setIsPaused,
      })}
    </div>
  );
};

// ============================================================================
// CONTROL SLIDER COMPONENT (exported for external use)
// ============================================================================
interface ControlSliderProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  formatValue?: (value: number) => string;
}

export const ControlSlider: React.FC<ControlSliderProps> = ({
  label,
  value,
  onChange,
  min,
  max,
  step = 0.1,
  formatValue = (v) => v.toFixed(1),
}) => (
  <div className="grid w-full min-w-0 grid-cols-[auto,1fr,auto] items-center gap-2">
    <span className="text-neutral-400 text-[10px] whitespace-nowrap">{label}</span>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      className="w-full min-w-0 h-1 rounded-full cursor-pointer"
    />
    <span className="text-right text-neutral-500 text-[10px] tabular-nums whitespace-nowrap">{formatValue(value)}</span>
  </div>
);

// Export preset info for external control panels
export const PRESET_INFO: Record<PresetKey, { name: string; description: string }> = {
  voronoi: { name: 'Voronoi Shatter', description: 'Click shapes to shatter them into pieces' },
};

export type { PresetKey, Controls, ControlPanelProps };
export default InteractiveHeroBanner;
