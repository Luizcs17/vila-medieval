import { MAP_H, MAP_SEED, MAP_W, TOWN_SITES } from '../config';

export enum Ground {
  Grass,
  Water,
  Sand,
  Dirt,
}

export enum Obj {
  None,
  Tree,
  Pine,
  Rock,
  Iron,
  /** What a fully chopped tree leaves behind. Walkable. */
  Stump,
  /** A tile covered by a building (see src/game/buildings.ts for which one). */
  Building,
  /** Halfway between stump and grown tree. Walkable. */
  Sapling,
  /** A palisade gate: people walk through, animals and raiders don't. */
  Gate,
}

/** Objects that block movement. Anything not listed here can be walked over. */
const BLOCKING = new Set<Obj>([Obj.Tree, Obj.Pine, Obj.Rock, Obj.Iron, Obj.Building]);

export interface WorldMap {
  w: number;
  h: number;
  ground: Ground[];
  objects: Obj[];
  /** Per-tile cosmetic variant index (which texture variation to draw). */
  variant: number[];
  /** Where the player starts, in grid coordinates (tile center). */
  spawn: { x: number; y: number };
  /** Village centre tiles: [0] is the player's, the rest are rival towns (same order as TOWN_SITES). */
  sites: { x: number; y: number }[];
}

// ---------- deterministic noise ----------

function hash2(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x: number, y: number, seed: number): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  for (let o = 0; o < 3; o++) {
    sum += valueNoise(x * 2 ** o, y * 2 ** o, seed + o * 101) * amp;
    norm += amp;
    amp *= 0.5;
  }
  return sum / norm;
}

// ---------- generation ----------

/**
 * Builds the v1 map. It is "fixed" because the seed is constant: same input, same map.
 * Layout: a central grass clearing (future village site) surrounded by forests,
 * lakes, a rocky quarry zone with stone and iron, all bordered by water.
 */
export function generateMap(seed = MAP_SEED, w = MAP_W, h = MAP_H): WorldMap {
  const n = w * h;
  const ground = new Array<Ground>(n).fill(Ground.Grass);
  const objects = new Array<Obj>(n).fill(Obj.None);
  const variant = new Array<number>(n).fill(0);
  const cx = Math.floor(w / 2);
  const cy = Math.floor(h / 2);
  // Town sites: index 0 is the player's (map centre), the rest are rival villages.
  const sites = [{ x: cx, y: cy }, ...TOWN_SITES.map((p) => ({ x: Math.floor(p.x * w), y: Math.floor(p.y * h) }))];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const r = hash2(x, y, seed + 9001);
      // Distance to the nearest town site: every village gets a dry clearing.
      let dist = Infinity;
      for (const s of sites) dist = Math.min(dist, Math.hypot(x - s.x, y - s.y));
      const edge = Math.min(x, y, w - 1 - x, h - 1 - y);
      const lake = fbm(x / 11, y / 11, seed);
      const forest = fbm(x / 8, y / 8, seed + 500);
      const quarry = fbm(x / 10, y / 10, seed + 1000);

      variant[i] = Math.floor(hash2(x, y, seed + 42) * 4);

      // Water: map border (irregular coastline) and inland lakes away from the spawn.
      const coast = 2 + fbm(x / 6, y / 6, seed + 1500) * 4;
      if (edge < coast || (lake < 0.33 && dist > 9)) {
        ground[i] = Ground.Water;
        continue;
      }
      if (edge < coast + 1.2 || (lake < 0.38 && dist > 8)) {
        ground[i] = Ground.Sand;
      }

      if (dist < 6) continue; // keep the spawn clearing empty

      if (quarry > 0.67 && ground[i] === Ground.Grass) {
        ground[i] = Ground.Dirt;
        if (r < 0.07) objects[i] = Obj.Iron;
        else if (r < 0.25) objects[i] = Obj.Rock;
        continue;
      }

      if (ground[i] !== Ground.Grass) continue;
      if (forest > 0.55 && r < 0.6) objects[i] = forest > 0.66 ? Obj.Pine : Obj.Tree;
      else if (r < 0.025) objects[i] = Obj.Tree;
      else if (r < 0.032) objects[i] = Obj.Rock;
    }
  }

  return { w, h, ground, objects, variant, spawn: { x: cx + 0.5, y: cy + 0.5 }, sites };
}

export function inBounds(map: WorldMap, tx: number, ty: number): boolean {
  return tx >= 0 && ty >= 0 && tx < map.w && ty < map.h;
}

/** True when a character can stand on tile (tx, ty). */
export function isWalkable(map: WorldMap, tx: number, ty: number): boolean {
  if (!inBounds(map, tx, ty)) return false;
  const i = ty * map.w + tx;
  return map.ground[i] !== Ground.Water && !BLOCKING.has(map.objects[i]);
}

export function tileIndex(map: WorldMap, tx: number, ty: number): number {
  return ty * map.w + tx;
}

/** Center of a tile index, in grid coordinates. */
export function tileCenter(map: WorldMap, i: number): { x: number; y: number } {
  return { x: (i % map.w) + 0.5, y: Math.floor(i / map.w) + 0.5 };
}
