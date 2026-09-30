/**
 * Physics for the shatter banner: Voronoi pieces simulated with Matter.js,
 * grab-and-fling, and a spring-driven reassembly back to the original shapes.
 *
 * The engine owns all per-frame state and writes transforms straight to the
 * registered SVG elements, so React only re-renders when pieces are created
 * or removed. The animation loop stops whenever nothing is moving.
 */

import Matter from 'matter-js';
import {
  convexHull,
  polygonArea,
  polygonCentroid,
  polygonToPath,
  voronoiShatter,
  type Polygon,
  type Vec,
} from './shatterGeometry';

const STEP_MS = 1000 / 120;
const STEP_S = STEP_MS / 1000;
const MAX_FRAME_MS = 50;
const MAX_STEPS_PER_FRAME = 12;
const MATTER_UNITS_PER_S = 60;

const MAX_PIECES = 150;
const MIN_PIECE_AREA = 6;
const MIN_SHATTER_AREA = 160;
const WALL_THICKNESS = 600;
// Faster pieces can tunnel through the thinnest shapes (19 units wide at a 120 Hz step).
const MAX_SPEED = 1800;
const MAX_FLING_SPEED = 2600;
const MAX_RETURN_START_SPEED = 1200;
const FLING_SAMPLE_WINDOW_MS = 80;
const RETURN_TIMEOUT_S = 3;
const REDUCED_MOTION_GAP = 14;
// New pieces start packed edge to edge, so they fly through each other and the
// intact shapes (bouncing only off the walls) until they have spread out.
const GHOST_S = 0.55;
const SOLIDIFY_CHECK_STEPS = 3;

const CATEGORY_WALL = 0x0001;
const CATEGORY_SHAPE = 0x0002;
const CATEGORY_PIECE = 0x0004;
const CATEGORY_GHOST = 0x0008;
const GHOST_FILTER = { group: 0, category: CATEGORY_GHOST, mask: CATEGORY_WALL };
const SOLID_FILTER = { group: 0, category: CATEGORY_PIECE, mask: CATEGORY_WALL | CATEGORY_SHAPE | CATEGORY_PIECE };

export interface EngineShape {
  id: string;
  outline: Polygon;
  fill: string;
}

export interface PieceView {
  id: string;
  d: string;
  fill: string;
}

export interface EngineSettings {
  gravity: number;
  restitution: number;
  friction: number;
  walls: boolean;
  timeScale: number;
  explosionForce: number;
  shardSpread: number;
  explosionSpin: number;
  returnSpring: number;
  settleDamping: number;
  reducedMotion: boolean;
  paused: boolean;
}

export interface EngineCallbacks {
  onChange: (state: { pieces: PieceView[]; shattered: string[] }) => void;
  onAllRestored: () => void;
}

interface ViewBoxLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

type PieceMode = 'physics' | 'waiting' | 'returning' | 'landed';

interface Piece {
  id: string;
  rootId: string;
  fill: string;
  path: string;
  area: number;
  local: Polygon;
  home: Vec;
  body: Matter.Body;
  mode: PieceMode;
  solid: boolean;
  solidAt: number;
  returnAt: number;
  returnStartedAt: number;
  x: number;
  y: number;
  angle: number;
  vx: number;
  vy: number;
  va: number;
  targetAngle: number;
  el: SVGGElement | null;
  lastTransform: string;
}

interface DragState {
  piece: Piece;
  constraint: Matter.Constraint;
  samples: { x: number; y: number; t: number }[];
  frictionAir: number;
}

const rotate = (v: Vec, angle: number): Vec => {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
};

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

const distanceToSegment = (p: Vec, a: Vec, b: Vec) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq > 0 ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq, 0, 1) : 0;
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
};

