/**
 * InteractiveHeroBanner
 *
 * An interactive SVG banner. Click a shape to shatter it into Voronoi pieces
 * that tumble under gravity; grab and fling pieces, click them to break them
 * further, and press Reset (or wait) to watch them fly back together.
 *
 * HOW TO USE:
 * 1. Replace STARTER_SVG below with your SVG markup, OR
 * 2. Pass svgMarkup prop: <InteractiveHeroBanner svgMarkup={yourSvgString} />
 */

import React, { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import {
  type Shape,
  type ViewBox,
  type Controls,
  DEFAULT_COLOR_STOPS,
  DEFAULT_CONTROLS as BASE_DEFAULT_CONTROLS,
  clamp,
  distance,
  applyFillToShape,
  constrainToBounds,
  BURST_WINDOW_S,
  MAX_BURST_CLICKS,
} from '@/lib/bannerPhysics';
import { pointInPolygon, shapeOutline } from '@/lib/shatterGeometry';
import { ShatterEngine, type EngineSettings, type EngineShape, type PieceView } from '@/lib/shatterEngine';

export const DEFAULT_CONTROLS: Controls = {
  ...BASE_DEFAULT_CONTROLS,
  hoverStrength: 1,
  spring: 0.9,
  damping: 0.5,
  shardSpread: 1.4,
  explosionForce: 1.5,
  gravity: 0.7,
  settleTime: 3.7,
  disableReorg: 1,
};

export { DEFAULT_COLOR_STOPS };

// Memoized SVG inner element to avoid re-parsing dangerouslySetInnerHTML on every render
const ShapeElement = memo(({ html }: { html: string }) => (
  <g dangerouslySetInnerHTML={{ __html: html }} />
));

// ============================================================================
// PASTE YOUR SVG MARKUP HERE (or pass via svgMarkup prop)
// ============================================================================
const STARTER_SVG = `<svg width="1440" height="380" viewBox="0 0 1440 380" fill="none" xmlns="http://www.w3.org/2000/svg">
<rect x="0"    y="0" width="710" height="380" rx="190"   fill="#FFD166"/>
<rect x="730"  y="0" width="345" height="380" rx="172.5" fill="#FF9E64"/>
<rect x="1095" y="0" width="152" height="380" rx="76"    fill="#FF6E91"/>
<rect x="1267" y="0" width="76"  height="380" rx="38"    fill="#D490D4"/>
<rect x="1363" y="0" width="38"  height="380" rx="19"    fill="#8ABFFF"/>
<rect x="1421" y="0" width="19"  height="380" rx="9.5"   fill="#A5F3FC"/>
</svg>`;

const CONTROLS_STORAGE_KEY = 'bubblebanner.controls.v3';
const DRAG_THRESHOLD_PX = 6;
const PROGRAMMATIC_STAGGER_MS = 60;

// The cursor image never changes: swapping it at runtime makes browsers flash
// the fallback cursor while the new image decodes.
const CURSOR_RADIUS_PX = 12;
const CURSOR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><circle cx="14" cy="14" r="${CURSOR_RADIUS_PX}" fill="rgba(255,255,255,0.22)" stroke="#E6E6E6" stroke-width="1.5"/></svg>`;
const CUSTOM_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(CURSOR_SVG)}") 14 14, crosshair`;

// Intro entrance — Editorial glide. Overdamped spring + tight rest thresholds so
// shapes arrive clean with no subpixel tail. Opacity fades up on its own tween so
// the final moments are pure position settling.
const INTRO_Y_OFFSET = 140;
const INTRO_STAGGER_MS = 90;
const INTRO_SPRING = {
  type: 'spring' as const,
  stiffness: 85,
  damping: 32,
  mass: 1.5,
  restSpeed: 0.5,
  restDelta: 0.5,
};
const INTRO_OPACITY_TWEEN = {
  type: 'tween' as const,
  duration: 0.45,
  ease: [0.22, 1, 0.36, 1] as const,
};

// ============================================================================
// SVG PARSER
// ============================================================================
const parseSVG = (svgMarkup: string): { shapes: Shape[]; viewBox: ViewBox } => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgMarkup, 'image/svg+xml');
  const svg = doc.querySelector('svg');

  if (!svg) {
    return { shapes: [], viewBox: { x: 0, y: 0, width: 1440, height: 380 } };
  }

  const viewBoxAttr = svg.getAttribute('viewBox');
  let viewBox: ViewBox = { x: 0, y: 0, width: 1440, height: 380 };
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
    case 'polygon':
    case 'polyline': {
      const values = (attrs.points || '').trim().split(/[\s,]+/).map(Number).filter(Number.isFinite);
      const xs = values.filter((_, i) => i % 2 === 0);
      const ys = values.filter((_, i) => i % 2 === 1);
      if (xs.length === 0 || ys.length === 0) return { x: 0, y: 0, width: 100, height: 100 };
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
    }
    default:
      return { x: 0, y: 0, width: 100, height: 100 };
  }
};

