import { describe, expect, it } from 'vitest';
import {
  clipToConvex,
  convexHull,
  polygonArea,
  polygonCentroid,
  roundedRectPolygon,
  shapeOutline,
  voronoiShatter,
  type Polygon,
} from './shatterGeometry';

const seededRandom = (seed: number) => () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};

const isConvex = (poly: Polygon) => {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const c = poly[(i + 2) % poly.length];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-6) continue;
    if (sign === 0) sign = Math.sign(cross);
    else if (Math.sign(cross) !== sign) return false;
  }
  return true;
};

describe('shatterGeometry', () => {
  it('builds a pill outline with the right area', () => {
    const pill = roundedRectPolygon(0, 0, 710, 380, 190, 190);
    const exact = 710 * 380 - (4 - Math.PI) * 190 * 190;
    expect(polygonArea(pill)).toBeGreaterThan(exact * 0.995);
    expect(polygonArea(pill)).toBeLessThanOrEqual(exact);
    expect(isConvex(pill)).toBe(true);
  });

  it('reads rx/ry from rect attributes', () => {
    const outline = shapeOutline({
      type: 'rect',
      attrs: { x: '1095', y: '0', width: '152', height: '380', rx: '76' },
      bounds: { x: 1095, y: 0, width: 152, height: 380 },
    });
    const { x } = polygonCentroid(outline);
    expect(x).toBeCloseTo(1095 + 76, 3);
  });

  it('clips a square against a triangle', () => {
    const square = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const triangle = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: 10 },
    ];
    expect(polygonArea(clipToConvex(square, triangle))).toBeCloseTo(50, 6);
    expect(polygonArea(clipToConvex(square, triangle.slice().reverse()))).toBeCloseTo(50, 6);
  });

  it('removes collinear points from hulls', () => {
    const hull = convexHull([
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]);
    expect(hull).toHaveLength(4);
  });

  it.each([
    ['big pill', roundedRectPolygon(0, 0, 710, 380, 190, 190), { x: 150, y: 190 }, 14],
    ['thin pill', roundedRectPolygon(1421, 0, 19, 380, 9.5, 9.5), { x: 1430, y: 100 }, 5],
    ['square', roundedRectPolygon(0, 0, 100, 100, 0, 0), { x: 90, y: 90 }, 8],
  ])('tiles the %s exactly with convex pieces', (_name, outline, impact, count) => {
    const random = seededRandom(42);
    const pieces = voronoiShatter(outline, { count, impact, random });
    expect(pieces.length).toBeGreaterThanOrEqual(2);
    const total = pieces.reduce((sum, piece) => sum + polygonArea(piece), 0);
    expect(total / polygonArea(outline)).toBeCloseTo(1, 4);
    pieces.forEach((piece) => expect(isConvex(piece)).toBe(true));
  });
});