export class ShatterEngine {
  private readonly engine = Matter.Engine.create({
    enableSleeping: true,
    positionIterations: 8,
    velocityIterations: 6,
  });
  private readonly viewBox: ViewBoxLike;
  private readonly callbacks: EngineCallbacks;
  private settings: EngineSettings;
  private shapes = new Map<string, EngineShape>();
  private colliders = new Map<string, Matter.Body>();
  private walls: Matter.Body[] = [];
  private pieces = new Map<string, Piece>();
  private shattered = new Set<string>();
  private drag: DragState | null = null;
  private reassembling = false;
  private simTime = 0;
  private stepCount = 0;
  private accumulator = 0;
  private rafId: number | null = null;
  private lastFrame: number | null = null;
  private nextId = 0;
  private dirty = false;
  private restoredAll = false;
  private destroyed = false;

  constructor(viewBox: ViewBoxLike, callbacks: EngineCallbacks, settings: EngineSettings, shapes: EngineShape[]) {
    this.viewBox = viewBox;
    this.callbacks = callbacks;
    this.settings = settings;
    this.engine.gravity.y = settings.gravity;
    this.syncWalls();
    this.setShapes(shapes);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  setShapes(shapes: EngineShape[]) {
    this.shapes = new Map(shapes.map((shape) => [shape.id, shape]));
    this.colliders.forEach((body) => Matter.Composite.remove(this.engine.world, body));
    this.colliders.clear();
    this.shapes.forEach((shape) => {
      if (!this.shattered.has(shape.id)) this.addCollider(shape);
    });
  }

  setSettings(settings: EngineSettings) {
    const previous = this.settings;
    this.settings = settings;
    this.engine.gravity.y = settings.gravity;
    if (previous.walls !== settings.walls) this.syncWalls();
    if (previous.restitution !== settings.restitution || previous.friction !== settings.friction) {
      const all = [...this.walls, ...this.colliders.values(), ...[...this.pieces.values()].map((p) => p.body)];
      all.forEach((body) => {
        body.restitution = settings.restitution;
        body.friction = settings.friction;
      });
    }
    if (previous.gravity !== settings.gravity || previous.walls !== settings.walls) this.wakeAll();
    if (settings.paused) {
      this.stopLoop();
    } else if (previous.paused) {
      this.startLoop();
    }
  }

  registerElement(id: string, el: SVGGElement | null) {
    const piece = this.pieces.get(id);
    if (!piece) return;
    piece.el = el;
    piece.lastTransform = '';
    if (el) this.renderPiece(piece);
  }

  hasPieces() {
    return this.pieces.size > 0;
  }

  isReassembling() {
    return this.reassembling;
  }

  isDragging() {
    return this.drag !== null;
  }

  /** Topmost piece whose polygon contains the point. */
  pieceAt(point: Vec): string | null {
    if (this.reassembling) return null;
    const list = [...this.pieces.values()];
    for (let i = list.length - 1; i >= 0; i--) {
      if (Matter.Vertices.contains(list[i].body.vertices, point)) return list[i].id;
    }
    return null;
  }

  /** Pieces within `radius` of the point, pieces under the point first, then topmost first. */
  queryPieces(point: Vec, radius: number): string[] {
    const list = [...this.pieces.values()].reverse();
    const direct: string[] = [];
    const near: string[] = [];
    for (const piece of list) {
      const vertices = piece.body.vertices;
      if (Matter.Vertices.contains(vertices, point)) {
        direct.push(piece.id);
        continue;
      }
      let min = Infinity;
      for (let i = 0; i < vertices.length; i++) {
        min = Math.min(min, distanceToSegment(point, vertices[i], vertices[(i + 1) % vertices.length]));
      }
      if (min <= radius) near.push(piece.id);
    }
    return direct.concat(near);
  }

  shatterShape(shapeId: string, impact: Vec, offset: Vec, scale: number) {
    const shape = this.shapes.get(shapeId);
    if (!shape || this.shattered.has(shapeId)) return false;
    const budget = MAX_PIECES - this.pieces.size;
    if (budget < 2) return false;

    const area = polygonArea(shape.outline);
    const areaRatio = area / (this.viewBox.width * this.viewBox.height);
    const count = clamp(Math.round((5 + areaRatio * 22) * scale), 2, Math.min(16, budget));
    const impactHome = { x: impact.x - offset.x, y: impact.y - offset.y };
    const polys = voronoiShatter(shape.outline, { count, impact: impactHome });

    this.removeCollider(shapeId);
    this.shattered.add(shapeId);

    const avgArea = area / polys.length;
    const created = polys.map((poly) => {
      const centroid = polygonCentroid(poly);
      const world = { x: centroid.x + offset.x, y: centroid.y + offset.y };
      const velocity = this.explosionVelocity(world, impact, scale, polygonArea(poly), avgArea, Math.sqrt(area));
      return this.createPiece(shapeId, shape.fill, poly, world, 0, velocity);
    });

    this.afterShatter(created, impact);
    return true;
  }

  shatterPiece(pieceId: string, impact: Vec, scale: number) {
    const piece = this.pieces.get(pieceId);
    if (!piece || piece.mode !== 'physics') return false;
    const budget = MAX_PIECES - this.pieces.size + 1;
    if (piece.area < MIN_SHATTER_AREA || budget < 2) {
      this.poke(piece, impact, scale);
      this.startLoop();
      return true;
    }

    const count = clamp(Math.round((2 + Math.sqrt(piece.area) / 45) * scale), 2, Math.min(7, budget));
    const { position, angle } = piece.body;
    const homePoly = piece.local.map((p) => ({ x: p.x + piece.home.x, y: p.y + piece.home.y }));
    const localImpact = rotate({ x: impact.x - position.x, y: impact.y - position.y }, -angle);
    const impactHome = { x: piece.home.x + localImpact.x, y: piece.home.y + localImpact.y };
    const polys = voronoiShatter(homePoly, { count, impact: impactHome });
    const parentVelocity = Matter.Body.getVelocity(piece.body);
    const parentSpin = Matter.Body.getAngularVelocity(piece.body);

    this.removePiece(piece);

    const avgArea = piece.area / polys.length;
    const created = polys.map((poly) => {
      const centroid = polygonCentroid(poly);
      const offset = rotate({ x: centroid.x - piece.home.x, y: centroid.y - piece.home.y }, angle);
      const world = { x: position.x + offset.x, y: position.y + offset.y };
      const burst = this.explosionVelocity(world, impact, scale * 0.8, polygonArea(poly), avgArea, Math.sqrt(piece.area));
      const velocity = {
        x: burst.x + parentVelocity.x * MATTER_UNITS_PER_S * 0.5,
        y: burst.y + parentVelocity.y * MATTER_UNITS_PER_S * 0.5,
        spin: burst.spin + parentSpin * MATTER_UNITS_PER_S * 0.5,
      };
      return this.createPiece(piece.rootId, piece.fill, poly, world, angle, velocity);
    });

    this.afterShatter(created, impact);
    return true;
  }

  /** Kicks every piece outward from the middle of the banner. */
  blastPieces(scale: number) {
    if (this.settings.reducedMotion) return;
    const center = { x: this.viewBox.x + this.viewBox.width / 2, y: this.viewBox.y + this.viewBox.height / 2 };
    this.pieces.forEach((piece) => {
      if (piece.mode !== 'physics') return;
      const velocity = this.explosionVelocity(piece.body.position, center, scale, piece.area, piece.area, this.viewBox.height);
      const current = Matter.Body.getVelocity(piece.body);
      Matter.Sleeping.set(piece.body, false);
      Matter.Body.setVelocity(piece.body, {
        x: current.x + velocity.x / MATTER_UNITS_PER_S,
        y: current.y + velocity.y / MATTER_UNITS_PER_S,
      });
      Matter.Body.setAngularVelocity(piece.body, Matter.Body.getAngularVelocity(piece.body) + velocity.spin / MATTER_UNITS_PER_S);
    });
    this.startLoop();
  }

  beginDrag(pieceId: string, point: Vec, time: number) {
    const piece = this.pieces.get(pieceId);
    if (!piece || piece.mode !== 'physics' || this.settings.reducedMotion) return false;
    this.endDrag(time, false);
    const body = piece.body;
    Matter.Sleeping.set(body, false);
    const constraint = Matter.Constraint.create({
      pointA: { x: point.x, y: point.y },
      bodyB: body,
      pointB: { x: point.x - body.position.x, y: point.y - body.position.y },
      length: 0,
      stiffness: 0.2,
      damping: 0.1,
    });
    Matter.Composite.add(this.engine.world, constraint);
    this.drag = { piece, constraint, samples: [{ ...point, t: time }], frictionAir: body.frictionAir };
    body.frictionAir = 0.03;
    this.startLoop();
    return true;
  }

  moveDrag(point: Vec, time: number) {
    const drag = this.drag;
    if (!drag) return;
    drag.constraint.pointA.x = point.x;
    drag.constraint.pointA.y = point.y;
    drag.samples.push({ ...point, t: time });
    while (drag.samples.length > 2 && time - drag.samples[0].t > FLING_SAMPLE_WINDOW_MS) drag.samples.shift();
    this.startLoop();
  }

  endDrag(time: number, fling = true) {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    Matter.Composite.remove(this.engine.world, drag.constraint);
    const body = drag.piece.body;
    body.frictionAir = drag.frictionAir;
    if (!fling || !this.pieces.has(drag.piece.id)) return;

    const recent = drag.samples.filter((s) => time - s.t <= FLING_SAMPLE_WINDOW_MS);
    const first = recent[0];
    const last = recent[recent.length - 1];
    const span = first && last ? last.t - first.t : 0;
    const pointer = span >= 10
      ? { x: ((last.x - first.x) / span) * 1000, y: ((last.y - first.y) / span) * 1000 }
      : { x: 0, y: 0 };
    const current = Matter.Body.getVelocity(body);
    let vx = current.x * MATTER_UNITS_PER_S * 0.4 + pointer.x * 0.6;
    let vy = current.y * MATTER_UNITS_PER_S * 0.4 + pointer.y * 0.6;
    const speed = Math.hypot(vx, vy);
    if (speed > MAX_FLING_SPEED) {
      vx *= MAX_FLING_SPEED / speed;
      vy *= MAX_FLING_SPEED / speed;
    }
    Matter.Body.setVelocity(body, { x: vx / MATTER_UNITS_PER_S, y: vy / MATTER_UNITS_PER_S });
    this.startLoop();
  }

  /** Flies every piece home on a spring, then swaps each shape back in once all its pieces land. */
  reassemble() {
    this.endDrag(0, false);
    const emptyRoots = [...this.shattered].filter((id) => ![...this.pieces.values()].some((p) => p.rootId === id));
    emptyRoots.forEach((id) => this.restoreShape(id));

    if (this.pieces.size === 0) {
      this.reassembling = false;
      this.restoredAll = true;
      this.flush();
      return;
    }

    if (this.settings.reducedMotion) {
      const roots = new Set([...this.pieces.values()].map((p) => p.rootId));
      [...this.pieces.values()].forEach((piece) => this.removePiece(piece));
      roots.forEach((id) => this.restoreShape(id));
      this.restoredAll = true;
      this.flush();
      return;
    }

    this.reassembling = true;
    const roots = [...new Set([...this.pieces.values()].map((p) => p.rootId))].sort((a, b) => {
      const ax = this.shapes.get(a) ? polygonCentroid(this.shapes.get(a)!.outline).x : 0;
      const bx = this.shapes.get(b) ? polygonCentroid(this.shapes.get(b)!.outline).x : 0;
      return ax - bx;
    });
    const rootGap = roots.length > 1 ? Math.min(0.07, 0.24 / (roots.length - 1)) : 0;
    const rootDelay = new Map(roots.map((id, index) => [id, index * rootGap]));
    this.pieces.forEach((piece) => {
      if (piece.mode !== 'physics') return;
      piece.mode = 'waiting';
      piece.returnAt = this.simTime + (rootDelay.get(piece.rootId) ?? 0) + Math.random() * 0.05;
    });
    this.flush();
    this.startLoop();
  }

  /** Drops in-flight pieces back into the simulation, keeping their current motion. */
  cancelReassembly() {
    if (!this.reassembling) return;
    this.reassembling = false;
    this.pieces.forEach((piece) => {
      if (piece.mode === 'waiting') {
        piece.mode = 'physics';
      } else if (piece.mode === 'returning' || piece.mode === 'landed') {
        const body = piece.body;
        Matter.Body.setPosition(body, { x: piece.x, y: piece.y });
        Matter.Body.setAngle(body, piece.angle);
        Matter.Composite.add(this.engine.world, body);
        Matter.Body.setVelocity(body, { x: piece.vx / MATTER_UNITS_PER_S, y: piece.vy / MATTER_UNITS_PER_S });
        Matter.Body.setAngularVelocity(body, piece.va / MATTER_UNITS_PER_S);
        this.makeGhost(piece, 0.15);
        piece.mode = 'physics';
      }
    });
    this.wakeAll();
    this.startLoop();
  }

  destroy() {
    this.destroyed = true;
    this.stopLoop();
    Matter.Composite.clear(this.engine.world, false, true);
    Matter.Engine.clear(this.engine);
    this.pieces.clear();
  }

  // ---------------------------------------------------------------------------
  // Pieces and colliders
  // ---------------------------------------------------------------------------

  private createPiece(
    rootId: string,
    fill: string,
    homePoly: Polygon,
    world: Vec,
    angle: number,
    velocity: { x: number; y: number; spin: number }
  ): Piece | null {
    const hull = convexHull(homePoly);
    const area = polygonArea(hull);
    if (hull.length < 3 || area < MIN_PIECE_AREA) return null;
    const home = polygonCentroid(hull);
    const local = hull.map((p) => ({ x: p.x - home.x, y: p.y - home.y }));
    const vertices = Matter.Vertices.clockwiseSort(local.map((p) => ({ x: p.x + world.x, y: p.y + world.y })));
    const id = `piece-${this.nextId++}`;
    const body = Matter.Body.create({
      label: id,
      position: { x: world.x, y: world.y },
      vertices,
      angle,
      friction: this.settings.friction,
      frictionStatic: 0.8,
      frictionAir: 0.01,
      restitution: this.settings.restitution,
      collisionFilter: { ...GHOST_FILTER },
    });
    Matter.Body.setVelocity(body, { x: velocity.x / MATTER_UNITS_PER_S, y: velocity.y / MATTER_UNITS_PER_S });
    Matter.Body.setAngularVelocity(body, velocity.spin / MATTER_UNITS_PER_S);
    Matter.Composite.add(this.engine.world, body);

    const piece: Piece = {
      id,
      rootId,
      fill,
      path: polygonToPath(local),
      area,
      local,
      home,
      body,
      mode: 'physics',
      solid: false,
      solidAt: this.simTime + GHOST_S,
      returnAt: 0,
      returnStartedAt: 0,
      x: world.x,
      y: world.y,
      angle,
      vx: 0,
      vy: 0,
      va: 0,
      targetAngle: 0,
      el: null,
      lastTransform: '',
    };
    this.pieces.set(id, piece);
    this.dirty = true;
    return piece;
  }

  private removePiece(piece: Piece) {
    if (this.drag?.piece === piece) this.endDrag(0, false);
    Matter.Composite.remove(this.engine.world, piece.body);
    this.pieces.delete(piece.id);
    this.dirty = true;
  }

  private afterShatter(created: (Piece | null)[], impact: Vec) {
    if (this.settings.reducedMotion) {
      created.forEach((piece) => {
        if (!piece) return;
        const dx = piece.body.position.x - impact.x;
        const dy = piece.body.position.y - impact.y;
        const length = Math.hypot(dx, dy) || 1;
        Matter.Body.setPosition(piece.body, {
          x: piece.body.position.x + (dx / length) * REDUCED_MOTION_GAP,
          y: piece.body.position.y + (dy / length) * REDUCED_MOTION_GAP,
        });
        Matter.Body.setVelocity(piece.body, { x: 0, y: 0 });
        Matter.Body.setAngularVelocity(piece.body, 0);
      });
      this.renderAll();
    } else {
      this.wakeAll();
      this.startLoop();
    }
    this.flush();
  }

  private explosionVelocity(world: Vec, impact: Vec, scale: number, area: number, avgArea: number, size: number) {
    const s = this.settings;
    let dx = world.x - impact.x;
    let dy = world.y - impact.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 1) {
      const a = Math.random() * Math.PI * 2;
      dx = Math.cos(a);
      dy = Math.sin(a);
    } else {
      dx /= distance;
      dy /= distance;
    }
    const direction = Math.atan2(dy, dx) + (Math.random() - 0.5) * 0.9;
    const massFactor = clamp(Math.sqrt(avgArea / Math.max(area, 1)), 0.7, 1.4);
    const falloff = clamp(1.25 - distance / (size * 1.2), 0.55, 1.25);
    const speed = s.explosionForce * s.shardSpread * 700 * scale * (0.65 + Math.random() * 0.7) * massFactor * falloff;
    const lift = s.gravity > 0 ? 260 * Math.min(s.gravity, 2) * (0.6 + Math.random() * 0.6) * Math.sqrt(scale) : 0;
    const spinSign = Math.random() > 0.5 ? 1 : -1;
    // Banners are wide and short, so the blast is stretched horizontally.
    return {
      x: Math.cos(direction) * speed * 1.4,
      y: Math.sin(direction) * speed * 0.7 - lift,
      spin: spinSign * s.explosionSpin * (1.5 + Math.random() * 2.5) / massFactor,
    };
  }

