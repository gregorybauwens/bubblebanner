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
import {
  type Shape,
  type ViewBox,
  type ShardFragment,
  type PresetState,
  type ShapeTransform,
  type Controls,
  DEFAULT_COLOR_STOPS,
  DEFAULT_CONTROLS,
  lerp,
  clamp,
  smoothstep,
  distance,
  seededRandom,
  getPaletteColor,
  applyFillToShape,
  constrainToBounds,
  bounceWithinBounds,
  createFragmentsFromShape,
  createInitialState,
  LOCKED_REORG_FLOAT_STRENGTH,
  LOCKED_REORG_FLOAT_DRAG,
  WALL_PADDING,
  MAX_TOTAL_FRAGMENTS,
  BURST_WINDOW_S,
  MAX_BURST_CLICKS,
  LOAD_FRAGMENT_THRESHOLD,
  LOAD_DT_THRESHOLD,
  LOAD_RECOVERY_THRESHOLD,
} from '@/lib/bannerPhysics';

export { DEFAULT_COLOR_STOPS, DEFAULT_CONTROLS };

// Memoized SVG inner element to avoid re-parsing dangerouslySetInnerHTML on every render
const ShapeElement = memo(({ html }: { html: string }) => (
  <g dangerouslySetInnerHTML={{ __html: html }} />
));

// ============================================================================
// PASTE YOUR SVG MARKUP HERE (or pass via svgMarkup prop)
// ============================================================================
const STARTER_SVG = `<svg width="1312" height="380" viewBox="0 0 1312 380" fill="none" xmlns="http://www.w3.org/2000/svg">
<rect x="0"    y="0" width="608" height="380" rx="190" fill="#FFD166"/>
<rect x="622"  y="0" width="290" height="380" rx="145" fill="#FF9E64"/>
<rect x="926"  y="0" width="164" height="380" rx="82"  fill="#FF6E91"/>
<rect x="1104" y="0" width="94"  height="380" rx="47"  fill="#D490D4"/>
<rect x="1212" y="0" width="52"  height="380" rx="26"  fill="#8ABFFF"/>
<rect x="1278" y="0" width="34"  height="380" rx="17"  fill="#A5F3FC"/>
</svg>`;

const MAX_TOTAL_CRACK_LINES = 180;
const SHOW_LOAD_INDICATOR = false;
const CONTROLS_STORAGE_KEY = 'bubblebanner.controls.v3';

function elasticOut(t: number): number {
  if (t === 0) return 0;
  if (t === 1) return 1;
  const c4 = (2 * Math.PI) / 3;
  return Math.pow(2, -10 * t) * Math.sin((t * 4 - 0.3) * c4) + 1;
}

