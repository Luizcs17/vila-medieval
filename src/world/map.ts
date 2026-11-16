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
  /** Cobbled road: walkable, faster to travel, preferred by pathfinding. */
  Road,
  /** A grass tuft: gathering it sometimes gives a seed. Walkable. */
  Grass,
  /** A farm's tilled soil, a growing crop, a ripe crop. Walkable. */
  Field,
  Crop,
  CropRipe,
  /** Broken stone wall of an abandoned ruin (a dungeon). Blocks. */
  Ruin,
  /** A ruin's treasure chest, full or already looted. Blocks. */
  Chest,
  ChestOpen,
}

/** Who guards a dungeon. */
export type DungeonKind = 'wolves' | 'bears' | 'bandits';

/** An abandoned ruin with a chest at (x, y), guarded by `kind`. */
export interface DungeonSite {
  x: number;
  y: number;
  kind: DungeonKind;
}

/** Objects that block movement. Anything not listed here can be walked over. */
const BLOCKING = new Set<Obj>([Obj.Tree, Obj.Pine, Obj.Rock, Obj.Iron, Obj.Building, Obj.Ruin, Obj.Chest, Obj.ChestOpen]);

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
  /** Abandoned ruins (dungeons), far from every village. */
  dungeons: DungeonSite[];
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
      else if (r < 0.09) objects[i] = Obj.Grass;
    }
  }

  const map: WorldMap = { w, h, ground, objects, variant, spawn: { x: cx + 0.5, y: cy + 0.5 }, sites, dungeons: [] };
  map.dungeons = pickDungeonSites(map, seed);
  for (const d of map.dungeons) stampDungeon(map, d, seed);
  return map;
}

/** How many ruins the map has, how far they keep from villages and from each other. */
export const DUNGEON_COUNT = 5;
const DUNGEON_FROM_TOWN = 24;
const DUNGEON_SPACING = 25;
const DUNGEON_KINDS: DungeonKind[] = ['wolves', 'bears', 'bandits', 'wolves', 'bandits'];

/** Ruin sites: dry land far from villages, the map edge and each other (deterministic). */
export function pickDungeonSites(map: WorldMap, seed: number): DungeonSite[] {
  const out: DungeonSite[] = [];
  for (let k = 0; k < 4000 && out.length < DUNGEON_COUNT; k++) {
    const x = 12 + Math.floor(hash2(k, 7, seed + 77) * (map.w - 24));
    const y = 12 + Math.floor(hash2(k, 13, seed + 77) * (map.h - 24));
    if (map.sites.some((s) => Math.hypot(s.x - x, s.y - y) < DUNGEON_FROM_TOWN)) continue;
    if (out.some((d) => Math.hypot(d.x - x, d.y - y) < DUNGEON_SPACING)) continue;
    let dry = true;
    for (let dy = -3; dy <= 3 && dry; dy++)
      for (let dx = -3; dx <= 3 && dry; dx++) if (map.ground[(y + dy) * map.w + x + dx] === Ground.Water) dry = false;
    if (dry) out.push({ x, y, kind: DUNGEON_KINDS[out.length % DUNGEON_KINDS.length] });
  }
  return out;
}

/** Lays a ruin: a broken 5×5 ring of walls (two open sides) on a dirt floor, the chest in the middle. */
export function stampDungeon(map: WorldMap, d: DungeonSite, seed: number): void {
  for (let dy = -3; dy <= 3; dy++)
    for (let dx = -3; dx <= 3; dx++) {
      const i = (d.y + dy) * map.w + d.x + dx;
      const ring = Math.max(Math.abs(dx), Math.abs(dy)) === 2;
      const gap = (dx === 0 && dy === 2) || (dx === 2 && dy === 0) || hash2(d.x + dx, d.y + dy, seed + 5) < 0.25;
      map.ground[i] = Math.max(Math.abs(dx), Math.abs(dy)) <= 2 ? Ground.Dirt : map.ground[i];
      map.objects[i] = ring && !gap ? Obj.Ruin : Obj.None;
    }
  map.objects[d.y * map.w + d.x] = Obj.Chest;
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

/** Is there a road on tile (tx, ty)? */
export function isRoad(map: WorldMap, tx: number, ty: number): boolean {
  return inBounds(map, tx, ty) && map.objects[ty * map.w + tx] === Obj.Road;
}

export function tileIndex(map: WorldMap, tx: number, ty: number): number {
  return ty * map.w + tx;
}

/** Center of a tile index, in grid coordinates. */
export function tileCenter(map: WorldMap, i: number): { x: number; y: number } {
  return { x: (i % map.w) + 0.5, y: Math.floor(i / map.w) + 0.5 };
}