  private poke(piece: Piece, impact: Vec, scale: number) {
    if (this.settings.reducedMotion) return;
    const velocity = this.explosionVelocity(piece.body.position, impact, scale * 0.6, piece.area, piece.area, Math.sqrt(piece.area) * 4);
    const current = Matter.Body.getVelocity(piece.body);
    Matter.Sleeping.set(piece.body, false);
    Matter.Body.setVelocity(piece.body, {
      x: current.x + velocity.x / MATTER_UNITS_PER_S,
      y: current.y + velocity.y / MATTER_UNITS_PER_S,
    });
    Matter.Body.setAngularVelocity(piece.body, Matter.Body.getAngularVelocity(piece.body) + velocity.spin / MATTER_UNITS_PER_S);
  }

  private addCollider(shape: EngineShape) {
    const hull = convexHull(shape.outline);
    if (hull.length < 3) return;
    const centroid = polygonCentroid(hull);
    const body = Matter.Body.create({
      label: `collider-${shape.id}`,
      position: centroid,
      vertices: Matter.Vertices.clockwiseSort(hull.map((p) => ({ ...p }))),
      isStatic: true,
      friction: this.settings.friction,
      restitution: this.settings.restitution,
      collisionFilter: { group: 0, category: CATEGORY_SHAPE, mask: CATEGORY_PIECE },
    });
    Matter.Composite.add(this.engine.world, body);
    this.colliders.set(shape.id, body);
  }

