import { ANIMAL_SPAWN_INTERVAL, WILDLIFE_SCALE } from '../config';
import { inBounds, isWalkable, Obj, tileIndex, type WorldMap } from '../world/map';
import type { Rng } from './npcs';

export type Species = 'rabbit' | 'deer' | 'boar' | 'wolf' | 'bear';

/**
 * skittish: runs from people (prey for hunters).
 * defensive: ignores people until hurt, then fights back.
 * aggressive: attacks people who come within `aggroRange` (bigger at night).
 */
export type Temper = 'skittish' | 'defensive' | 'aggressive';

export interface SpeciesDef {
  name: string;
  hp: number;
  /** Meat left on the carcass. */
  meat: number;
  /** Hide left on the carcass (becomes leather). */
  leather: number;
  /** Tiles per second while wandering / running. */
  speed: number;
  runSpeed: number;
  temper: Temper;
  /** Skittish animals run when a person is this close. */
  fleeRange: number;
  /** Aggressive animals charge when a person is this close (×1.4 at night). */
  aggroRange: number;
  damage: number;
  attackCooldown: number;
  /** How many the world tries to keep alive (day / night). */
  population: number;
  nightPopulation?: number;
  habitat: 'forest' | 'open';
}

export const SPECIES: Record<Species, SpeciesDef> = {
  rabbit: {
    name: 'Coelho',
    hp: 1,
    meat: 1,
    leather: 0,
    speed: 1.2,
    runSpeed: 3.4,
    temper: 'skittish',
    fleeRange: 3.5,
    aggroRange: 0,
    damage: 0,
    attackCooldown: 0,
    population: 8,
    habitat: 'open',
  },
  deer: {
    name: 'Cervo',
    hp: 3,
    meat: 4,
    leather: 2,
    speed: 1.3,
    runSpeed: 3.2,
    temper: 'skittish',
    fleeRange: 4.5,
    aggroRange: 0,
    damage: 0,
    attackCooldown: 0,
    population: 7,
    habitat: 'open',
  },
  boar: {
    name: 'Javali',
    hp: 5,
    meat: 5,
    leather: 3,
    speed: 1.1,
    runSpeed: 2.8,
    temper: 'defensive',
    fleeRange: 0,
    aggroRange: 0,
    damage: 2,
    attackCooldown: 1.4,
    population: 4,
    habitat: 'forest',
  },
  wolf: {
    name: 'Lobo',
    hp: 4,
    meat: 2,
    leather: 1,
    speed: 1.4,
    runSpeed: 3.0,
    temper: 'aggressive',
    fleeRange: 0,
    aggroRange: 5,
    damage: 1,
    attackCooldown: 1.1,
    population: 3,
    nightPopulation: 6,
    habitat: 'forest',
  },
  bear: {
    name: 'Urso',
    // Tuned so one person with a spear loses and two win (tests/animals.test.ts, "bear balance").
    hp: 18,
    meat: 10,
    leather: 5,
    speed: 1.0,
    runSpeed: 2.6,
    temper: 'aggressive',
    fleeRange: 0,
    aggroRange: 3.5,
    damage: 5,
    attackCooldown: 1.2,
    population: 1,
    habitat: 'forest',
  },
};

export const ALL_SPECIES = Object.keys(SPECIES) as Species[];

/** Serializable state of one animal (alive or a carcass). */
export interface AnimalData {
  id: number;
  species: Species;
  gx: number;
  gy: number;
  hp: number;
  homeX: number;
  homeY: number;
  dead: boolean;
  /** Meat left on the carcass. */
  meat: number;
  /** Hide left on the carcass. */
  leather: number;
  /** Game time of death (carcasses rot after a while). */
  diedAt: number;
}

export function newAnimal(id: number, species: Species, tile: { x: number; y: number }): AnimalData {
  const def = SPECIES[species];
  return {
    id,
    species,
    gx: tile.x + 0.5,
    gy: tile.y + 0.5,
    hp: def.hp,
    homeX: tile.x + 0.5,
    homeY: tile.y + 0.5,
    dead: false,
    meat: def.meat,
    leather: def.leather,
    diedAt: 0,
  };
}

/** Applies damage. Returns true if this hit killed the animal. */
export function hurtAnimal(a: AnimalData, damage: number, now: number): boolean {
  if (a.dead) return false;
  a.hp = Math.max(0, a.hp - damage);
  if (a.hp > 0) return false;
  a.dead = true;
  a.diedAt = now;
  return true;
}

/** Takes up to `max` meat from a carcass. Returns how much was taken. */
export function takeMeat(a: AnimalData, max: number): number {
  if (!a.dead) return 0;
  const n = Math.max(0, Math.min(max, a.meat));
  a.meat -= n;
  return n;
}

/** Takes up to `max` leather from a carcass. */
export function takeLeather(a: AnimalData, max: number): number {
  if (!a.dead) return 0;
  const n = Math.max(0, Math.min(max, a.leather ?? 0));
  a.leather = (a.leather ?? 0) - n;
  return n;
}

/** How many of each species should be alive right now. */
export function targetPopulation(species: Species, night: boolean): number {
  const def = SPECIES[species];
  return Math.round((night ? (def.nightPopulation ?? def.population) : def.population) * WILDLIFE_SCALE);
}

/** Every ANIMAL_SPAWN_INTERVAL game seconds, names one species that is below its target (most missing first). */
export class AnimalSpawner {
  private timer = 0;

  update(dt: number, alive: Record<Species, number>, night: boolean): Species | null {
    this.timer -= dt;
    if (this.timer > 0) return null;
    this.timer = ANIMAL_SPAWN_INTERVAL;
    let best: Species | null = null;
    let bestMissing = 0;
    for (const s of ALL_SPECIES) {
      const missing = targetPopulation(s, night) - alive[s];
      if (missing > bestMissing) {
        bestMissing = missing;
        best = s;
      }
    }
    return best;
  }
}

function treesAround(map: WorldMap, x: number, y: number, r: number): number {
  let n = 0;
  for (let ty = y - r; ty <= y + r; ty++)
    for (let tx = x - r; tx <= x + r; tx++) {
      if (!inBounds(map, tx, ty)) continue;
      const o = map.objects[tileIndex(map, tx, ty)];
      if (o === Obj.Tree || o === Obj.Pine) n++;
    }
  return n;
}

/**
 * A walkable tile for `species` at least `minDist` tiles away from every point in `avoid`
 * (the village, the player). Forest animals want trees nearby; open-field animals want few.
 */
export function pickAnimalTile(
  map: WorldMap,
  rng: Rng,
  species: Species,
  avoid: { x: number; y: number }[],
  minDist: number,
): { x: number; y: number } | null {
  const forest = SPECIES[species].habitat === 'forest';
  let fallback: { x: number; y: number } | null = null;
  for (let tries = 0; tries < 400; tries++) {
    const x = Math.floor(rng() * map.w);
    const y = Math.floor(rng() * map.h);
    if (!isWalkable(map, x, y)) continue;
    if (avoid.some((p) => Math.hypot(p.x - x, p.y - y) < minDist)) continue;
    const trees = treesAround(map, x, y, 2);
    if (forest ? trees >= 4 : trees <= 2) return { x, y };
    fallback ??= { x, y };
  }
  return fallback;
}
