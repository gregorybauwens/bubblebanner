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

type PresetKey = 'bubble' | 'voronoi' | 'magnetic' | 'wave';

interface Bubble {
  id: number;
  x: number;
  y: number;
  radius: number;
  age: number;
  strength: number;
  popped: boolean;
  children: number[];
}

interface Attractor {
  x: number;
  y: number;
  strength: number;
  phase: number;
}

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
  bubbles: Bubble[];
  attractors: Attractor[];
  clickPoint: { x: number; y: number } | null;
  clickTime: number;
  phase: number;
  shapeVelocities: Map<string, { vx: number; vy: number; vr: number }>;
  // Voronoi shatter state - fragments replace original shapes
  shardFragments: ShardFragment[];
  shatteredShapeIds: Set<string>; // Track which original shapes have been shattered
  isReturning: boolean;
  returnStartTime: number;
  lastClickTime: number;
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
  hoverDamping: number;
  clickStrength: number;
  clickRadius: number;
  spring: number;
  damping: number;
  revealRate: number;
  timeScale: number;
  // Bubble specific
  popImpulse: number;
  bubbleCount: number;
  splitDelay: number;
  bubbleSoftness: number;
  // Voronoi specific
  shardSpread: number;
  turbulence: number;
  settleTime: number;
  returnSpring: number;
  // Magnetic specific
  attractorCount: number;
  fieldStrength: number;
  orbitRate: number;
  // Wave specific
  waveFrequency: number;
  waveSpeed: number;
  bandContrast: number;
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
    
    // Add some spread
    const angleVariation = (seededRandom(seed * 3) - 0.5) * 0.8;
    const finalAngle = angleFromClick + angleVariation;
    
    const speed = controls.shardSpread * controls.clickStrength * (0.6 + seededRandom(seed * 4) * 0.8);
    const distFromClick = distance(fragCentroid.x / viewBox.width, fragCentroid.y / viewBox.height, clickPoint.x, clickPoint.y);
    const impulse = Math.max(0.5, 1.5 - distFromClick * 1.5);
    
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
    
    fragments.push({
      id: fragShape.id,
      shape: fragShape,
      originalShape: shape.parentId ? shape : shape, // Keep reference to root shape
      offsetX: 0,
      offsetY: 0,
      rotation: 0,
      vx: Math.cos(finalAngle) * speed * impulse * viewBox.width * 0.3,
      vy: Math.sin(finalAngle) * speed * impulse * viewBox.height * 0.6,
      vr: (seededRandom(seed * 5) - 0.5) * 80 * controls.shardSpread,
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
  bubbles: [],
  attractors: [],
  clickPoint: null,
  clickTime: 0,
  phase: 0,
  shapeVelocities: new Map(),
  shardFragments: [],
  shatteredShapeIds: new Set(),
  isReturning: false,
  returnStartTime: 0,
  lastClickTime: 0,
});