  private removeCollider(shapeId: string) {
    const body = this.colliders.get(shapeId);
    if (!body) return;
    Matter.Composite.remove(this.engine.world, body);
    this.colliders.delete(shapeId);
  }

  private restoreShape(shapeId: string) {
    this.shattered.delete(shapeId);
    const shape = this.shapes.get(shapeId);
    if (shape && !this.colliders.has(shapeId)) this.addCollider(shape);
    this.wakeAll();
    this.dirty = true;
  }

  private syncWalls() {
    this.walls.forEach((wall) => Matter.Composite.remove(this.engine.world, wall));
    this.walls = [];
    if (!this.settings.walls) return;
    const { x, y, width, height } = this.viewBox;
    const t = WALL_THICKNESS;
    const options = {
      isStatic: true,
      friction: this.settings.friction,
      restitution: this.settings.restitution,
      collisionFilter: { group: 0, category: CATEGORY_WALL, mask: 0xffffffff },
    };
    this.walls = [
      Matter.Bodies.rectangle(x + width / 2, y - t / 2, width + t * 2, t, options),
      Matter.Bodies.rectangle(x + width / 2, y + height + t / 2, width + t * 2, t, options),
      Matter.Bodies.rectangle(x - t / 2, y + height / 2, t, height + t * 2, options),
      Matter.Bodies.rectangle(x + width + t / 2, y + height / 2, t, height + t * 2, options),
    ];
    Matter.Composite.add(this.engine.world, this.walls);
  }

