/**
 * Geometry for shattering shapes into Voronoi pieces that exactly tile the
 * original outline. All polygons are in SVG viewBox coordinates (y down).
 */

import { Delaunay } from 'd3-delaunay';

export interface Vec {
  x: number;
  y: number;
}

export type Polygon = Vec[];

export interface OutlineSource {
  type: string;
  attrs: Record<string, string>;
  bounds: { x: number; y: number; width: number; height: number };
}

const EPSILON = 1e-9;

const signedArea = (poly: Polygon) => {
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
};

export const polygonArea = (poly: Polygon) => Math.abs(signedArea(poly));

export const polygonCentroid = (poly: Polygon): Vec => {
  const area = signedArea(poly);
  if (Math.abs(area) < EPSILON) {
    const sum = poly.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
    return { x: sum.x / poly.length, y: sum.y / poly.length };
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const cross = a.x * b.y - b.x * a.y;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }
  return { x: cx / (6 * area), y: cy / (6 * area) };
};

export const polygonBounds = (poly: Polygon) => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
};

export const pointInPolygon = (point: Vec, poly: Polygon) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    const crosses = (a.y > point.y) !== (b.y > point.y);
    if (crosses && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
};

/** Andrew's monotone chain. Returns a strictly convex hull (collinear points removed). */
export const convexHull = (points: Polygon): Polygon => {
  if (points.length < 3) return points.slice();
  const sorted = points.slice().sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  const cross = (o: Vec, a: Vec, b: Vec) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Vec[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= EPSILON) lower.pop();
    lower.push(p);
  }
  const upper: Vec[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= EPSILON) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
};

/**
 * Sutherland–Hodgman clip of `subject` against a convex `clip` polygon.
 * Either winding order is accepted for both polygons.
 */
export const clipToConvex = (subject: Polygon, clip: Polygon): Polygon => {
  const orientation = Math.sign(signedArea(clip)) || 1;
  const inside = (p: Vec, a: Vec, b: Vec) =>
    orientation * ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) >= -EPSILON;
  const intersect = (p: Vec, q: Vec, a: Vec, b: Vec): Vec => {
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const denom = dx * ey - dy * ex;
    if (Math.abs(denom) < EPSILON) return { x: q.x, y: q.y };
    const t = ((a.x - p.x) * ey - (a.y - p.y) * ex) / denom;
    return { x: p.x + dx * t, y: p.y + dy * t };
  };

  let output = subject;
  for (let i = 0; i < clip.length && output.length > 0; i++) {
    const a = clip[i];
    const b = clip[(i + 1) % clip.length];
    const input = output;
    output = [];
    for (let j = 0; j < input.length; j++) {
      const current = input[j];
      const previous = input[(j + input.length - 1) % input.length];
      const currentInside = inside(current, a, b);
      const previousInside = inside(previous, a, b);
      if (currentInside) {
        if (!previousInside) output.push(intersect(previous, current, a, b));
        output.push(current);
      } else if (previousInside) {
        output.push(intersect(previous, current, a, b));
      }
    }
  }
  return output;
};

const arcSegments = (radius: number) => Math.max(3, Math.min(16, Math.ceil(radius / 6)));

export const roundedRectPolygon = (
  x: number,
  y: number,
  width: number,
  height: number,
  rx: number,
  ry: number
): Polygon => {
  const rX = Math.max(0, Math.min(rx, width / 2));
  const rY = Math.max(0, Math.min(ry, height / 2));
  if (rX < EPSILON || rY < EPSILON) {
    return [
      { x, y },
      { x: x + width, y },
      { x: x + width, y: y + height },
      { x, y: y + height },
    ];
  }
  const segments = arcSegments(Math.max(rX, rY));
  const corners = [
    { cx: x + width - rX, cy: y + rY, start: -Math.PI / 2 },
    { cx: x + width - rX, cy: y + height - rY, start: 0 },
    { cx: x + rX, cy: y + height - rY, start: Math.PI / 2 },
    { cx: x + rX, cy: y + rY, start: Math.PI },
  ];
  const points: Polygon = [];
  for (const corner of corners) {
    for (let i = 0; i <= segments; i++) {
      const angle = corner.start + (i / segments) * (Math.PI / 2);
      points.push({ x: corner.cx + Math.cos(angle) * rX, y: corner.cy + Math.sin(angle) * rY });
    }
  }
  return convexHull(points);
};

