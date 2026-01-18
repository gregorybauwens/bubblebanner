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

// Crack line for glass shattering effect
interface CrackLine {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  spawnTime: number;
  duration: number;
  delay: number;
  width: number;
  branches: CrackLine[];
  // For clipping to shape
  shapeBounds: { x: number; y: number; width: number; height: number };
  shapeElement: string; // SVG element to use as clip path
}

interface PresetState {
  clickPoint: { x: number; y: number } | null;
  clickTime: number;
  // Voronoi shatter state - fragments replace original shapes
  shardFragments: ShardFragment[];
  shatteredShapeIds: Set<string>; // Track which original shapes have been shattered
  isReturning: boolean;
  returnStartTime: number;
  lastClickTime: number;
  // Glass crack lines
  crackLines: CrackLine[];
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
  settleTime: number;
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
  currentTime: number
): ShardFragment[] => {
  const fragments: ShardFragment[] = [];
  const fragmentCount = Math.min(2 + Math.floor(Math.random() * 2), 4); // 2-4 pieces
  
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
    const speed = baseSpeed * speedVariation * controls.shardSpread;
    
    // Distance-based impulse - closer = stronger explosion
    const distFromClick = distance(fragCentroid.x / viewBox.width, fragCentroid.y / viewBox.height, clickPoint.x, clickPoint.y);
    const impulse = Math.max(0.8, 2.0 - distFromClick * 2.5); // Higher base impulse
    
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
  lastClickTime: 0,
  crackLines: [],
});