  private makeGhost(piece: Piece, duration: number) {
    piece.solid = false;
    piece.solidAt = this.simTime + duration;
    piece.body.collisionFilter = { ...GHOST_FILTER };
  }

  /** Ghost pieces turn solid once their flight time is up and they overlap nothing solid. */
  private solidifyGhosts() {
    const ghosts = [...this.pieces.values()].filter(
      (p) => !p.solid && p.mode === 'physics' && this.simTime >= p.solidAt && this.drag?.piece !== p
    );
    if (ghosts.length === 0) return;
    const solids: Matter.Body[] = [...this.colliders.values()];
    this.pieces.forEach((p) => {
      if (p.solid && p.mode === 'physics') solids.push(p.body);
    });
    ghosts.forEach((piece) => {
      if (Matter.Query.collides(piece.body, solids).length > 0) return;
      piece.solid = true;
      piece.body.collisionFilter = { ...SOLID_FILTER };
      solids.push(piece.body);
    });
  }

  private wakeAll() {
    this.pieces.forEach((piece) => {
      if (piece.mode === 'physics' || piece.mode === 'waiting') Matter.Sleeping.set(piece.body, false);
    });
  }

  // ---------------------------------------------------------------------------
  // Simulation
  // ---------------------------------------------------------------------------

  private step() {
    const s = this.settings;

    if (this.reassembling) {
      let started = false;
      this.pieces.forEach((piece) => {
        if (piece.mode === 'waiting' && this.simTime >= piece.returnAt) {
          this.beginReturn(piece);
          started = true;
        }
      });
      if (started) this.wakeAll();
    }

    Matter.Engine.update(this.engine, STEP_MS);
    if (++this.stepCount % SOLIDIFY_CHECK_STEPS === 0) this.solidifyGhosts();

    const { x, y, width, height } = this.viewBox;
    this.pieces.forEach((piece) => {
      if (piece.mode !== 'physics' && piece.mode !== 'waiting') return;
      const body = piece.body;
      if (s.walls) {
        const speed = body.speed * MATTER_UNITS_PER_S;
        if (speed > MAX_SPEED) {
          const k = MAX_SPEED / speed;
          Matter.Body.setVelocity(body, { x: body.velocity.x * k, y: body.velocity.y * k });
        }
      } else {
        const p = body.position;
        if (p.x < x - width || p.x > x + width * 2 || p.y < y - height * 3 || p.y > y + height * 4) {
          this.removePiece(piece);
        }
      }
    });

    const stiffness = 90 + 150 * s.returnSpring;
    const damping = 2 * clamp(0.4 + 0.2 * s.settleDamping, 0.3, 1) * Math.sqrt(stiffness);
    const landingRoots = new Set<string>();
    this.pieces.forEach((piece) => {
      if (piece.mode !== 'returning') return;
      piece.vx += (-stiffness * (piece.x - piece.home.x) - damping * piece.vx) * STEP_S;
      piece.vy += (-stiffness * (piece.y - piece.home.y) - damping * piece.vy) * STEP_S;
      piece.va += (-stiffness * (piece.angle - piece.targetAngle) - damping * piece.va) * STEP_S;
      piece.x += piece.vx * STEP_S;
      piece.y += piece.vy * STEP_S;
      piece.angle += piece.va * STEP_S;

      const settled =
        Math.hypot(piece.x - piece.home.x, piece.y - piece.home.y) < 0.3 &&
        Math.hypot(piece.vx, piece.vy) < 8 &&
        Math.abs(piece.angle - piece.targetAngle) < 0.004 &&
        Math.abs(piece.va) < 0.1;
      if (settled || this.simTime - piece.returnStartedAt > RETURN_TIMEOUT_S) {
        piece.x = piece.home.x;
        piece.y = piece.home.y;
        piece.angle = piece.targetAngle;
        piece.vx = piece.vy = piece.va = 0;
        piece.mode = 'landed';
        landingRoots.add(piece.rootId);
      }
    });

    landingRoots.forEach((rootId) => {
      const group = [...this.pieces.values()].filter((p) => p.rootId === rootId);
      if (group.every((p) => p.mode === 'landed')) {
        group.forEach((p) => this.removePiece(p));
        this.restoreShape(rootId);
      }
    });

    if (this.reassembling && this.pieces.size === 0) {
      this.reassembling = false;
      this.restoredAll = true;
    }

    this.simTime += STEP_S;
  }