export const ellipsePolygon = (cx: number, cy: number, rx: number, ry: number): Polygon => {
  const segments = Math.max(16, Math.min(64, Math.ceil(Math.max(rx, ry) / 5)));
  const points: Polygon = [];
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    points.push({ x: cx + Math.cos(angle) * rx, y: cy + Math.sin(angle) * ry });
  }
  return points;
};

const num = (value: string | undefined, fallback = 0) => {
  const parsed = parseFloat(value ?? '');
  return Number.isFinite(parsed) ? parsed : fallback;
};

/** Convex outline of a parsed SVG shape. Concave inputs fall back to their convex hull. */
export const shapeOutline = (shape: OutlineSource): Polygon => {
  const { attrs, bounds } = shape;
  switch (shape.type) {
    case 'rect': {
      const hasRx = attrs.rx !== undefined;
      const hasRy = attrs.ry !== undefined;
      const rx = hasRx ? num(attrs.rx) : num(attrs.ry);
      const ry = hasRy ? num(attrs.ry) : rx;
      return roundedRectPolygon(num(attrs.x), num(attrs.y), num(attrs.width), num(attrs.height), rx, ry);
    }
    case 'circle': {
      const r = num(attrs.r);
      return ellipsePolygon(num(attrs.cx), num(attrs.cy), r, r);
    }
    case 'ellipse':
      return ellipsePolygon(num(attrs.cx), num(attrs.cy), num(attrs.rx), num(attrs.ry));
    case 'polygon': {
      const values = (attrs.points ?? '').trim().split(/[\s,]+/).map(Number).filter(Number.isFinite);
      const points: Polygon = [];
      for (let i = 0; i + 1 < values.length; i += 2) points.push({ x: values[i], y: values[i + 1] });
      if (points.length >= 3) return convexHull(points);
      break;
    }
  }
  return roundedRectPolygon(bounds.x, bounds.y, bounds.width, bounds.height, 0, 0);
};

export const polygonToPath = (poly: Polygon) =>
  poly.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ') + 'Z';

export interface ShatterOptions {
  count: number;
  impact: Vec;
  random?: () => number;
}

/**
 * Splits a convex polygon into Voronoi cells. Seeds cluster around the impact
 * point so pieces are smaller where the shape was hit. The returned pieces
 * tile the input exactly.
 */
export const voronoiShatter = (poly: Polygon, { count, impact, random = Math.random }: ShatterOptions): Polygon[] => {
  const area = polygonArea(poly);
  const target = Math.max(2, Math.round(count));
  if (area < 4) return [poly];

  const { minX, minY, maxX, maxY } = polygonBounds(poly);
  const width = maxX - minX;
  const height = maxY - minY;
  const spread = Math.sqrt(area) * 0.35;
  const gaussian = () => {
    const u = Math.max(random(), 1e-6);
    const v = random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };

  let minSpacing = Math.sqrt(area / target) * 0.5;
  const seeds: Vec[] = [];
  let attempts = 0;
  while (seeds.length < target && attempts < target * 60) {
    attempts++;
    if (attempts % (target * 12) === 0) minSpacing *= 0.8;
    const nearImpact = random() < 0.55;
    const candidate = nearImpact
      ? { x: impact.x + gaussian() * spread, y: impact.y + gaussian() * spread }
      : { x: minX + random() * width, y: minY + random() * height };
    if (!pointInPolygon(candidate, poly)) continue;
    if (seeds.some((s) => Math.hypot(s.x - candidate.x, s.y - candidate.y) < minSpacing)) continue;
    seeds.push(candidate);
  }
  if (seeds.length < 2) return [poly];

  const voronoi = Delaunay.from(seeds, (p) => p.x, (p) => p.y).voronoi([minX - 1, minY - 1, maxX + 1, maxY + 1]);
  const pieces: Polygon[] = [];
  for (let i = 0; i < seeds.length; i++) {
    const cell = voronoi.cellPolygon(i);
    if (!cell) continue;
    const cellPoly = cell.slice(0, -1).map(([x, y]) => ({ x, y }));
    const clipped = convexHull(clipToConvex(cellPoly, poly));
    if (clipped.length >= 3 && polygonArea(clipped) > 0.5) pieces.push(clipped);
  }
  return pieces.length > 0 ? pieces : [poly];
};
