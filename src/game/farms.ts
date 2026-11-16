import { DAY_SECONDS } from '../config';
import { Ground, inBounds, Obj, tileIndex, type WorldMap } from '../world/map';
import { BUILDING_DEFS, type Building } from './buildings';

/** A farm's planting area is at most FARM_MAX × FARM_MAX tiles. */
export const FARM_MAX = 5;
/** …and every tile of it within this many tiles of the farm's centre. */
export const FARM_REACH = 8;
/** Days from planting to harvest. */
export const GROW_SECONDS = 3 * DAY_SECONDS;
/** Food each ripe crop gives. */
export const FOOD_PER_CROP = 2;
/** Chance a harvest gives two seeds instead of one. */
export const DOUBLE_SEED_CHANCE = 0.15;

/** A farm's planting area: its tiles, and when each crop was planted (tile index → game time). */
export interface Plot {
  tiles: number[];
  planted: Record<number, number>;
}

/** What the field objects are: tilled soil, a growing crop, a crop ready to harvest. */
export const FIELD_OBJS = new Set<Obj>([Obj.Field, Obj.Crop, Obj.CropRipe]);

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The rectangle dragged from (ax, ay) to (bx, by), cut down to FARM_MAX on each side (keeping the start corner). */
export function plotRect(ax: number, ay: number, bx: number, by: number): Rect {
  const clamp = (a: number, b: number) => (b >= a ? Math.min(b, a + FARM_MAX - 1) : Math.max(b, a - FARM_MAX + 1));
  const cx = clamp(ax, bx);
  const cy = clamp(ay, by);
  return { x0: Math.min(ax, cx), y0: Math.min(ay, cy), x1: Math.max(ax, cx), y1: Math.max(ay, cy) };
}

export function rectTiles(map: WorldMap, r: Rect): number[] {
  const out: number[] = [];
  for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) if (inBounds(map, x, y)) out.push(tileIndex(map, x, y));
  return out;
}

/**
 * Why tile `i` can't be part of `farm`'s plot (or null if it can): it must be grass ground (not
 * sand, dirt/stone or water), free (or a grass tuft, or already this farm's field), near the farm,
 * and not on another village's land.
 */
export function plotTileProblem(map: WorldMap, farm: Building, i: number, ownerAt: (i: number) => number): string | null {
  const def = BUILDING_DEFS[farm.type];
  const x = i % map.w;
  const y = Math.floor(i / map.w);
  if (Math.hypot(x + 0.5 - (farm.tx + def.size / 2), y + 0.5 - (farm.ty + def.size / 2)) > FARM_REACH)
    return 'Longe demais da fazenda';
  if (map.ground[i] !== Ground.Grass) return 'Só dá para plantar na grama';
  const o = map.objects[i];
  const mine = farm.plot?.tiles.includes(i) ?? false;
  if (FIELD_OBJS.has(o) && !mine) return 'Já é plantação de outra fazenda';
  if (o !== Obj.None && o !== Obj.Grass && !FIELD_OBJS.has(o)) return 'Tem algo no caminho';
  const owner = ownerAt(i);
  if (owner !== -1 && owner !== farm.faction) return 'Território de outra vila';
  return null;
}

/**
 * Sets a new planting area: tiles leaving the plot go back to plain ground (their crops are lost),
 * new tiles become tilled soil. Returns every tile whose object changed.
 */
export function setPlot(map: WorldMap, farm: Building, tiles: number[]): number[] {
  const old = farm.plot ?? { tiles: [], planted: {} };
  const keep = new Set(tiles);
  const changed: number[] = [];
  for (const i of old.tiles) {
    if (keep.has(i)) continue;
    if (FIELD_OBJS.has(map.objects[i])) {
      map.objects[i] = Obj.None;
      changed.push(i);
    }
  }
  const planted: Record<number, number> = {};
  for (const i of tiles) {
    if (old.planted[i] !== undefined && FIELD_OBJS.has(map.objects[i])) planted[i] = old.planted[i];
    if (!FIELD_OBJS.has(map.objects[i])) {
      map.objects[i] = Obj.Field;
      changed.push(i);
    }
  }
  farm.plot = { tiles: [...tiles], planted };
  return changed;
}

/** Removes a farm's fields (demolished or destroyed). Returns the tiles that changed. */
export function clearPlot(map: WorldMap, farm: Building): number[] {
  const changed = farm.plot ? setPlot(map, farm, []) : [];
  farm.plot = undefined;
  return changed;
}

export type FarmTask = { kind: 'harvest' | 'plant'; tile: number };

/** The farmer's next job: harvest a ripe crop first, else plant an empty field (if there are seeds). */
export function nextFarmTask(
  map: WorldMap,
  plot: Plot | undefined,
  haveSeeds: boolean,
  skip: Set<number> = new Set(),
): FarmTask | null {
  if (!plot) return null;
  for (const i of plot.tiles) if (!skip.has(i) && map.objects[i] === Obj.CropRipe) return { kind: 'harvest', tile: i };
  if (!haveSeeds) return null;
  for (const i of plot.tiles) if (!skip.has(i) && map.objects[i] === Obj.Field) return { kind: 'plant', tile: i };
  return null;
}

export function plant(map: WorldMap, plot: Plot, i: number, now: number): boolean {
  if (map.objects[i] !== Obj.Field || !plot.tiles.includes(i)) return false;
  map.objects[i] = Obj.Crop;
  plot.planted[i] = now;
  return true;
}

/** Crops planted GROW_SECONDS ago become ripe. Returns the tiles that changed. */
export function ripen(map: WorldMap, plot: Plot | undefined, now: number): number[] {
  if (!plot) return [];
  const changed: number[] = [];
  for (const i of plot.tiles) {
    const t = plot.planted[i];
    if (map.objects[i] === Obj.Crop && t !== undefined && now - t >= GROW_SECONDS) {
      map.objects[i] = Obj.CropRipe;
      changed.push(i);
    }
  }
  return changed;
}

/** Harvests a ripe crop: the field is tilled again. Returns what it gave (FOOD_PER_CROP food, one or two seeds), or null. */
export function harvestCrop(map: WorldMap, plot: Plot, i: number, rng: () => number): { food: number; seeds: number } | null {
  if (map.objects[i] !== Obj.CropRipe) return null;
  map.objects[i] = Obj.Field;
  delete plot.planted[i];
  return { food: FOOD_PER_CROP, seeds: rng() < DOUBLE_SEED_CHANCE ? 2 : 1 };
}

/** How far along a crop is, 0–1 (for the UI). */
export const growth = (plot: Plot, i: number, now: number) =>
  plot.planted[i] === undefined ? 0 : Math.min(1, (now - plot.planted[i]) / GROW_SECONDS);