  private beginReturn(piece: Piece) {
    const body = piece.body;
    const velocity = Matter.Body.getVelocity(body);
    let vx = velocity.x * MATTER_UNITS_PER_S;
    let vy = velocity.y * MATTER_UNITS_PER_S;
    const speed = Math.hypot(vx, vy);
    if (speed > MAX_RETURN_START_SPEED) {
      vx *= MAX_RETURN_START_SPEED / speed;
      vy *= MAX_RETURN_START_SPEED / speed;
    }
    piece.x = body.position.x;
    piece.y = body.position.y;
    piece.angle = body.angle;
    piece.vx = vx;
    piece.vy = vy;
    piece.va = Matter.Body.getAngularVelocity(body) * MATTER_UNITS_PER_S;
    piece.targetAngle = Math.round(body.angle / (Math.PI * 2)) * Math.PI * 2;
    piece.returnStartedAt = this.simTime;
    piece.mode = 'returning';
    Matter.Composite.remove(this.engine.world, body);
  }

  private isActive() {
    if (this.settings.reducedMotion) return false;
    if (this.drag || this.reassembling) return true;
    for (const piece of this.pieces.values()) {
      if (piece.mode === 'physics' && !piece.body.isSleeping) return true;
    }
    return false;
  }

  private startLoop() {
    if (this.rafId !== null || this.destroyed || this.settings.paused || this.settings.reducedMotion) return;
    this.rafId = requestAnimationFrame(this.frame);
  }