// ============================================================================
// SVG PARSER
// ============================================================================
const parseSVG = (svgMarkup: string): { shapes: Shape[]; viewBox: ViewBox } => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgMarkup, 'image/svg+xml');
  const svg = doc.querySelector('svg');
  
  if (!svg) {
    return { shapes: [], viewBox: { x: 0, y: 0, width: 1312, height: 380 } };
  }

  // Parse viewBox
  const viewBoxAttr = svg.getAttribute('viewBox');
  let viewBox: ViewBox = { x: 0, y: 0, width: 1312, height: 380 };
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
// PRESET ENGINE
// ============================================================================
type PresetKey = 'voronoi';

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
      const shouldStartSettling = controls.disableReorg < 0.5 &&
                                  timeSinceLastClick > settleDelay &&
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
          if (controls.disableWalls) {
            return {
              ...frag,
              vx: newVx,
              vy: newVy,
              vr: newVr,
              offsetX: nextOffsetX,
              offsetY: nextOffsetY,
              rotation: frag.rotation + newVr * dt,
              isExploding: isExplodingNow,
            };
          }
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
          if (controls.disableWalls) {
            return {
              ...frag,
              vx: nextVx,
              vy: nextVy,
              vr: nextVr,
              offsetX: nextOffsetX,
              offsetY: nextOffsetY,
              rotation: frag.rotation + frag.vr * dt,
              isExploding: isExplodingNow,
            };
          }
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
  triggerExplode?: boolean;
  fillViewport?: boolean;
  liveControls?: Partial<Controls>;
  introJiggle?: boolean;
  introJiggleDelayMs?: number;
  introJiggleDurationMs?: number;
  introBounce?: boolean;
  introBounceDelayMs?: number;
  introBounceDurationMs?: number;
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
  triggerExplode,
  fillViewport = false,
  liveControls,
  introJiggle = false,
  introJiggleDelayMs = 220,
  introJiggleDurationMs = 650,
  introBounce = false,
  introBounceDelayMs = 0,
  introBounceDurationMs = 800,
}) => {
  const prefersReducedMotion = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const [activePreset] = useState<PresetKey>('voronoi');
  const [isPaused, setIsPaused] = useState(false);
  const clickBurstRef = useRef<number[]>([]);
  const hasInteractedRef = useRef(false);
  const resetInFlightRef = useRef(false);
  const introJiggleRanRef = useRef(false);
  
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
  const [introJigglePhase, setIntroJigglePhase] = useState(1);
  const [introBouncePhase, setIntroBouncePhase] = useState<number | null>(null);
  const introBounceRanRef = useRef(false);
  
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

  // Programmatic explosion trigger — fires PointerEvents at each shape centroid
  useEffect(() => {
    if (!triggerExplode || !containerRef.current) return;
    const container = containerRef.current;
    // Normalized X centroids based on STARTER_SVG shape layout
    const xPositions = [0.232, 0.585, 0.769, 0.878, 0.944, 0.987];
    xPositions.forEach((normX, i) => {
      setTimeout(() => {
        const r = container.getBoundingClientRect();
        container.dispatchEvent(new PointerEvent('pointerdown', {
          bubbles: true,
          clientX: r.left + normX * r.width,
          clientY: r.top + r.height * 0.5,
          pointerType: 'mouse',
        }));
      }, i * 60);
    });
  }, [triggerExplode]);

  // Optional one-shot "hint" animation on mount for embeds/marketing surfaces.
  useEffect(() => {
    if (!introJiggle || prefersReducedMotion || introJiggleRanRef.current) return;
    introJiggleRanRef.current = true;

    let rafId: number | undefined;
    let timerId: number | undefined;
    let startTime = 0;

    timerId = window.setTimeout(() => {
      setIntroJigglePhase(0);
      startTime = performance.now();
      const tick = (now: number) => {
        const t = clamp((now - startTime) / introJiggleDurationMs, 0, 1);
        setIntroJigglePhase(t);
        if (t < 1) {
          rafId = requestAnimationFrame(tick);
        }
      };
      rafId = requestAnimationFrame(tick);
    }, Math.max(0, introJiggleDelayMs));

    return () => {
      if (timerId !== undefined) window.clearTimeout(timerId);
      if (rafId !== undefined) cancelAnimationFrame(rafId);
    };
  }, [introJiggle, introJiggleDelayMs, introJiggleDurationMs, prefersReducedMotion]);

  // Bounce-in entrance animation
  useEffect(() => {
    if (!introBounce || prefersReducedMotion || introBounceRanRef.current) return;
    introBounceRanRef.current = true;

    let rafId: number | undefined;
    let timerId: number | undefined;
    let startTime = 0;

    timerId = window.setTimeout(() => {
      setIntroBouncePhase(0);
      startTime = performance.now();
      const tick = (now: number) => {
        const t = clamp((now - startTime) / introBounceDurationMs, 0, 1);
        setIntroBouncePhase(t);
        if (t < 1) {
          rafId = requestAnimationFrame(tick);
        }
      };
      rafId = requestAnimationFrame(tick);
    }, Math.max(0, introBounceDelayMs));

    return () => {
      if (timerId !== undefined) window.clearTimeout(timerId);
      if (rafId !== undefined) cancelAnimationFrame(rafId);
    };
  }, [introBounce, introBounceDelayMs, introBounceDurationMs, prefersReducedMotion]);

  // Live controls — merge incoming partial controls into state each time they change
  useEffect(() => {
    if (!liveControls) return;
    setControls(prev => ({ ...prev, ...liveControls }));
  }, [liveControls]);

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
    const jiggleActive = introJiggle && !prefersReducedMotion && introJigglePhase < 1;
    const wiggleEnvelope = jiggleActive ? Math.max(0, 1 - introJigglePhase) : 0;
    const wiggleWaveX = jiggleActive ? Math.sin(introJigglePhase * Math.PI * 6) : 0;

    // Bounce-in: entrance directions for each shape (left → right order)
    const bounceActive = introBounce && !prefersReducedMotion && introBouncePhase !== null && introBouncePhase < 1;
    const BOUNCE_DIRS = [
      { dx: -350, dy: 400 },
      { dx: -350,  dy: 500 },
      { dx: -350,     dy: 500 },
      { dx: -300,     dy: 400 },
      { dx: -250,   dy: 350 },
      { dx: -250,  dy: 300 },
    ];
    const staggerMs = 70;
    const perShapeDurationMs = introBounceDurationMs - staggerMs * Math.max(0, shapes.length - 1);
    const elapsed = bounceActive ? (introBouncePhase ?? 0) * introBounceDurationMs : 0;

    shapes.forEach((shape, index) => {
      const transform = preset.shapeTransform(shape, presetState, pointer, effectiveControls, viewBox);

      if (bounceActive) {
        const dir = BOUNCE_DIRS[Math.min(index, BOUNCE_DIRS.length - 1)];
        const localT = clamp((elapsed - index * staggerMs) / perShapeDurationMs, 0, 1);
        const eased = elasticOut(localT);
        transforms.set(shape.id, {
          ...transform,
          x: transform.x + dir.dx * (1 - eased),
          y: transform.y + dir.dy * (1 - eased),
        });
        return;
      }

      if (!jiggleActive) {
        transforms.set(shape.id, transform);
        return;
      }

      const count = Math.max(1, shapes.length - 1);
      const spreadWeight = 0.7 + (index / count) * 0.35;
      const direction = index % 2 === 0 ? 1 : -1;
      const jiggleX = wiggleWaveX * 6 * wiggleEnvelope * direction * spreadWeight;
      const jiggleY = Math.sin(introJigglePhase * Math.PI * 4 + index * 0.6) * 2 * wiggleEnvelope;
      const constrained = constrainToBounds(
        shape,
        transform.x + jiggleX,
        transform.y + jiggleY,
        transform.scale,
        viewBox
      );

      transforms.set(shape.id, {
        ...transform,
        x: constrained.x,
        y: constrained.y,
      });
    });
    return transforms;
  }, [
    activePreset,
    presetState,
    pointer,
    effectiveControls,
    shapes,
    viewBox,
    introJiggle,
    introJigglePhase,
    introBounce,
    introBouncePhase,
    introBounceDurationMs,
    prefersReducedMotion,
  ]);

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
  const cursorSize = Math.round(58 * cursorScale);
  const cursorHotspot = Math.round(cursorSize / 2);
  const cursorSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cursorSize}" height="${cursorSize}" viewBox="0 0 58 58"><circle cx="29" cy="29" r="28" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.4)" stroke-width="1"/></svg>`;
  const customCursor = `url("data:image/svg+xml,${encodeURIComponent(cursorSvg)}") ${cursorHotspot} ${cursorHotspot}, crosshair`;

  const resetProgress = presetState.returnMode === 'original'
    ? clamp((presetState.clickTime - presetState.returnStartTime) / 0.25, 0, 1)
    : 0;

  return (
    <div className={`relative w-full overflow-visible ${className}`} style={fillViewport ? undefined : { maxWidth: 1312 }}>
      {/* Main Banner */}
      <div
        ref={containerRef}
        className="relative w-full overflow-visible rounded-2xl"
        style={{
          ...(fillViewport ? { height: '100vh' } : { aspectRatio: `${viewBox.width} / ${viewBox.height}` }),
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
          preserveAspectRatio={fillViewport ? "none" : "xMidYMid meet"}
          style={{ display: 'block', willChange: 'transform', overflow: 'visible' }}
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
          <div className="absolute top-2 right-2 rounded-full px-2 py-1 text-[10px] uppercase tracking-wider bg-black/30 dark:bg-black/40 text-white">
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
    <span className="text-muted-foreground text-[10px] whitespace-nowrap">{label}</span>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      className="w-full min-w-0 h-1 rounded-full cursor-pointer"
    />
    <span className="text-right text-surface-foreground text-[10px] tabular-nums whitespace-nowrap">{formatValue(value)}</span>
  </div>
);

// Export preset info for external control panels
export const PRESET_INFO: Record<PresetKey, { name: string; description: string }> = {
  voronoi: { name: 'Voronoi Shatter', description: 'Click shapes to shatter them into pieces' },
};

export type { PresetKey, Controls, ControlPanelProps };
export default InteractiveHeroBanner;