// ============================================================================
// HOVER
// ============================================================================
const computeHoverOffset = (
  shape: Shape,
  pointer: { x: number; y: number } | null,
  controls: Controls,
  viewBox: ViewBox
) => {
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
  return constrainToBounds(shape, x, y, 1, viewBox);
};

const toEngineSettings = (controls: Controls, reducedMotion: boolean, paused: boolean): EngineSettings => ({
  gravity: controls.gravity ?? BASE_DEFAULT_CONTROLS.gravity,
  restitution: clamp(controls.wallRestitution, 0, 0.95),
  friction: clamp(controls.wallFriction * 0.5, 0, 1),
  walls: !controls.disableWalls,
  timeScale: controls.timeScale,
  explosionForce: controls.explosionForce,
  shardSpread: controls.shardSpread,
  explosionSpin: controls.explosionSpin,
  returnSpring: controls.returnSpring,
  settleDamping: controls.settleDamping,
  reducedMotion,
  paused,
});

// Pieces are positioned imperatively by the engine; this layer only re-renders
// when pieces are created or removed.
const PiecesLayer = memo(({
  pieces,
  getRef,
}: {
  pieces: PieceView[];
  getRef: (id: string) => (el: SVGGElement | null) => void;
}) => (
  <g>
    {pieces.map((piece) => (
      <g key={piece.id} ref={getRef(piece.id)}>
        <path d={piece.d} fill={piece.fill} stroke={piece.fill} strokeWidth={0.75} strokeLinejoin="round" />
      </g>
    ))}
  </g>
));

// ============================================================================
// MAIN COMPONENT
// ============================================================================
type PresetKey = 'voronoi';

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

