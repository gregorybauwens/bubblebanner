/**
 * InteractiveTypeBanner
 *
 * Applies the bubble banner's color gradient, hover parallax, click-to-shatter
 * physics, and spring-based motion to individual letters in a text string.
 * Each letter behaves like an interactive shape from InteractiveHeroBanner.
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
  clamp,
  smoothstep,
  distance,
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

// Memoized SVG element renderer
const ShapeElement = memo(({ html }: { html: string }) => (
  <g dangerouslySetInnerHTML={{ __html: html }} />
));

const CONTROLS_STORAGE_KEY = 'bubblebanner.type.controls.v1';
const FONT_FAMILY = 'Inter';
const FONT_WEIGHT = 900;
const FONT_SIZE = 180; // in viewBox units
const LINE_SPACING = 0.89; // 89% line height — tight, lines nearly touch
const PADDING_X = 10;
const PADDING_Y = 10;
const LETTER_SPACING = -0.01; // -1% of font size (negative tracking)

// ============================================================================
// LETTER MEASUREMENT & SHAPE CREATION
// ============================================================================
interface LetterShape extends Shape {
  char: string;
  lineIndex: number;
}

const measureLetters = (
  text: string,
  fontFamily: string,
  fontWeight: number,
  fontSize: number,
  letterSpacing: number
): { letters: LetterShape[]; viewBox: ViewBox } => {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  ctx.font = `${fontWeight} ${fontSize}px "${fontFamily}"`;

  const lines = text.split(' ');
  const letters: LetterShape[] = [];

  // Convert fractional letter spacing to viewBox units
  const spacingPx = letterSpacing * fontSize;

  // Measure each line's total width
  const lineMetrics = lines.map((line) => {
    let totalWidth = 0;
    const charWidths: number[] = [];
    for (const char of line) {
      const m = ctx.measureText(char);
      charWidths.push(m.width);
      totalWidth += m.width + spacingPx;
    }
    totalWidth -= spacingPx; // no spacing after last char
    return { line, totalWidth, charWidths };
  });

  const maxLineWidth = Math.max(...lineMetrics.map((l) => l.totalWidth));
  const totalWidth = maxLineWidth + PADDING_X * 2;
  // First line starts at its baseline, subsequent lines offset by lineHeight
  const lineHeight = fontSize * LINE_SPACING;
  const ascent = fontSize * 0.72;
  const descent = fontSize * 0.22;
  const totalHeight = ascent + (lines.length - 1) * lineHeight + descent + PADDING_Y * 2;
  const viewBox: ViewBox = { x: 0, y: 0, width: totalWidth, height: totalHeight };

  let letterIndex = 0;
  lineMetrics.forEach(({ line, totalWidth: lineWidth, charWidths }, lineIdx) => {
    // Center this line horizontally
    let cursorX = (totalWidth - lineWidth) / 2;
    const baselineY = PADDING_Y + ascent + lineIdx * lineHeight;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const charWidth = charWidths[i];

      // Bounds: approximate letter bounding box
      const boundsY = baselineY - ascent;
      const boundsHeight = ascent + descent;

      const bounds = {
        x: cursorX,
        y: boundsY,
        width: charWidth,
        height: boundsHeight,
      };

      const centroid = {
        x: bounds.x + bounds.width / 2,
        y: bounds.y + bounds.height / 2,
      };

      const fill = '#ECB300'; // placeholder - gets overridden by color mapping

      const element = `<text x="${cursorX}" y="${baselineY}" font-family="${fontFamily}" font-weight="${fontWeight}" font-size="${fontSize}" fill="${fill}">${char}</text>`;

      letters.push({
        id: `letter-${letterIndex}`,
        type: 'text',
        element,
        attrs: {
          x: cursorX.toString(),
          y: baselineY.toString(),
          fill,
          'font-family': fontFamily,
          'font-weight': fontWeight.toString(),
          'font-size': fontSize.toString(),
        },
        centroid,
        bounds,
        fill,
        lineIndex: lineIdx,
        char,
      });

      cursorX += charWidth + spacingPx;
      letterIndex++;
    }
  });

  return { letters, viewBox };
};

// Apply color stops to letters per-line
const colorizeLetters = (letters: LetterShape[], colorStops: string[]): LetterShape[] => {
  const stops = colorStops.length > 0 ? colorStops : DEFAULT_COLOR_STOPS;
  const k = Math.max(1, stops.length);

  // Group by line for per-line color sweep
  const lineGroups = new Map<number, LetterShape[]>();
  letters.forEach((l) => {
    const group = lineGroups.get(l.lineIndex) ?? [];
    group.push(l);
    lineGroups.set(l.lineIndex, group);
  });

  const colored: LetterShape[] = [];
  lineGroups.forEach((group) => {
    const sorted = group.slice().sort((a, b) => a.centroid.x - b.centroid.x);
    const n = sorted.length;
    sorted.forEach((letter, i) => {
      const stopIndex = n === 1 ? 0 : Math.round((i * (k - 1)) / (n - 1));
      const color = stops[Math.min(k - 1, Math.max(0, stopIndex))] ?? stops[0];
      const updatedElement = letter.element.replace(/fill="[^"]*"/, `fill="${color}"`);
      colored.push({
        ...letter,
        fill: color,
        attrs: { ...letter.attrs, fill: color },
        element: updatedElement,
      });
    });
  });

  // Sort back by original index
  colored.sort((a, b) => {
    const idxA = parseInt(a.id.split('-')[1]);
    const idxB = parseInt(b.id.split('-')[1]);
    return idxA - idxB;
  });

  return colored;
};

// ============================================================================
// PHYSICS UPDATE (same logic as InteractiveHeroBanner voronoi preset)
// ============================================================================
const updatePhysics = (
  state: PresetState,
  dt: number,
  _pointer: { x: number; y: number } | null,
  controls: Controls,
  _shapes: Shape[],
  viewBox: ViewBox
): PresetState => {
  const newClickTime = state.clickTime + dt;
  const settleDelay = controls.settleTime;

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

  let newState: PresetState = {
    ...state,
    clickTime: newClickTime,
    isReturning: state.isReturning || shouldStartSettling,
    returnStartTime: nextReturnStartTime,
    returnMode: shouldStartSettling ? 'grid' : state.returnMode,
    reorgPhase: nextReorgPhase,
  };

  // Grid calculations
  const gutter = 16;
  const fragmentCount = state.shardFragments.length;
  const cols = Math.ceil(Math.sqrt(fragmentCount * (viewBox.width / viewBox.height)));
  const rows = Math.ceil(fragmentCount / cols);
  const cellWidth = (viewBox.width - gutter * (cols + 1)) / cols;
  const cellHeight = (viewBox.height - gutter * (rows + 1)) / rows;

  let finalTargets = newState.cachedGridTargets;
  if (!finalTargets || shouldStartSettling) {
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
        const { col } = finalTargets![index] || { col: 0 };
        const targetCenterX = gutter + col * (cellWidth + gutter) + cellWidth / 2;
        return targetCenterX - frag.shape.centroid.x;
      })();
      const targetY = newState.returnMode === 'original' ? 0 : (() => {
        const { row } = finalTargets![index] || { row: 0 };
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
        const returnElapsed = Math.max(0, newClickTime - state.returnStartTime);
        const returnEase = smoothstep(clamp(returnElapsed / 0.6, 0, 1));
        const springForce = controls.returnSpring * 6 * returnEase;
        const damping = Math.max(0.5, 0.95 - controls.settleDamping * 0.225);
        newVx = frag.vx * damping + diffX * springForce * dt * 60;
        newVy = frag.vy * damping + diffY * springForce * dt * 60;
        newVr = frag.vr * damping - frag.rotation * springForce * dt * 30;
      }

      const speed = Math.hypot(newVx, newVy);
      const distToTarget = Math.hypot(diffX, diffY);
      const isSettled = newState.returnMode === 'grid' &&
        newState.reorgPhase === 'settle' &&
        distToTarget < 80 &&
        speed < 400;

      if (isSettled) {
        return {
          ...frag,
          vx: 0, vy: 0, vr: 0,
          offsetX: targetX, offsetY: targetY,
          rotation: 0, isExploding: false,
        };
      }

      const nextOffsetX = frag.offsetX + newVx * dt;
      const nextOffsetY = frag.offsetY + newVy * dt;
      if (controls.disableWalls) {
        return {
          ...frag,
          vx: newVx, vy: newVy, vr: newVr,
          offsetX: nextOffsetX, offsetY: nextOffsetY,
          rotation: frag.rotation + newVr * dt,
          isExploding: isExplodingNow,
        };
      }
      const bounced = bounceWithinBounds(
        frag.shape, nextOffsetX, nextOffsetY, newVx, newVy, newVr,
        viewBox, WALL_PADDING,
        controls.wallRestitution, controls.wallFriction, controls.wallSpinDamping
      );
      return {
        ...frag,
        vx: bounced.vx, vy: bounced.vy, vr: bounced.vr,
        offsetX: bounced.x, offsetY: bounced.y,
        rotation: frag.rotation + newVr * dt,
        isExploding: isExplodingNow,
      };
    } else if (isExplodingNow) {
      const damping = 0.97;
      const nextOffsetX = frag.offsetX + frag.vx * dt;
      const nextOffsetY = frag.offsetY + frag.vy * dt;
      const nextVx = frag.vx * damping;
      const nextVy = frag.vy * damping;
      const nextVr = frag.vr * damping;
      if (controls.disableWalls) {
        return {
          ...frag,
          vx: nextVx, vy: nextVy, vr: nextVr,
          offsetX: nextOffsetX, offsetY: nextOffsetY,
          rotation: frag.rotation + frag.vr * dt,
          isExploding: isExplodingNow,
        };
      }
      const bounced = bounceWithinBounds(
        frag.shape, nextOffsetX, nextOffsetY, nextVx, nextVy, nextVr,
        viewBox, WALL_PADDING,
        controls.wallRestitution, controls.wallFriction, controls.wallSpinDamping
      );
      return {
        ...frag,
        vx: bounced.vx, vy: bounced.vy, vr: bounced.vr,
        offsetX: bounced.x, offsetY: bounced.y,
        rotation: frag.rotation + frag.vr * dt,
        isExploding: isExplodingNow,
      };
    }
    return { ...frag, isExploding: isExplodingNow };
  });

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
};

// Shape transform (hover parallax)
const computeShapeTransform = (
  shape: Shape,
  _state: PresetState,
  pointer: { x: number; y: number } | null,
  controls: Controls,
  viewBox: ViewBox
): ShapeTransform => {
  let x = 0;
  let y = 0;

  if (pointer) {
    const shapeNormX = shape.centroid.x / viewBox.width;
    const shapeNormY = shape.centroid.y / viewBox.height;
    const hoverDist = distance(shapeNormX, shapeNormY, pointer.x, pointer.y);
    const hoverInfluence = Math.max(0, 1 - hoverDist / controls.hoverRadius) * controls.hoverStrength;
    x += (pointer.x - shapeNormX) * hoverInfluence * viewBox.width * 0.25;
    y += (pointer.y - shapeNormY) * hoverInfluence * viewBox.height * 0.25;
  }

  const constrained = constrainToBounds(shape, x, y, 1, viewBox);
  return { x: constrained.x, y: constrained.y, scale: 1, rotate: 0, opacity: 1, filterStrength: 0, brightness: 1 };
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================
export interface ControlPanelProps {
  controls: Controls;
  updateControl: (key: keyof Controls, value: number) => void;
  onReset: () => void;
  isPaused: boolean;
  setIsPaused: (paused: boolean) => void;
}

interface InteractiveTypeBannerProps {
  text?: string;
  className?: string;
  renderControls?: (props: ControlPanelProps) => React.ReactNode;
  colorStops?: string[];
  onFirstInteraction?: () => void;
  onResetComplete?: () => void;
  initialControls?: Partial<Controls>;
  persistControls?: boolean;
}

const InteractiveTypeBanner: React.FC<InteractiveTypeBannerProps> = ({
  text = 'GREGORY BAUWENS',
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
  const [isPaused, setIsPaused] = useState(false);
  const clickBurstRef = useRef<number[]>([]);
  const hasInteractedRef = useRef(false);
  const resetInFlightRef = useRef(false);
  const [fontReady, setFontReady] = useState(false);

  // Wait for font to load
  useEffect(() => {
    document.fonts.ready.then(() => {
      // Check if Inter 900 is available
      if (document.fonts.check(`${FONT_WEIGHT} ${FONT_SIZE}px "${FONT_FAMILY}"`)) {
        setFontReady(true);
      } else {
        // Fallback: wait a bit and try again, or just use whatever is available
        setTimeout(() => setFontReady(true), 500);
      }
    });
  }, []);

  // Measure letters and build shapes
  const { letters: rawLetters, viewBox } = useMemo(() => {
    if (!fontReady) return { letters: [], viewBox: { x: 0, y: 0, width: 1000, height: 400 } };
    return measureLetters(text, FONT_FAMILY, FONT_WEIGHT, FONT_SIZE, LETTER_SPACING);
  }, [text, fontReady]);

  // Apply colors
  const stops = colorStops && colorStops.length > 0 ? colorStops : DEFAULT_COLOR_STOPS;
  const letters = useMemo(() => {
    if (rawLetters.length === 0) return [];
    return colorizeLetters(rawLetters, stops);
  }, [rawLetters, stops]);

  // Controls state
  const [controls, setControls] = useState<Controls>(() => {
    const baseControls: Controls = {
      ...DEFAULT_CONTROLS,
      ...(initialControls ?? {}),
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

  useEffect(() => { presetStateRef.current = presetState; }, [presetState]);
  useEffect(() => { pointerRef.current = pointer; }, [pointer]);

  const effectiveControls = useMemo(() => {
    if (!isUnderLoad) return controls;
    return { ...controls, hoverStrength: 0, hoverRadius: 0.0001 };
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
    const point = {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    };

    const now = performance.now() / 1000;
    const { burstFactor, cursorScale } = getBurstMetrics(now, true);
    const pressureFactor = getPressureFactor(e);
    const shatterScale = clamp(burstFactor * pressureFactor, 0.85, 2.4);

    if (presetState.returnMode === 'original') return;

    const clickX = point.x * viewBox.width;
    const clickY = point.y * viewBox.height;

    const cursorRadiusPx = 29 * cursorScale;
    const cursorRadiusX = (cursorRadiusPx / rect.width) * viewBox.width;
    const cursorRadiusY = (cursorRadiusPx / rect.height) * viewBox.height;
    const cursorRadius = Math.max(cursorRadiusX, cursorRadiusY);

    // Build clickable shapes list (letters + fragments)
    const clickableShapes: Shape[] = [];

    letters.forEach(letter => {
      if (!presetState.shatteredShapeIds.has(letter.id)) {
        const transform = shapeTransforms.get(letter.id);
        const offsetX = transform?.x ?? 0;
        const offsetY = transform?.y ?? 0;
        clickableShapes.push({
          ...letter,
          bounds: {
            x: letter.bounds.x + offsetX,
            y: letter.bounds.y + offsetY,
            width: letter.bounds.width,
            height: letter.bounds.height,
          },
          centroid: {
            x: letter.centroid.x + offsetX,
            y: letter.centroid.y + offsetY,
          },
        });
      }
    });

    const hitSmoothedPtr = smoothPointerRef.current;
    presetState.shardFragments.forEach(frag => {
      let hoverX = 0, hoverY = 0;
      if (hitSmoothedPtr && !isUnderLoad) {
        const fragNormX = (frag.shape.centroid.x + frag.offsetX) / viewBox.width;
        const fragNormY = (frag.shape.centroid.y + frag.offsetY) / viewBox.height;
        const hoverDist = distance(fragNormX, fragNormY, hitSmoothedPtr.x, hitSmoothedPtr.y);
        const hoverInfluence = Math.max(0, 1 - hoverDist / effectiveControls.hoverRadius) * effectiveControls.hoverStrength;
        hoverX = (hitSmoothedPtr.x - fragNormX) * hoverInfluence * viewBox.width * 0.25;
        hoverY = (hitSmoothedPtr.y - fragNormY) * hoverInfluence * viewBox.height * 0.25;
      }
      clickableShapes.push({
        ...frag.shape,
        bounds: {
          x: frag.shape.bounds.x + frag.offsetX + hoverX,
          y: frag.shape.bounds.y + frag.offsetY + hoverY,
          width: frag.shape.bounds.width,
          height: frag.shape.bounds.height,
        },
        centroid: {
          x: frag.shape.centroid.x + frag.offsetX + hoverX,
          y: frag.shape.centroid.y + frag.offsetY + hoverY,
        },
      });
    });

    // Hit test
    const hitShapes: Shape[] = [];
    for (let i = clickableShapes.length - 1; i >= 0; i--) {
      const shape = clickableShapes[i];
      const b = shape.bounds;
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
          hitShape, point, viewBox, controls, generation,
          presetState.clickTime, effectiveShatterScale
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
    }
  }, [controls, letters, viewBox, presetState, effectiveControls, isUnderLoad, onFirstInteraction]);

  const handleReset = useCallback(() => {
    setPresetState(prev => {
      if (prev.returnMode === 'original' && prev.isReturning) return prev;
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
      if (event.key.toLowerCase() === 'r' && !event.repeat) handleReset();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
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

  // Animation loop
  useEffect(() => {
    if (prefersReducedMotion || isPaused || !fontReady) return;

    const animate = (time: number) => {
      const dt = lastTimeRef.current ? Math.min((time - lastTimeRef.current) / 1000, 0.1) : 0.016;
      lastTimeRef.current = time;

      setPresetState(prev => updatePhysics(prev, dt * controls.timeScale, pointerRef.current, effectiveControls, letters, viewBox));

      const currentPointer = pointerRef.current;
      if (currentPointer) {
        if (smoothPointerRef.current) {
          const lerpFactor = 1 - Math.pow(0.001, dt);
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
      if (!isUnderLoad && overload) setIsUnderLoad(true);
      else if (isUnderLoad && recovered) setIsUnderLoad(false);

      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [controls.timeScale, effectiveControls, letters, prefersReducedMotion, isPaused, isUnderLoad, viewBox, fontReady]);

  // Calculate transforms
  const shapeTransforms = useMemo(() => {
    const transforms = new Map<string, ShapeTransform>();
    letters.forEach(letter => {
      const transform = computeShapeTransform(letter, presetState, pointer, effectiveControls, viewBox);
      transforms.set(letter.id, transform);
    });
    return transforms;
  }, [presetState, pointer, effectiveControls, letters, viewBox]);

  // Control updater
  const updateControl = (key: keyof Controls, value: number) => {
    if (key === 'floatStrength' || key === 'floatDrag') return;
    setControls(prev => ({ ...prev, [key]: value }));
  };

  useEffect(() => {
    if (!persistControls) return;
    try {
      window.localStorage.setItem(CONTROLS_STORAGE_KEY, JSON.stringify(controls));
    } catch { /* ignore */ }
  }, [controls, persistControls]);

  const { cursorScale } = getBurstMetrics(performance.now() / 1000, false);
  const cursorSize = Math.round(58 * cursorScale);
  const cursorHotspot = Math.round(cursorSize / 2);
  const cursorSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cursorSize}" height="${cursorSize}" viewBox="0 0 58 58"><circle cx="29" cy="29" r="28" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.4)" stroke-width="1"/></svg>`;
  const customCursor = `url("data:image/svg+xml,${encodeURIComponent(cursorSvg)}") ${cursorHotspot} ${cursorHotspot}, crosshair`;

  const resetProgress = presetState.returnMode === 'original'
    ? clamp((presetState.clickTime - presetState.returnStartTime) / 0.25, 0, 1)
    : 0;

  if (!fontReady) return null;

  return (
    <div className={`relative w-full ${className}`} style={{ maxWidth: viewBox.width }}>
      <div
        ref={containerRef}
        className="relative w-full overflow-visible rounded-2xl"
        style={{
          aspectRatio: `${viewBox.width} / ${viewBox.height}`,
          background: 'transparent',
          cursor: customCursor,
          userSelect: 'none',
          WebkitUserSelect: 'none',
        }}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        onPointerDown={handlePointerDown}
        onDragStart={(e) => e.preventDefault()}
        onSelectStart={(e) => e.preventDefault()}
      >
        <svg
          width="100%"
          height="100%"
          viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
          preserveAspectRatio="xMidYMid meet"
          style={{ display: 'block', willChange: 'transform', overflow: 'visible', userSelect: 'none', WebkitUserSelect: 'none' }}
        >
          {/* Render letters */}
          {letters.map((letter) => {
            if (presetState.shatteredShapeIds.has(letter.id) && presetState.returnMode !== 'original') {
              return null;
            }

            const transform = shapeTransforms.get(letter.id) || { x: 0, y: 0, scale: 1, rotate: 0, opacity: 1, filterStrength: 0, brightness: 1 };

            return (
              <motion.g
                key={letter.id}
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
                  transformOrigin: `${letter.centroid.x}px ${letter.centroid.y}px`,
                }}
              >
                <text
                  x={letter.attrs.x}
                  y={letter.attrs.y}
                  fontFamily={FONT_FAMILY}
                  fontWeight={FONT_WEIGHT}
                  fontSize={FONT_SIZE}
                  fill={letter.fill}
                >
                  {letter.char}
                </text>
              </motion.g>
            );
          })}

          {/* Render fragments */}
          {presetState.shardFragments.map((frag) => {
            const centerX = frag.shape.centroid.x;
            const centerY = frag.shape.centroid.y;

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
      </div>

      {renderControls && renderControls({
        controls,
        updateControl,
        onReset: handleReset,
        isPaused,
        setIsPaused,
      })}
    </div>
  );
};

export default InteractiveTypeBanner;