const PRESETS: Record<PresetKey, {
  name: string;
  description: string;
  initClick: (state: PresetState, point: { x: number; y: number }, controls: Controls, shapes?: Shape[], viewBox?: ViewBox, clickedShapeId?: string | null) => PresetState;
  update: (state: PresetState, dt: number, pointer: { x: number; y: number } | null, controls: Controls, shapes: Shape[], viewBox: ViewBox) => PresetState;
  shapeTransform: (shape: Shape, state: PresetState, pointer: { x: number; y: number } | null, controls: Controls, viewBox: ViewBox) => ShapeTransform;
}> = {
  // -------------------------------------------------------------------------
  // PRESET A: BUBBLE
  // -------------------------------------------------------------------------
  bubble: {
    name: 'Bubble',
    description: 'Pop & multiply bubbles in water',
    initClick: (state, point, controls) => {
      const newBubble: Bubble = {
        id: Date.now(),
        x: point.x,
        y: point.y,
        radius: controls.clickRadius * 0.5,
        age: 0,
        strength: controls.popImpulse,
        popped: false,
        children: [],
      };
      return { ...state, bubbles: [...state.bubbles, newBubble], clickPoint: point, clickTime: 0 };
    },
    update: (state, dt, _pointer, controls, _shapes, _viewBox) => {
      const newBubbles: Bubble[] = [];
      const toSpawn: Bubble[] = [];

      state.bubbles.forEach(bubble => {
        bubble.age += dt;
        bubble.radius += dt * 20 * controls.bubbleSoftness;
        bubble.strength *= 0.98;

        // Pop and split after delay
        if (!bubble.popped && bubble.age > controls.splitDelay) {
          bubble.popped = true;
          bubble.strength *= 0.5;
          
          // Spawn child bubbles
          const childCount = Math.min(controls.bubbleCount, 4);
          for (let i = 0; i < childCount; i++) {
            const angle = (Math.PI * 2 * i) / childCount + seededRandom(bubble.id + i) * 0.5;
            toSpawn.push({
              id: Date.now() + i,
              x: bubble.x + Math.cos(angle) * bubble.radius * 0.5,
              y: bubble.y + Math.sin(angle) * bubble.radius * 0.5,
              radius: bubble.radius * 0.4,
              age: 0,
              strength: bubble.strength * 0.6,
              popped: true,
              children: [],
            });
          }
        }

        // Drift with noise
        bubble.x += noise2D(bubble.age * 0.5, bubble.id) * dt * 10;
        bubble.y += noise2D(bubble.id, bubble.age * 0.5) * dt * 10;

        // Keep alive if still has influence
        if (bubble.strength > 0.01 && bubble.age < 5) {
          newBubbles.push(bubble);
        }
      });

      return { ...state, bubbles: [...newBubbles, ...toSpawn] };
    },
    shapeTransform: (shape, state, pointer, controls, viewBox) => {
      let x = 0, y = 0, scale = 1, brightness = 1;
      const cx = shape.centroid.x;
      const cy = shape.centroid.y;

      // Only apply bubble influence if bubbles exist (after click)
      if (state.bubbles.length > 0) {
        state.bubbles.forEach(bubble => {
          const dist = distance(cx, cy, bubble.x * viewBox.width, bubble.y * viewBox.height);
          const influence = Math.max(0, 1 - dist / (bubble.radius * viewBox.width * 2)) * bubble.strength;
          
          if (influence > 0) {
            const angle = Math.atan2(cy - bubble.y * viewBox.height, cx - bubble.x * viewBox.width);
            x += Math.cos(angle) * influence * 15 * controls.bubbleSoftness;
            y += Math.sin(angle) * influence * 15 * controls.bubbleSoftness;
            scale += influence * 0.1;
            brightness += influence * 0.2;
          }
        });
      }

      // Hover effect - only when pointer is present
      if (pointer) {
        const hoverDist = distance(cx / viewBox.width, cy / viewBox.height, pointer.x, pointer.y);
        const hoverInfluence = Math.max(0, 1 - hoverDist / controls.hoverRadius) * controls.hoverStrength * 0.02;
        x += (pointer.x * viewBox.width - cx) * hoverInfluence * 0.3;
        y += (pointer.y * viewBox.height - cy) * hoverInfluence * 0.3;
        brightness += hoverInfluence * 0.5;
      }

      // Constrain to container bounds
      const constrained = constrainToBounds(shape, x, y, clamp(scale, 0.8, 1.3), viewBox);

      return { x: constrained.x, y: constrained.y, scale: clamp(scale, 0.8, 1.3), rotate: 0, opacity: 1, filterStrength: 0, brightness: clamp(brightness, 0.9, 1.4) };
    },
  },

  // -------------------------------------------------------------------------
  // PRESET B: VORONOI SHATTER
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
      const returnDelay = controls.settleTime * 1.5; // Time before spring-back starts
      
      // Check if we should start returning (no clicks for a while)
      const timeSinceLastClick = newClickTime - state.lastClickTime;
      const shouldStartReturn = timeSinceLastClick > returnDelay && 
                                state.shardFragments.length > 0 && 
                                !state.isReturning;
      
      let newState = { 
        ...state, 
        clickTime: newClickTime,
        isReturning: state.isReturning || shouldStartReturn,
        returnStartTime: shouldStartReturn ? newClickTime : state.returnStartTime,
      };
      
      // Update fragment physics
      const updatedFragments = state.shardFragments.map(frag => {
        const fragAge = newClickTime - frag.spawnTime;
        
        if (state.isReturning) {
          // Spring back to original position
          const returnT = newClickTime - state.returnStartTime;
          const springForce = controls.returnSpring * 4;
          const damping = 0.85;
          
          // Calculate target position (original shape position)
          const targetX = 0;
          const targetY = 0;
          const targetRot = 0;
          
          const newVx = frag.vx * damping - frag.offsetX * springForce * dt * 60;
          const newVy = frag.vy * damping - frag.offsetY * springForce * dt * 60;
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
      
      // Clean up when return animation is complete
      if (state.isReturning) {
        const returnProgress = newClickTime - state.returnStartTime;
        if (returnProgress > controls.settleTime * 2) {
          // Reset everything
          return {
            ...newState,
            shardFragments: [],
            shatteredShapeIds: new Set<string>(),
            isReturning: false,
            returnStartTime: 0,
            lastClickTime: 0,
          };
        }
      }
      
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
        x += (pointer.x - shapeNormX) * hoverInfluence * viewBox.width * 0.05;
        y += (pointer.y - shapeNormY) * hoverInfluence * viewBox.height * 0.05;
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

  // -------------------------------------------------------------------------
  // PRESET C: MAGNETIC FIELD LINES
  // -------------------------------------------------------------------------
  magnetic: {
    name: 'Magnetic Field',
    description: 'Shapes orbit along field lines',
    initClick: (state, point, controls) => {
      const attractors: Attractor[] = [];
      const count = controls.attractorCount;
      for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 * i) / count + seededRandom(i * 13) * 0.5;
        const dist = 0.15 + seededRandom(i * 29) * 0.15;
        attractors.push({
          x: point.x + Math.cos(angle) * dist,
          y: point.y + Math.sin(angle) * dist,
          strength: controls.fieldStrength * (0.7 + seededRandom(i * 41) * 0.6),
          phase: seededRandom(i * 53) * Math.PI * 2,
        });
      }
      return { ...state, attractors, clickPoint: point, clickTime: 0, phase: 0 };
    },
    update: (state, dt, _pointer, controls, _shapes, _viewBox) => {
      const newPhase = state.phase + dt * controls.orbitRate;
      
      // Attractor orbiting motion
      const newAttractors = state.attractors.map((a, i) => ({
        ...a,
        phase: a.phase + dt * controls.orbitRate * (0.5 + seededRandom(i) * 0.5),
      }));

      return { ...state, attractors: newAttractors, phase: newPhase, clickTime: state.clickTime + dt };
    },
    shapeTransform: (shape, state, pointer, controls, viewBox) => {
      let x = 0, y = 0, rotate = 0;
      const cx = shape.centroid.x / viewBox.width;
      const cy = shape.centroid.y / viewBox.height;

      // Attractor influence - only when attractors exist (after click)
      if (state.attractors.length > 0) {
        state.attractors.forEach(attractor => {
          const dx = attractor.x - cx;
          const dy = attractor.y - cy;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const influence = attractor.strength / (dist + 0.1);
          
          // Tangential force (orbiting)
          const tangentX = -dy * influence * 15;
          const tangentY = dx * influence * 15;
          
          // Decay over time
          const decay = Math.exp(-state.clickTime * controls.damping * 0.3);
          x += tangentX * Math.sin(attractor.phase) * decay;
          y += tangentY * Math.cos(attractor.phase) * decay;
          rotate += influence * 5 * Math.sin(attractor.phase * 2) * decay;
        });
      }

      // Hover: gentle lean toward pointer - only when pointer is present
      if (pointer) {
        const hoverDist = distance(cx, cy, pointer.x, pointer.y);
        const hoverInfluence = Math.max(0, 1 - hoverDist / controls.hoverRadius) * controls.hoverStrength;
        const angle = Math.atan2(pointer.y - cy, pointer.x - cx);
        rotate += Math.sin(angle) * hoverInfluence * 15;
        // Pull shapes toward pointer with viewBox-scaled movement
        x += (pointer.x - cx) * hoverInfluence * viewBox.width * 0.08;
        y += (pointer.y - cy) * hoverInfluence * viewBox.height * 0.08;
      }

      // Constrain to container bounds
      const constrained = constrainToBounds(shape, x, y, 1, viewBox);

      return { x: constrained.x, y: constrained.y, scale: 1, rotate, opacity: 1, filterStrength: 0, brightness: 1 };
    },
  },

  // -------------------------------------------------------------------------
  // PRESET D: WAVE INTERFERENCE SCAN
  // -------------------------------------------------------------------------
  wave: {
    name: 'Wave Interference',
    description: 'Scanning interference patterns',
    initClick: (state, point, controls) => {
      return { ...state, clickPoint: point, clickTime: 0, phase: 0 };
    },
    update: (state, dt, _pointer, controls, _shapes, _viewBox) => {
      return { ...state, phase: state.phase + dt * controls.waveSpeed, clickTime: state.clickTime + dt };
    },
    shapeTransform: (shape, state, pointer, controls, viewBox) => {
      let x = 0, y = 0, opacity = 1, brightness = 1;
      const cx = shape.centroid.x / viewBox.width;
      const cy = shape.centroid.y / viewBox.height;

      // Wave interference pattern - only after click
      if (state.clickPoint && state.clickTime > 0) {
        const shapePhase = cx * controls.waveFrequency + cy * controls.waveFrequency * 0.5;
        const wave = Math.sin(state.phase * 5 + shapePhase * 10);
        const interference = Math.sin(state.phase * 3 - shapePhase * 7);
        
        const combined = (wave + interference) * 0.5 * controls.bandContrast;
        x = combined * 8;
        y = Math.cos(state.phase * 2 + shapePhase * 5) * combined * 4;
        
        // Fade effect based on wave
        const revealWave = Math.sin(state.phase * controls.revealRate + shapePhase * 3);
        opacity = clamp(0.7 + revealWave * 0.3, 0.5, 1);
        brightness = 1 + combined * 0.15;
      }

      // Hover: scanning band effect - only when pointer is present
      if (pointer) {
        const scanDist = Math.abs(cx - pointer.x);
        const bandInfluence = Math.exp(-scanDist * scanDist * 30) * controls.hoverStrength;
        // Vertical wave effect near pointer
        y += bandInfluence * 8;
        brightness += bandInfluence * 0.3;
        // Also add subtle horizontal pull toward pointer
        x += (pointer.x - cx) * bandInfluence * viewBox.width * 0.03;
      }

      // Constrain to container bounds
      const constrained = constrainToBounds(shape, x, y, 1, viewBox);

      return { x: constrained.x, y: constrained.y, scale: 1, rotate: 0, opacity, filterStrength: 0, brightness: clamp(brightness, 0.8, 1.3) };
    },
  },
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================
interface ControlPanelProps {
  activePreset: PresetKey;
  setActivePreset: (preset: PresetKey) => void;
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
  const [activePreset, setActivePreset] = useState<PresetKey>('bubble');
  const [isPaused, setIsPaused] = useState(false);
  
  // Parse SVG
  const { shapes, viewBox } = useMemo(() => parseSVG(svgMarkup), [svgMarkup]);

  // Controls state
  const [controls, setControls] = useState<Controls>({
    hoverStrength: 1,
    hoverRadius: 0.3,
    hoverDamping: 0.1,
    clickStrength: 1,
    clickRadius: 0.2,
    spring: 0.3,
    damping: 0.5,
    revealRate: 1,
    timeScale: 1,
    popImpulse: 1,
    bubbleCount: 3,
    splitDelay: 0.3,
    bubbleSoftness: 1,
    shardSpread: 1,
    turbulence: 0.5,
    settleTime: 2,
    returnSpring: 1.5,
    attractorCount: 3,
    fieldStrength: 1,
    orbitRate: 1,
    waveFrequency: 2,
    waveSpeed: 1,
    bandContrast: 1,
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
      
      // Find clicked shape (check from top to bottom - fragments first)
      let clickedShape: Shape | null = null;
      for (const shape of clickableShapes) {
        const b = shape.bounds;
        if (clickX >= b.x && clickX <= b.x + b.width &&
            clickY >= b.y && clickY <= b.y + b.height) {
          clickedShape = shape;
          break; // Take the first (topmost) match
        }
      }
      
      if (clickedShape && !presetState.isReturning) {
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
          
          return {
            ...prev,
            shardFragments: [...updatedFragments, ...newFragments],
            shatteredShapeIds: shatteredIds,
            clickPoint: point,
            lastClickTime: prev.clickTime,
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

  return (
    <div className={`relative w-full ${className}`} style={{ maxWidth: 1312 }}>
      {/* Main Banner */}
      <div
        ref={containerRef}
        className="relative w-full overflow-hidden rounded-2xl cursor-crosshair"
        style={{ 
          aspectRatio: `${viewBox.width} / ${viewBox.height}`,
          background: 'linear-gradient(135deg, hsl(45 10% 97%) 0%, hsl(40 15% 94%) 100%)',
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
        setActivePreset: (preset) => {
          setActivePreset(preset);
          handleReset();
        },
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
    <span className="w-16 text-neutral-600 text-[10px]">{label}</span>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      className="flex-1 h-1 bg-neutral-200 rounded-full appearance-none cursor-pointer accent-amber-500"
      style={{ accentColor: '#ECB300' }}
    />
    <span className="w-8 text-right text-neutral-500 text-[10px] tabular-nums">{value.toFixed(1)}</span>
  </div>
);

// Export preset info for external control panels
export const PRESET_INFO: Record<PresetKey, { name: string; description: string }> = {
  bubble: { name: 'Bubble', description: 'Pop & multiply bubbles in water' },
  voronoi: { name: 'Voronoi Shatter', description: 'Fracture into cells, then re-cohere' },
  magnetic: { name: 'Magnetic Field', description: 'Shapes orbit along field lines' },
  wave: { name: 'Wave Interference', description: 'Scanning interference patterns' },
};

export type { PresetKey, Controls, ControlPanelProps };
export default InteractiveHeroBanner;