interface PendingPress {
  pieceId: string;
  pointerId: number;
  clientX: number;
  clientY: number;
  point: { x: number; y: number };
  radius: number;
  scale: number;
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
}) => {
  const prefersReducedMotion = useReducedMotion() ?? false;
  const containerRef = useRef<HTMLDivElement>(null);
  const [activePreset] = useState<PresetKey>('voronoi');
  const [isPaused, setIsPaused] = useState(false);
  const clickBurstRef = useRef<number[]>([]);
  const hasInteractedRef = useRef(false);
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

  const engineShapes = useMemo<EngineShape[]>(
    () => shapes.map((shape) => ({ id: shape.id, outline: shapeOutline(shape), fill: shape.fill || '#ECB300' })),
    [shapes]
  );

  // Controls state
  const [controls, setControls] = useState<Controls>(() => {
    const baseControls: Controls = { ...DEFAULT_CONTROLS, ...(initialControls ?? {}) };
    if (!persistControls) return baseControls;
    if (typeof window === 'undefined') return baseControls;
    try {
      const saved = window.localStorage.getItem(CONTROLS_STORAGE_KEY);
      if (!saved) return baseControls;
      return { ...baseControls, ...(JSON.parse(saved) as Partial<Controls>) };
    } catch {
      return baseControls;
    }
  });

  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const [pieceViews, setPieceViews] = useState<PieceView[]>([]);
  const [shatteredIds, setShatteredIds] = useState<Set<string>>(() => new Set());
  const [introJigglePhase, setIntroJigglePhase] = useState(1);
  const [hasEntered, setHasEntered] = useState(false);
  const hasPieces = pieceViews.length > 0;

  const engineRef = useRef<ShatterEngine | null>(null);
  const pendingRef = useRef<PendingPress | null>(null);
  const draggingRef = useRef(false);
  const autoRebuildTimerRef = useRef<number | undefined>(undefined);
  const pieceRefCallbacks = useRef(new Map<string, (el: SVGGElement | null) => void>());

  const engineSettings = useMemo(
    () => toEngineSettings(controls, prefersReducedMotion, isPaused),
    [controls, prefersReducedMotion, isPaused]
  );

  const latest = useRef({ controls, engineSettings, engineShapes, onFirstInteraction, onResetComplete });
  latest.current = { controls, engineSettings, engineShapes, onFirstInteraction, onResetComplete };

  // Engine lifecycle — one engine per viewBox
  useEffect(() => {
    const engine = new ShatterEngine(
      viewBox,
      {
        onChange: ({ pieces, shattered }) => {
          setPieceViews(pieces);
          setShatteredIds(new Set(shattered));
        },
        onAllRestored: () => {
          if (!hasInteractedRef.current) return;
          hasInteractedRef.current = false;
          latest.current.onResetComplete?.();
        },
      },
      latest.current.engineSettings,
      latest.current.engineShapes
    );
    engineRef.current = engine;
    return () => {
      engine.destroy();
      engineRef.current = null;
      setPieceViews([]);
      setShatteredIds(new Set());
    };
  }, [viewBox]);

  useEffect(() => {
    engineRef.current?.setShapes(engineShapes);
  }, [engineShapes]);

  useEffect(() => {
    engineRef.current?.setSettings(engineSettings);
  }, [engineSettings]);

  const getPieceRef = useCallback((id: string) => {
    let callback = pieceRefCallbacks.current.get(id);
    if (!callback) {
      callback = (el: SVGGElement | null) => {
        engineRef.current?.registerElement(id, el);
        if (!el) pieceRefCallbacks.current.delete(id);
      };
      pieceRefCallbacks.current.set(id, callback);
    }
    return callback;
  }, []);

  const markInteraction = useCallback(() => {
    if (hasInteractedRef.current) return;
    hasInteractedRef.current = true;
    latest.current.onFirstInteraction?.();
  }, []);

  const clearAutoRebuild = useCallback(() => {
    window.clearTimeout(autoRebuildTimerRef.current);
    autoRebuildTimerRef.current = undefined;
  }, []);

  const scheduleAutoRebuild = useCallback(() => {
    clearAutoRebuild();
    const { disableReorg, settleTime } = latest.current.controls;
    if (disableReorg >= 0.5) return;
    autoRebuildTimerRef.current = window.setTimeout(() => {
      const engine = engineRef.current;
      if (!engine || !engine.hasPieces()) return;
      if (draggingRef.current || pendingRef.current) {
        scheduleAutoRebuild();
        return;
      }
      engine.reassemble();
    }, Math.max(0, settleTime) * 1000);
  }, [clearAutoRebuild]);

  useEffect(() => {
    if (hasPieces) scheduleAutoRebuild();
    else clearAutoRebuild();
  }, [controls.disableReorg, controls.settleTime, hasPieces, scheduleAutoRebuild, clearAutoRebuild]);

  useEffect(() => clearAutoRebuild, [clearAutoRebuild]);

  // Optional one-shot "hint" animation on mount for embeds/marketing surfaces.
  useEffect(() => {
    if (!introJiggle || prefersReducedMotion || introJiggleRanRef.current) return;
    introJiggleRanRef.current = true;

    let rafId: number | undefined;
    let startTime = 0;

    const timerId = window.setTimeout(() => {
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
      window.clearTimeout(timerId);
      if (rafId !== undefined) cancelAnimationFrame(rafId);
    };
  }, [introJiggle, introJiggleDelayMs, introJiggleDurationMs, prefersReducedMotion]);

  // Mark the entrance as done immediately when the banner should not animate in.
  // When `introBounce` is active, `hasEntered` flips via `onAnimationComplete` on the
  // last shape, which swaps each <motion.g>'s transition from the entrance spring to
  // the normal hover spring.
  useEffect(() => {
    if (!introBounce || prefersReducedMotion) {
      setHasEntered(true);
    }
  }, [introBounce, prefersReducedMotion]);

  // Live controls — merge incoming partial controls into state each time they change
  useEffect(() => {
    if (!liveControls) return;
    setControls(prev => ({ ...prev, ...liveControls }));
  }, [liveControls]);

  // Hover transforms for whole shapes. Hover is suspended while pieces exist so
  // the shapes stay where their colliders are.
  const shapeTransforms = useMemo(() => {
    const transforms = new Map<string, { x: number; y: number }>();
    const jiggleActive = introJiggle && !prefersReducedMotion && introJigglePhase < 1;
    const wiggleEnvelope = jiggleActive ? Math.max(0, 1 - introJigglePhase) : 0;
    const wiggleWaveX = jiggleActive ? Math.sin(introJigglePhase * Math.PI * 6) : 0;
    const hoverPointer = hasEntered && !hasPieces ? pointer : null;

    shapes.forEach((shape, index) => {
      const hover = computeHoverOffset(shape, hoverPointer, controls, viewBox);
      if (!jiggleActive) {
        transforms.set(shape.id, hover);
        return;
      }
      const count = Math.max(1, shapes.length - 1);
      const spreadWeight = 0.7 + (index / count) * 0.35;
      const direction = index % 2 === 0 ? 1 : -1;
      const jiggleX = wiggleWaveX * 6 * wiggleEnvelope * direction * spreadWeight;
      const jiggleY = Math.sin(introJigglePhase * Math.PI * 4 + index * 0.6) * 2 * wiggleEnvelope;
      transforms.set(shape.id, constrainToBounds(shape, hover.x + jiggleX, hover.y + jiggleY, 1, viewBox));
    });
    return transforms;
  }, [shapes, pointer, controls, viewBox, introJiggle, introJigglePhase, prefersReducedMotion, hasEntered, hasPieces]);

  const getBurstMetrics = (now: number, includeNow: boolean) => {
    const recent = clickBurstRef.current.filter((t) => now - t <= BURST_WINDOW_S);
    if (includeNow) recent.push(now);
    clickBurstRef.current = recent;
    const burstClicks = Math.min(recent.length, MAX_BURST_CLICKS);
    return clamp(1 + Math.max(0, burstClicks - 1) * 0.425, 1, 3.825);
  };

  const getPressureFactor = (event: React.PointerEvent) => {
    if (event.pointerType === 'mouse') return 1;
    if (typeof event.pressure !== 'number' || event.pressure <= 0) return 1;
    return clamp(0.85 + event.pressure * 0.75, 0.85, 1.6);
  };

  const toViewBoxPoint = (clientX: number, clientY: number) => {
    const rect = containerRef.current!.getBoundingClientRect();
    return {
      rect,
      point: {
        x: viewBox.x + ((clientX - rect.left) / rect.width) * viewBox.width,
        y: viewBox.y + ((clientY - rect.top) / rect.height) * viewBox.height,
      },
    };
  };

  /** Breaks exactly one target: the piece or shape under the pointer, else the nearest one within `radius`. */
  const shatterAt = (point: { x: number; y: number }, radius: number, scale: number, pressedPieceId?: string) => {
    const engine = engineRef.current;
    if (!engine) return;
    const pieceIds = engine.queryPieces(point, radius);
    const directPiece = pressedPieceId ?? engine.pieceAt(point);
    if (directPiece && engine.shatterPiece(directPiece, point, scale)) return;

    const outlines = new Map(engineShapes.map((s) => [s.id, s.outline]));
    let nearestShape: { id: string; distance: number } | null = null;
    for (let i = shapes.length - 1; i >= 0; i--) {
      const shape = shapes[i];
      if (shatteredIds.has(shape.id)) continue;
      const offset = shapeTransforms.get(shape.id) ?? { x: 0, y: 0 };
      const outline = outlines.get(shape.id);
      if (outline && pointInPolygon({ x: point.x - offset.x, y: point.y - offset.y }, outline)) {
        engine.shatterShape(shape.id, point, offset, scale);
        return;
      }
      const b = shape.bounds;
      const closestX = clamp(point.x, b.x + offset.x, b.x + offset.x + b.width);
      const closestY = clamp(point.y, b.y + offset.y, b.y + offset.y + b.height);
      const d = distance(point.x, point.y, closestX, closestY);
      if (d <= radius && (!nearestShape || d < nearestShape.distance)) nearestShape = { id: shape.id, distance: d };
    }

    const nearPiece = pieceIds.find((id) => id !== directPiece);
    if (nearPiece && engine.shatterPiece(nearPiece, point, scale)) return;
    if (nearestShape) {
      engine.shatterShape(nearestShape.id, point, shapeTransforms.get(nearestShape.id) ?? { x: 0, y: 0 }, scale);
    }
  };

  const releaseCapture = (pointerId: number) => {
    const container = containerRef.current;
    if (container?.hasPointerCapture(pointerId)) container.releasePointerCapture(pointerId);
  };

  // Pointer handlers
  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const engine = engineRef.current;
    if (!engine || !containerRef.current) return;
    clearAutoRebuild();
    markInteraction();

    const { rect, point } = toViewBoxPoint(e.clientX, e.clientY);
    const burstFactor = getBurstMetrics(performance.now() / 1000, true);
    const scale = clamp(burstFactor * getPressureFactor(e), 0.85, 2.4);
    const radius = Math.max(
      (CURSOR_RADIUS_PX / rect.width) * viewBox.width,
      (CURSOR_RADIUS_PX / rect.height) * viewBox.height
    );

    if (engine.isReassembling()) engine.cancelReassembly();

    const grabbedId = prefersReducedMotion ? null : engine.pieceAt(point);
    if (grabbedId) {
      pendingRef.current = {
        pieceId: grabbedId,
        pointerId: e.pointerId,
        clientX: e.clientX,
        clientY: e.clientY,
        point,
        radius,
        scale,
      };
      containerRef.current.setPointerCapture(e.pointerId);
      return;
    }

    shatterAt(point, radius, scale);
    scheduleAutoRebuild();
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const engine = engineRef.current;
    if (!containerRef.current || !engine) return;
    const { rect, point } = toViewBoxPoint(e.clientX, e.clientY);

    const pending = pendingRef.current;
    if (pending && pending.pointerId === e.pointerId) {
      if (Math.hypot(e.clientX - pending.clientX, e.clientY - pending.clientY) > DRAG_THRESHOLD_PX) {
        pendingRef.current = null;
        if (engine.beginDrag(pending.pieceId, point, e.timeStamp)) {
          draggingRef.current = true;
        }
      }
      return;
    }
    if (draggingRef.current) {
      engine.moveDrag(point, e.timeStamp);
      return;
    }

    setPointer({
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    const engine = engineRef.current;
    const pending = pendingRef.current;
    if (pending && pending.pointerId === e.pointerId) {
      pendingRef.current = null;
      releaseCapture(e.pointerId);
      shatterAt(pending.point, pending.radius, pending.scale, pending.pieceId);
    } else if (draggingRef.current) {
      draggingRef.current = false;
      releaseCapture(e.pointerId);
      engine?.endDrag(e.timeStamp);
    }
    scheduleAutoRebuild();
  };

  const handlePointerCancel = (e: React.PointerEvent) => {
    pendingRef.current = null;
    if (draggingRef.current) {
      draggingRef.current = false;
      engineRef.current?.endDrag(e.timeStamp, false);
    }
    releaseCapture(e.pointerId);
    scheduleAutoRebuild();
  };

  const handlePointerLeave = () => {
    if (draggingRef.current || pendingRef.current) return;
    setPointer(null);
  };

  const handleReset = useCallback(() => {
    clearAutoRebuild();
    pendingRef.current = null;
    draggingRef.current = false;
    engineRef.current?.reassemble();
  }, [clearAutoRebuild]);

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

  // Programmatic explosion trigger — blasts existing pieces and shatters every
  // whole shape in a left-to-right wave.
  useEffect(() => {
    if (!triggerExplode) return;
    const engine = engineRef.current;
    if (!engine) return;
    markInteraction();
    engine.cancelReassembly();
    engine.blastPieces(1);
    const ordered = shapes.slice().sort((a, b) => a.centroid.x - b.centroid.x);
    const timers = ordered.map((shape, i) =>
      window.setTimeout(() => {
        engineRef.current?.shatterShape(shape.id, shape.centroid, { x: 0, y: 0 }, 1);
      }, i * PROGRAMMATIC_STAGGER_MS)
    );
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [triggerExplode, shapes, markInteraction]);

  // Control updater
  const updateControl = useCallback((key: keyof Controls, value: number) => {
    setControls(prev => ({ ...prev, [key]: value }));
  }, []);

  useEffect(() => {
    if (!persistControls) return;
    try {
      window.localStorage.setItem(CONTROLS_STORAGE_KEY, JSON.stringify(controls));
    } catch {
      // Ignore storage failures
    }
  }, [controls, persistControls]);

  return (
    <div
      className={`relative w-full overflow-visible ${className}`}
      style={fillViewport ? undefined : { maxWidth: '100%' }}
    >
      {/* Main Banner */}
      <div
        ref={containerRef}
        className="relative w-full overflow-visible select-none"
        style={{
          ...(fillViewport ? { height: '100vh' } : { aspectRatio: `${viewBox.width} / ${viewBox.height}` }),
          background: 'transparent',
          cursor: CUSTOM_CURSOR,
          touchAction: hasPieces ? 'none' : 'manipulation',
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onPointerLeave={handlePointerLeave}
      >
        <svg
          width="100%"
          height="100%"
          viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
          preserveAspectRatio={fillViewport ? "none" : "xMidYMid meet"}
          overflow="visible"
          style={{ display: 'block', overflow: 'visible' }}
        >
          {shapes.map((shape, index) => {
            if (shatteredIds.has(shape.id)) return null;

            const transform = shapeTransforms.get(shape.id) || { x: 0, y: 0 };
            const isEntering = introBounce && !prefersReducedMotion && !hasEntered;
            const entranceDelaySec =
              (introBounceDelayMs + index * INTRO_STAGGER_MS) / 1000;
            const isLastShape = index === shapes.length - 1;

            return (
              <motion.g
                key={shape.id}
                initial={
                  isEntering
                    ? { x: transform.x, y: transform.y + INTRO_Y_OFFSET, scale: 1, rotate: 0, opacity: 0 }
                    : { x: 0, y: 0, scale: 1, rotate: 0, opacity: 1 }
                }
                animate={{ x: transform.x, y: transform.y, scale: 1, rotate: 0, opacity: 1 }}
                transition={
                  hasEntered
                    ? {
                        type: 'spring',
                        stiffness: 300 * controls.spring,
                        damping: 30 * controls.damping,
                      }
                    : {
                        ...INTRO_SPRING,
                        delay: entranceDelaySec,
                        opacity: { ...INTRO_OPACITY_TWEEN, delay: entranceDelaySec },
                      }
                }
                onAnimationComplete={() => {
                  if (!hasEntered && isLastShape) {
                    setHasEntered(true);
                  }
                }}
                style={{ transformOrigin: `${shape.centroid.x}px ${shape.centroid.y}px` }}
              >
                <ShapeElement html={shape.element} />
              </motion.g>
            );
          })}

          <PiecesLayer pieces={pieceViews} getRef={getPieceRef} />
        </svg>
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
