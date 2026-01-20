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

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

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
  lastClickTime: number;
  lastExplosionTime: number;
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
  returnSpring: number;
  settleDamping: number; // Higher = less bouncy, quicker settle
  // Explosion controls
  explosionForce: number; // How hard fragments explode outward
  explosionSpin: number; // How much fragments rotate on explosion
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const smoothstep = (t: number) => t * t * (3 - 2 * t);
const BURST_WINDOW_S = 0.6;
const MAX_BURST_CLICKS = 9;
const MAX_TOTAL_FRAGMENTS = 320;
const MAX_TOTAL_CRACK_LINES = 180;
const LOAD_FRAGMENT_THRESHOLD = 180;
const LOAD_DT_THRESHOLD = 0.02;
const LOAD_RECOVERY_THRESHOLD = 0.018;
const SHOW_LOAD_INDICATOR = false;
const CONTROLS_STORAGE_KEY = 'bubblebanner.controls.v3';
const DEFAULT_CONTROLS: Controls = {
  hoverStrength: 0.3,
  hoverRadius: 0.5,
  clickStrength: 1,
  spring: 0.3,
  damping: 0.5,
  timeScale: 1,
  shardSpread: 0.3,
  settleTime: .65,
  returnSpring: 2.2,
  settleDamping: 1.9,
  explosionForce: 8.0,
  explosionSpin: 1.8,
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
  viewBox: { x: number; y: number; width: number; height: number },
  padding: number = 0,
  restitution: number = 0.9
): { x: number; y: number; vx: number; vy: number } => {
  const bounds = shape.bounds;
  const scaledWidth = bounds.width;
  const scaledHeight = bounds.height;

  let x = offsetX;
  let y = offsetY;
  let nextVx = vx;
  let nextVy = vy;

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
  } else if (newRight > containerRight) {
    x -= newRight - containerRight;
    nextVx = -Math.abs(nextVx) * restitution;
  }

  if (newTop < containerTop) {
    y += containerTop - newTop;
    nextVy = Math.abs(nextVy) * restitution;
  } else if (newBottom > containerBottom) {
    y -= newBottom - containerBottom;
    nextVy = -Math.abs(nextVy) * restitution;
  }

  return { x, y, vx: nextVx, vy: nextVy };
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
  const fragments: ShardFragment[] = [];
  const baseCount = Math.min(2 + Math.floor(Math.random() * 2), 4); // 2-4 pieces
  const scaledCount = Math.round(baseCount * shatterScale);
  const fragmentCount = overrideFragmentCount ?? Math.max(2, Math.min(scaledCount, 8));
  
  const bounds = shape.bounds;
  const isHorizontalShape = bounds.width > bounds.height;
  
  for (let i = 0; i < fragmentCount; i++) {
    const seed = Date.now() + i * 1000 + Math.random() * 1000;
    
    // Calculate fragment bounds - divide the parent shape
    let fragBounds: { x: number; y: number; width: number; height: number };
    
    if (isHorizontalShape) {
      // Split horizontally
      const sliceWidth = bounds.width / fragmentCount;
      fragBounds = {
        x: bounds.x + sliceWidth * i,
        y: bounds.y,
        width: sliceWidth,
        height: bounds.height,
      };
    } else {
      // Split vertically
      const sliceHeight = bounds.height / fragmentCount;
      fragBounds = {
        x: bounds.x,
        y: bounds.y + sliceHeight * i,
        width: bounds.width,
        height: sliceHeight,
      };
    }
    
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
    const baseSpeed = controls.explosionForce * 2.5;
    const speedVariation = 0.5 + seededRandom(seed * 4) * 1.0; // More variation
    const speed = baseSpeed * speedVariation * controls.shardSpread * shatterScale;
    
    // Distance-based impulse - closer = stronger explosion
    const distFromClick = distance(fragCentroid.x / viewBox.width, fragCentroid.y / viewBox.height, clickPoint.x, clickPoint.y);
    const impulse = Math.max(0.8, 2.0 - distFromClick * 2.5) * (0.75 + shatterScale * 0.25); // Higher base impulse
    
    // Create SVG element for the fragment (clipped rect)
    const rx = parseFloat(shape.attrs.rx || '0');
    const ry = parseFloat(shape.attrs.ry || rx.toString());
    const scaledRx = Math.min(rx, fragBounds.width / 2, fragBounds.height / 2);
    const scaledRy = Math.min(ry, fragBounds.width / 2, fragBounds.height / 2);
    
    const fragElement = `<rect x="${fragBounds.x}" y="${fragBounds.y}" width="${fragBounds.width}" height="${fragBounds.height}" rx="${scaledRx}" ry="${scaledRy}" fill="${shape.fill || '#ECB300'}"/>`;
    
    const fragShape: Shape = {
      id: `frag-${shape.id}-${generation}-${i}-${Date.now()}`,
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
    const explosionVx = Math.cos(finalAngle) * speed * impulse * viewBox.width * 0.5;
    const explosionVy = Math.sin(finalAngle) * speed * impulse * viewBox.height * 0.8;
    
    // Spin based on explosion direction and control setting
    const spinDirection = seededRandom(seed * 5) > 0.5 ? 1 : -1;
    const spinMagnitude = controls.explosionSpin * 150 * (0.5 + seededRandom(seed * 6) * 0.5);
    const explosionVr = spinDirection * spinMagnitude * impulse;
    
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
      isExploding: true,
    });
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
  lastClickTime: 0,
  lastExplosionTime: 0,
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
      const timeSinceLastExplosion = newClickTime - state.lastExplosionTime;
      const shouldStartSettling = timeSinceLastClick > settleDelay &&
                                  timeSinceLastExplosion > 0.65 &&
                                  state.shardFragments.length > 0 && 
                                  !state.isReturning;
      
      let newState = { 
        ...state, 
        clickTime: newClickTime,
        isReturning: state.isReturning || shouldStartSettling,
        returnStartTime: shouldStartSettling ? newClickTime : state.returnStartTime,
        returnMode: shouldStartSettling ? 'grid' : state.returnMode,
      };
      
      // Calculate grid with 16px gutters for settling
      const gutter = 16;
      const fragmentCount = state.shardFragments.length;
      const cols = Math.ceil(Math.sqrt(fragmentCount * (viewBox.width / viewBox.height)));
      const rows = Math.ceil(fragmentCount / cols);
      const cellWidth = (viewBox.width - gutter * (cols + 1)) / cols;
      const cellHeight = (viewBox.height - gutter * (rows + 1)) / rows;
      
      // Assign each fragment to nearest grid cell based on current position
      // First pass: calculate current positions and find nearest grid cell
      const gridAssignments = new Map<string, number>(); // "col,row" -> fragmentIndex
      const fragmentGridTargets: { col: number; row: number }[] = [];
      
      // Calculate which grid cell each fragment is closest to
      state.shardFragments.forEach((frag, index) => {
        const currentX = frag.shape.centroid.x + frag.offsetX;
        const currentY = frag.shape.centroid.y + frag.offsetY;
        
        // Find nearest grid cell
        let bestCol = Math.round((currentX - gutter - cellWidth / 2) / (cellWidth + gutter));
        let bestRow = Math.round((currentY - gutter - cellHeight / 2) / (cellHeight + gutter));
        
        // Clamp to valid range
        bestCol = Math.max(0, Math.min(cols - 1, bestCol));
        bestRow = Math.max(0, Math.min(rows - 1, bestRow));
        
        fragmentGridTargets[index] = { col: bestCol, row: bestRow };
      });
      
      // Resolve conflicts - if multiple fragments want the same cell, use spiral search
      const occupiedCells = new Set<string>();
      const finalTargets: { col: number; row: number }[] = [];
      
      fragmentGridTargets.forEach((target, index) => {
        let { col, row } = target;
        const key = `${col},${row}`;
        
        if (!occupiedCells.has(key)) {
          occupiedCells.add(key);
          finalTargets[index] = { col, row };
        } else {
          // Spiral search for nearest free cell
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
                    finalTargets[index] = { col: newCol, row: newRow };
                    found = true;
                  }
                }
              }
            }
          }
          // Fallback if no cell found
          if (!found) {
            finalTargets[index] = { col, row };
          }
        }
      });
      
      // Update fragment physics
      const updatedFragments = state.shardFragments.map((frag, index) => {
        if (state.isReturning) {
          const targetX = state.returnMode === 'original' ? 0 : (() => {
            const { col, row } = finalTargets[index] || { col: 0, row: 0 };
            const targetCenterX = gutter + col * (cellWidth + gutter) + cellWidth / 2;
            return targetCenterX - frag.shape.centroid.x;
          })();
          const targetY = state.returnMode === 'original' ? 0 : (() => {
            const { col, row } = finalTargets[index] || { col: 0, row: 0 };
            const targetCenterY = gutter + row * (cellHeight + gutter) + cellHeight / 2;
            return targetCenterY - frag.shape.centroid.y;
          })();
          
          // Spring towards grid position (not original position)
          const returnElapsed = Math.max(0, newClickTime - state.returnStartTime);
          const returnEase = smoothstep(clamp(returnElapsed / 0.6, 0, 1));
          const springForce = controls.returnSpring * 6 * returnEase;
          // settleDamping: 0 = very bouncy (0.95), 1 = critically damped (0.7), 2 = overdamped (0.5)
          const damping = Math.max(0.5, 0.95 - controls.settleDamping * 0.225);
          
          const diffX = targetX - frag.offsetX;
          const diffY = targetY - frag.offsetY;
          
          const newVx = frag.vx * damping + diffX * springForce * dt * 60;
          const newVy = frag.vy * damping + diffY * springForce * dt * 60;
          const newVr = frag.vr * damping - frag.rotation * springForce * dt * 30;
          
          const nextOffsetX = frag.offsetX + newVx * dt;
          const nextOffsetY = frag.offsetY + newVy * dt;
          const bounced = bounceWithinBounds(
            frag.shape,
            nextOffsetX,
            nextOffsetY,
            newVx,
            newVy,
            viewBox
          );
          return {
            ...frag,
            vx: bounced.vx,
            vy: bounced.vy,
            vr: newVr,
            offsetX: bounced.x,
            offsetY: bounced.y,
            rotation: frag.rotation + newVr * dt,
            isExploding: false,
          };
        } else if (frag.isExploding) {
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
            viewBox
          );
          const speed = Math.hypot(nextVx, nextVy) + Math.abs(nextVr) * 0.1;
          const isExploding = speed > 5;
          return {
            ...frag,
            vx: bounced.vx,
            vy: bounced.vy,
            vr: nextVr,
            offsetX: bounced.x,
            offsetY: bounced.y,
            rotation: frag.rotation + frag.vr * dt,
            isExploding,
          };
        }
        return frag;
      });
      
      // No automatic reset - fragments stay on grid until reset button is pressed
      
      const hasExploding = updatedFragments.some(frag => frag.isExploding);
      const returnElapsed = Math.max(0, newClickTime - state.returnStartTime);
      const shouldFinalizeReset = state.isReturning && state.returnMode === 'original' && updatedFragments.length > 0 &&
        (returnElapsed > 1 || updatedFragments.every(frag => {
          const speed = Math.hypot(frag.vx, frag.vy) + Math.abs(frag.vr);
          return Math.abs(frag.offsetX) < 0.5 && Math.abs(frag.offsetY) < 0.5 && speed < 5;
        }));

      newState.shardFragments = updatedFragments;
      newState.lastExplosionTime = hasExploding ? newClickTime : state.lastExplosionTime;
      if (shouldFinalizeReset) {
        newState = {
          ...newState,
          shardFragments: [],
          shatteredShapeIds: new Set(),
          isReturning: false,
          returnStartTime: 0,
          returnMode: 'grid',
        };
      }
      return newState;
    },
    shapeTransform: (shape, state, pointer, controls, viewBox) => {
      let x = 0, y = 0, scale = 1, rotate = 0, opacity = 1;

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
}