  private stopLoop() {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.lastFrame = null;
    this.accumulator = 0;
  }

  private frame = (now: number) => {
    this.rafId = null;
    if (this.destroyed || this.settings.paused) return;
    const elapsed = this.lastFrame === null ? STEP_MS : Math.min(now - this.lastFrame, MAX_FRAME_MS);
    this.lastFrame = now;
    this.accumulator += elapsed * Math.max(0, this.settings.timeScale);
    let steps = 0;
    while (this.accumulator >= STEP_MS && steps < MAX_STEPS_PER_FRAME) {
      this.step();
      this.accumulator -= STEP_MS;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0;

    this.renderAll();
    this.flush();

    if (this.isActive()) {
      this.rafId = requestAnimationFrame(this.frame);
    } else {
      this.lastFrame = null;
      this.accumulator = 0;
    }
  };

  // ---------------------------------------------------------------------------
  // Output
  // ---------------------------------------------------------------------------

  private renderPiece(piece: Piece) {
    if (!piece.el) return;
    const inSimulation = piece.mode === 'physics' || piece.mode === 'waiting';
    const x = inSimulation ? piece.body.position.x : piece.x;
    const y = inSimulation ? piece.body.position.y : piece.y;
    const angle = inSimulation ? piece.body.angle : piece.angle;
    const transform = `translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${((angle * 180) / Math.PI).toFixed(2)})`;
    if (transform !== piece.lastTransform) {
      piece.el.setAttribute('transform', transform);
      piece.lastTransform = transform;
    }
  }

  private renderAll() {
    this.pieces.forEach((piece) => this.renderPiece(piece));
  }

  private flush() {
    if (this.dirty) {
      this.dirty = false;
      this.callbacks.onChange({
        pieces: [...this.pieces.values()].map((p) => ({ id: p.id, d: p.path, fill: p.fill })),
        shattered: [...this.shattered],
      });
    }
    if (this.restoredAll) {
      this.restoredAll = false;
      this.callbacks.onAllRestored();
    }
  }
}