// Generate glass crack lines from a click point
const generateCrackLines = (
  clickX: number,
  clickY: number,
  bounds: { x: number; y: number; width: number; height: number },
  shapeElement: string,
  currentTime: number,
  numCracks: number = 8
): CrackLine[] => {
  const cracks: CrackLine[] = [];
  const maxLength = Math.max(bounds.width, bounds.height) * 0.8;
  
  for (let i = 0; i < numCracks; i++) {
    // Radiate outward from click point with some randomness
    const baseAngle = (i / numCracks) * Math.PI * 2;
    const angleVariation = (seededRandom(i * 17 + currentTime) - 0.5) * 0.5;
    const angle = baseAngle + angleVariation;
    
    const length = maxLength * (0.4 + seededRandom(i * 31 + currentTime) * 0.6);
    const endX = clickX + Math.cos(angle) * length;
    const endY = clickY + Math.sin(angle) * length;
    
    // Create main crack
    const mainCrack: CrackLine = {
      id: `crack-${i}-${currentTime}`,
      x1: clickX,
      y1: clickY,
      x2: endX,
      y2: endY,
      spawnTime: currentTime,
      duration: 0.15 + seededRandom(i * 7) * 0.1,
      delay: i * 0.02, // Stagger the cracks
      width: 2 + seededRandom(i * 13) * 1.5,
      branches: [],
      shapeBounds: bounds,
      shapeElement: shapeElement,
    };
    
    // Add 1-3 branches to each main crack
    const numBranches = 1 + Math.floor(seededRandom(i * 23 + currentTime) * 3);
    for (let b = 0; b < numBranches; b++) {
      const branchT = 0.3 + seededRandom(i * 41 + b * 11) * 0.5; // Position along main crack
      const branchX = clickX + (endX - clickX) * branchT;
      const branchY = clickY + (endY - clickY) * branchT;
      
      // Branch angle deviates from main crack
      const branchAngleOffset = (seededRandom(i * 53 + b * 17) - 0.5) * Math.PI * 0.6;
      const branchAngle = angle + branchAngleOffset;
      const branchLength = length * (0.2 + seededRandom(i * 67 + b * 23) * 0.3);
      
      mainCrack.branches.push({
        id: `crack-${i}-branch-${b}-${currentTime}`,
        x1: branchX,
        y1: branchY,
        x2: branchX + Math.cos(branchAngle) * branchLength,
        y2: branchY + Math.sin(branchAngle) * branchLength,
        spawnTime: currentTime,
        duration: 0.1 + seededRandom(i * 79 + b) * 0.08,
        delay: i * 0.02 + branchT * 0.1,
        width: 1 + seededRandom(i * 89 + b * 31) * 1,
        branches: [],
        shapeBounds: bounds,
        shapeElement: shapeElement,
      });
    }
    
    cracks.push(mainCrack);
  }
  
  return cracks;
};

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
      const settleDelay = controls.settleTime * 1.5; // Time before fragments settle onto grid
      
      // Check if we should start settling (no clicks for a while)
      const timeSinceLastClick = newClickTime - state.lastClickTime;
      const shouldStartSettling = timeSinceLastClick > settleDelay && 
                                  state.shardFragments.length > 0 && 
                                  !state.isReturning;
      
      let newState = { 
        ...state, 
        clickTime: newClickTime,
        isReturning: state.isReturning || shouldStartSettling,
        returnStartTime: shouldStartSettling ? newClickTime : state.returnStartTime,
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
          // Settle onto grid - calculate target position with gutters
          const { col, row } = finalTargets[index] || { col: 0, row: 0 };
          const targetCenterX = gutter + col * (cellWidth + gutter) + cellWidth / 2;
          const targetCenterY = gutter + row * (cellHeight + gutter) + cellHeight / 2;
          const targetX = targetCenterX - frag.shape.centroid.x;
          const targetY = targetCenterY - frag.shape.centroid.y;
          
          // Spring towards grid position (not original position)
          const springForce = controls.returnSpring * 6;
          // settleDamping: 0 = very bouncy (0.95), 1 = critically damped (0.7), 2 = overdamped (0.5)
          const damping = Math.max(0.5, 0.95 - controls.settleDamping * 0.225);
          
          const diffX = targetX - frag.offsetX;
          const diffY = targetY - frag.offsetY;
          
          const newVx = frag.vx * damping + diffX * springForce * dt * 60;
          const newVy = frag.vy * damping + diffY * springForce * dt * 60;
          const newVr = frag.vr * damping - frag.rotation * springForce * dt * 30;
          
          return {
            ...frag,
            vx: newVx,
            vy: newVy,
            vr: newVr,
            offsetX: frag.offsetX + newVx * dt,
            offsetY: frag.offsetY + newVy * dt,
            rotation: frag.rotation + newVr * dt,
            isExploding: false,
          };
        } else if (frag.isExploding) {
          // Explosion phase with damping
          const damping = 0.97;
          return {
            ...frag,
            vx: frag.vx * damping,
            vy: frag.vy * damping,
            vr: frag.vr * damping,
            offsetX: frag.offsetX + frag.vx * dt,
            offsetY: frag.offsetY + frag.vy * dt,
            rotation: frag.rotation + frag.vr * dt,
          };
        }
        return frag;
      });
      
      // No automatic reset - fragments stay on grid until reset button is pressed
      
      newState.shardFragments = updatedFragments;
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
  
  // Parse SVG
  const { shapes, viewBox } = useMemo(() => parseSVG(svgMarkup), [svgMarkup]);

  // Controls state
  const [controls, setControls] = useState<Controls>({
    hoverStrength: 2,
    hoverRadius: 0.5,
    clickStrength: 1,
    spring: 0.3,
    damping: 0.5,
    timeScale: 1,
    shardSpread: 1,
    settleTime: 2,
    returnSpring: 2,
    settleDamping: 1.2, // Default to quick, minimal bounce
    explosionForce: 1.5, // Strong default burst
    explosionSpin: 1, // Moderate spin
  });

  // Animation state
  const [presetState, setPresetState] = useState<PresetState>(createInitialState());
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const [shapeTransforms, setShapeTransforms] = useState<Map<string, ShapeTransform>>(new Map());
  
  const lastTimeRef = useRef<number>(0);
  const animationRef = useRef<number>();

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

  const handleClick = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    let clientX: number, clientY: number;
    
    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }
    
    const point = {
      x: (clientX - rect.left) / rect.width,
      y: (clientY - rect.top) / rect.height,
    };
    
    // Convert to viewBox coordinates for hit testing
    const clickX = point.x * viewBox.width;
    const clickY = point.y * viewBox.height;
    
    // Cursor radius in viewBox coordinates (28px cursor, scaled to viewBox)
    const cursorRadiusPx = 14; // Half of 28px cursor
    const cursorRadiusX = (cursorRadiusPx / rect.width) * viewBox.width;
    const cursorRadiusY = (cursorRadiusPx / rect.height) * viewBox.height;
    const cursorRadius = Math.max(cursorRadiusX, cursorRadiusY);
    
    // Special handling for voronoi preset - detect which shape was clicked
    if (activePreset === 'voronoi') {
      // Get all clickable shapes (original shapes not yet shattered + fragments)
      const clickableShapes: Shape[] = [];
      
      // Add fragments first (they're on top)
      presetState.shardFragments.forEach(frag => {
        // Adjust bounds by fragment offset
        const adjustedBounds = {
          x: frag.shape.bounds.x + frag.offsetX,
          y: frag.shape.bounds.y + frag.offsetY,
          width: frag.shape.bounds.width,
          height: frag.shape.bounds.height,
        };
        clickableShapes.push({
          ...frag.shape,
          bounds: adjustedBounds,
          centroid: {
            x: frag.shape.centroid.x + frag.offsetX,
            y: frag.shape.centroid.y + frag.offsetY,
          },
        });
      });
      
      // Add original shapes that haven't been shattered
      shapes.forEach(shape => {
        if (!presetState.shatteredShapeIds.has(shape.id)) {
          clickableShapes.push(shape);
        }
      });
      
      // Find clicked shape - check if cursor circle overlaps with shape bounds
      let clickedShape: Shape | null = null;
      for (const shape of clickableShapes) {
        const b = shape.bounds;
        // Check if cursor circle overlaps with shape rectangle
        // Find closest point on rectangle to cursor center
        const closestX = clamp(clickX, b.x, b.x + b.width);
        const closestY = clamp(clickY, b.y, b.y + b.height);
        const dist = distance(clickX, clickY, closestX, closestY);
        
        if (dist <= cursorRadius) {
          clickedShape = shape;
          break; // Take the first (topmost) match
        }
      }
      
      if (clickedShape) {
        // Find the actual shape/fragment to shatter
        const isFragment = clickedShape.id.startsWith('frag-');
        
        // Get the shape to fragment (either the clicked fragment's original shape or the original shape)
        let shapeToFragment: Shape;
        let fragmentToRemove: ShardFragment | null = null;
        
        if (isFragment) {
          // Find the fragment that was clicked
          fragmentToRemove = presetState.shardFragments.find(f => f.shape.id === clickedShape!.id) || null;
          if (fragmentToRemove) {
            shapeToFragment = {
              ...fragmentToRemove.shape,
              bounds: {
                x: fragmentToRemove.shape.bounds.x + fragmentToRemove.offsetX,
                y: fragmentToRemove.shape.bounds.y + fragmentToRemove.offsetY,
                width: fragmentToRemove.shape.bounds.width,
                height: fragmentToRemove.shape.bounds.height,
              },
              centroid: {
                x: fragmentToRemove.shape.centroid.x + fragmentToRemove.offsetX,
                y: fragmentToRemove.shape.centroid.y + fragmentToRemove.offsetY,
              },
            };
          } else {
            return;
          }
        } else {
          shapeToFragment = clickedShape;
        }
        
        // Create new fragments from the clicked shape
        const generation = isFragment && fragmentToRemove ? fragmentToRemove.generation + 1 : 1;
        const newFragments = createFragmentsFromShape(
          shapeToFragment,
          point,
          viewBox,
          controls,
          generation,
          presetState.clickTime
        );
        
        // Generate crack lines from the click point
        const crackClickX = point.x * viewBox.width;
        const crackClickY = point.y * viewBox.height;
        const newCrackLines = generateCrackLines(
          crackClickX,
          crackClickY,
          shapeToFragment.bounds,
          shapeToFragment.element,
          presetState.clickTime,
          6 + Math.floor(Math.random() * 4) // 6-9 cracks
        );
        
        setPresetState(prev => {
          // Remove the fragment that was clicked (if it was a fragment)
          let updatedFragments = prev.shardFragments;
          if (fragmentToRemove) {
            updatedFragments = prev.shardFragments.filter(f => f.id !== fragmentToRemove!.id);
          }
          
          // Add new fragments
          const shatteredIds = new Set(prev.shatteredShapeIds);
          if (!isFragment) {
            shatteredIds.add(clickedShape!.id);
          }
          
          // Keep old crack lines that haven't faded yet (within 0.8 seconds)
          const activeCrackLines = prev.crackLines.filter(
            crack => prev.clickTime - crack.spawnTime < 0.8
          );
          
          return {
            ...prev,
            shardFragments: [...updatedFragments, ...newFragments],
            shatteredShapeIds: shatteredIds,
            clickPoint: point,
            lastClickTime: prev.clickTime,
            isReturning: false, // Reset returning state so new fragments can explode
            crackLines: [...activeCrackLines, ...newCrackLines],
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
    setPresetState(createInitialState());
  }, []);

  // Animation loop
  useEffect(() => {
    if (prefersReducedMotion || isPaused) return;

    const animate = (time: number) => {
      const dt = lastTimeRef.current ? Math.min((time - lastTimeRef.current) / 1000, 0.1) : 0.016;
      lastTimeRef.current = time;

      const preset = PRESETS[activePreset];
      
      // Update preset state
      setPresetState(prev => preset.update(prev, dt * controls.timeScale, pointer, controls, shapes, viewBox));
      
      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [activePreset, controls, pointer, shapes, prefersReducedMotion, isPaused]);

  // Calculate transforms
  useEffect(() => {
    const preset = PRESETS[activePreset];
    const newTransforms = new Map<string, ShapeTransform>();
    
    shapes.forEach(shape => {
      const transform = preset.shapeTransform(shape, presetState, pointer, controls, viewBox);
      newTransforms.set(shape.id, transform);
    });
    
    setShapeTransforms(newTransforms);
  }, [activePreset, presetState, pointer, controls, shapes, viewBox]);

  // Control updater
  const updateControl = (key: keyof Controls, value: number) => {
    setControls(prev => ({ ...prev, [key]: value }));
  };

  // Custom cursor SVG as data URI
  const customCursor = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 28 28'%3E%3Ccircle cx='14' cy='14' r='13' fill='rgba(255,255,255,0.08)' stroke='rgba(255,255,255,0.4)' stroke-width='1'/%3E%3C/svg%3E") 14 14, crosshair`;

  return (
    <div className={`relative w-full ${className}`} style={{ maxWidth: 1312 }}>
      {/* Main Banner */}
      <div
        ref={containerRef}
        className="relative w-full overflow-hidden rounded-2xl"
        style={{ 
          aspectRatio: `${viewBox.width} / ${viewBox.height}`,
          background: 'linear-gradient(135deg, hsl(0 0% 8%) 0%, hsl(0 0% 12%) 100%)',
          cursor: customCursor,
        }}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        onClick={handleClick}
        onTouchStart={handleClick}
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

          {/* Render shapes - for voronoi, hide shattered shapes */}
          {shapes.map((shape) => {
            // For voronoi preset, hide shapes that have been shattered into fragments
            if (activePreset === 'voronoi' && presetState.shatteredShapeIds.has(shape.id)) {
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
                  opacity: transform.opacity,
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
          
          {/* Render glass crack lines ON the shapes (clipped to shape bounds) */}
          {activePreset === 'voronoi' && (presetState.crackLines || []).map((crack, crackIndex) => {
            const elapsed = presetState.clickTime - crack.spawnTime;
            const fadeOutStart = 0.3;
            const fadeOutDuration = 0.25;
            const opacity = elapsed > fadeOutStart 
              ? Math.max(0, 1 - (elapsed - fadeOutStart) / fadeOutDuration)
              : 1;
            
            if (opacity <= 0) return null;
            
            // Calculate animation progress for each crack
            const crackProgress = Math.min(1, Math.max(0, (elapsed - crack.delay) / crack.duration));
            const eased = 1 - Math.pow(1 - crackProgress, 3); // Ease out cubic
            
            const currentX2 = crack.x1 + (crack.x2 - crack.x1) * eased;
            const currentY2 = crack.y1 + (crack.y2 - crack.y1) * eased;
            
            const clipId = `crack-clip-${crack.id}`;
            
            return (
              <g key={crack.id}>
                {/* Define clipPath using the shape */}
                <defs>
                  <clipPath id={clipId}>
                    <g dangerouslySetInnerHTML={{ __html: crack.shapeElement }} />
                  </clipPath>
                </defs>
                
                {/* Crack lines clipped to shape */}
                <g clipPath={`url(#${clipId})`} opacity={opacity}>
                  {/* Dark crack line (shadow/depth) */}
                  <line
                    x1={crack.x1}
                    y1={crack.y1}
                    x2={currentX2}
                    y2={currentY2}
                    stroke="rgba(0, 0, 0, 0.5)"
                    strokeWidth={crack.width + 1}
                    strokeLinecap="round"
                  />
                  {/* Main white crack line */}
                  <line
                    x1={crack.x1}
                    y1={crack.y1}
                    x2={currentX2}
                    y2={currentY2}
                    stroke="rgba(255, 255, 255, 0.95)"
                    strokeWidth={crack.width}
                    strokeLinecap="round"
                  />
                  
                  {/* Branch cracks */}
                  {crack.branches.map((branch) => {
                    const branchElapsed = elapsed;
                    const branchProgress = Math.min(1, Math.max(0, (branchElapsed - branch.delay) / branch.duration));
                    const branchEased = 1 - Math.pow(1 - branchProgress, 3);
                    
                    // Only show branch if main crack has reached it
                    const mainReachedBranch = crackProgress >= 0.3;
                    if (!mainReachedBranch) return null;
                    
                    const branchX2 = branch.x1 + (branch.x2 - branch.x1) * branchEased;
                    const branchY2 = branch.y1 + (branch.y2 - branch.y1) * branchEased;
                    
                    return (
                      <g key={branch.id}>
                        <line
                          x1={branch.x1}
                          y1={branch.y1}
                          x2={branchX2}
                          y2={branchY2}
                          stroke="rgba(0, 0, 0, 0.4)"
                          strokeWidth={branch.width + 0.5}
                          strokeLinecap="round"
                        />
                        <line
                          x1={branch.x1}
                          y1={branch.y1}
                          x2={branchX2}
                          y2={branchY2}
                          stroke="rgba(255, 255, 255, 0.85)"
                          strokeWidth={branch.width}
                          strokeLinecap="round"
                        />
                      </g>
                    );
                  })}
                </g>
              </g>
            );
          })}
          
          {/* Render voronoi fragments */}
          {activePreset === 'voronoi' && presetState.shardFragments.map((frag) => {
            const centerX = frag.shape.centroid.x;
            const centerY = frag.shape.centroid.y;
            
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
                  x: frag.offsetX,
                  y: frag.offsetY,
                  rotate: frag.rotation,
                  opacity: 1,
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