const InteractiveHeroBanner: React.FC<InteractiveHeroBannerProps> = ({
  svgMarkup = STARTER_SVG,
  className = '',
  renderControls,
}) => {
  const prefersReducedMotion = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const [activePreset] = useState<PresetKey>('voronoi');
  const [isPaused, setIsPaused] = useState(false);
  const clickBurstRef = useRef<number[]>([]);
  
  // Parse SVG
  const { shapes, viewBox } = useMemo(() => parseSVG(svgMarkup), [svgMarkup]);
  const firstFourShapeIds = useMemo(() => {
    return shapes
      .slice()
      .sort((a, b) => a.centroid.x - b.centroid.x)
      .slice(0, 4)
      .map(shape => shape.id);
  }, [shapes]);

  // Controls state
  const [controls, setControls] = useState<Controls>(() => {
    if (typeof window === 'undefined') return DEFAULT_CONTROLS;
    try {
      const saved = window.localStorage.getItem(CONTROLS_STORAGE_KEY);
      if (!saved) return DEFAULT_CONTROLS;
      const parsed = JSON.parse(saved) as Partial<Controls>;
      return { ...DEFAULT_CONTROLS, ...parsed };
    } catch {
      return DEFAULT_CONTROLS;
    }
  });

  // Animation state
  const [presetState, setPresetState] = useState<PresetState>(createInitialState());
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const [shapeTransforms, setShapeTransforms] = useState<Map<string, ShapeTransform>>(new Map());
  const [isUnderLoad, setIsUnderLoad] = useState(false);
  
  const lastTimeRef = useRef<number>(0);
  const animationRef = useRef<number>();
  const avgDtRef = useRef<number>(0.016);
  const presetStateRef = useRef<PresetState>(presetState);

  useEffect(() => {
    presetStateRef.current = presetState;
  }, [presetState]);

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
      presetState.shardFragments.forEach(frag => {
        let hoverX = 0;
        let hoverY = 0;
        if (pointer && !isUnderLoad) {
          const fragNormX = (frag.shape.centroid.x + frag.offsetX) / viewBox.width;
          const fragNormY = (frag.shape.centroid.y + frag.offsetY) / viewBox.height;
          const hoverDist = distance(fragNormX, fragNormY, pointer.x, pointer.y);
          const hoverInfluence = Math.max(0, 1 - hoverDist / effectiveControls.hoverRadius) * effectiveControls.hoverStrength;
          hoverX = (pointer.x - fragNormX) * hoverInfluence * viewBox.width * 0.25;
          hoverY = (pointer.y - fragNormY) * hoverInfluence * viewBox.height * 0.25;
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
          const shouldForceSixPieces = !isFragment &&
            !presetState.shatteredShapeIds.has(hitShape.id) &&
            firstFourShapeIds.includes(hitShape.id);
          const newFragments = createFragmentsFromShape(
            hitShape,
            point,
            viewBox,
            controls,
            generation,
            presetState.clickTime,
            effectiveShatterScale,
            shouldForceSixPieces ? 6 : undefined
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
      if (prev.shardFragments.length === 0) {
        return createInitialState();
      }

      return {
        ...prev,
        isReturning: true,
        returnStartTime: prev.clickTime,
        returnMode: 'original',
        lastExplosionTime: prev.clickTime,
        lastClickTime: prev.clickTime,
      };
    });
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'r') {
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

  // Animation loop
  useEffect(() => {
    if (prefersReducedMotion || isPaused) return;

    const animate = (time: number) => {
      const dt = lastTimeRef.current ? Math.min((time - lastTimeRef.current) / 1000, 0.1) : 0.016;
      lastTimeRef.current = time;

      const preset = PRESETS[activePreset];
      
      // Update preset state
      setPresetState(prev => preset.update(prev, dt * controls.timeScale, pointer, effectiveControls, shapes, viewBox));

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
  }, [activePreset, controls.timeScale, effectiveControls, pointer, shapes, prefersReducedMotion, isPaused, isUnderLoad]);

  // Calculate transforms
  useEffect(() => {
    const preset = PRESETS[activePreset];
    const newTransforms = new Map<string, ShapeTransform>();
    
    shapes.forEach(shape => {
      const transform = preset.shapeTransform(shape, presetState, pointer, effectiveControls, viewBox);
      newTransforms.set(shape.id, transform);
    });
    
    setShapeTransforms(newTransforms);
  }, [activePreset, presetState, pointer, effectiveControls, shapes, viewBox]);

  // Control updater
  const updateControl = (key: keyof Controls, value: number) => {
    setControls(prev => ({ ...prev, [key]: value }));
  };

  useEffect(() => {
    try {
      window.localStorage.setItem(CONTROLS_STORAGE_KEY, JSON.stringify(controls));
    } catch {
      // Ignore storage failures
    }
  }, [controls]);

  const { cursorScale } = getBurstMetrics(performance.now() / 1000, false);
  const cursorSize = Math.round(50 * cursorScale);
  const cursorHotspot = Math.round(cursorSize / 2);
  const cursorSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cursorSize}" height="${cursorSize}" viewBox="0 0 50 50"><circle cx="25" cy="25" r="24" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.4)" stroke-width="1"/></svg>`;
  const customCursor = `url("data:image/svg+xml,${encodeURIComponent(cursorSvg)}") ${cursorHotspot} ${cursorHotspot}, crosshair`;

  const resetProgress = presetState.returnMode === 'original'
    ? clamp((presetState.clickTime - presetState.returnStartTime) / 0.4, 0, 1)
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
          style={{ display: 'block' }}
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
                <g dangerouslySetInnerHTML={{ __html: shape.element }} />
              </motion.g>
            );
          })}
          
          {/* Render voronoi fragments with hover effect */}
          {activePreset === 'voronoi' && presetState.shardFragments.map((frag) => {
            const centerX = frag.shape.centroid.x;
            const centerY = frag.shape.centroid.y;
            
            // Calculate hover offset for this fragment
            let hoverX = 0, hoverY = 0;
            if (pointer && !isUnderLoad) {
              // Fragment's current position in normalized coordinates
              const fragNormX = (frag.shape.centroid.x + frag.offsetX) / viewBox.width;
              const fragNormY = (frag.shape.centroid.y + frag.offsetY) / viewBox.height;
              const hoverDist = distance(fragNormX, fragNormY, pointer.x, pointer.y);
              const hoverInfluence = Math.max(0, 1 - hoverDist / effectiveControls.hoverRadius) * effectiveControls.hoverStrength;
              hoverX = (pointer.x - fragNormX) * hoverInfluence * viewBox.width * 0.25;
              hoverY = (pointer.y - fragNormY) * hoverInfluence * viewBox.height * 0.25;
            }
            
            return (
              <motion.g
                key={frag.id}
                initial={{ 
                  x: 0, 
                  y: 0, 
                  rotate: 0,
                  opacity: 1,
                }}
                animate={{
                  x: frag.offsetX + hoverX,
                  y: frag.offsetY + hoverY,
                  rotate: frag.rotation,
                  opacity: presetState.returnMode === 'original' ? 1 - resetProgress : 1,
                }}
                transition={{
                  type: 'spring',
                  stiffness: 200,
                  damping: 20,
                }}
                style={{
                  transformOrigin: `${centerX}px ${centerY}px`,
                }}
              >
                <g dangerouslySetInnerHTML={{ __html: frag.shape.element }} />
              </motion.g>
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
}

export const ControlSlider: React.FC<ControlSliderProps> = ({ label, value, onChange, min, max, step = 0.1 }) => (
  <div className="flex items-center gap-2">
    <span className="w-16 text-neutral-400 text-[10px]">{label}</span>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      className="flex-1 h-1 bg-neutral-700 rounded-full appearance-none cursor-pointer"
      style={{ accentColor: '#ECB300' }}
    />
    <span className="w-8 text-right text-neutral-500 text-[10px] tabular-nums">{value.toFixed(1)}</span>
  </div>
);

// Export preset info for external control panels
export const PRESET_INFO: Record<PresetKey, { name: string; description: string }> = {
  voronoi: { name: 'Voronoi Shatter', description: 'Click shapes to shatter them into pieces' },
};

export type { PresetKey, Controls, ControlPanelProps };
export default InteractiveHeroBanner;
