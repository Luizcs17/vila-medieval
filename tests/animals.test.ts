import { describe, expect, it } from 'vitest';
import { ANIMAL_SPAWN_INTERVAL, PLAYER_MAX_HP, PLAYER_REGEN_DELAY, PLAYER_REGEN_EVERY } from '../src/config';
import {
  ALL_SPECIES,
  AnimalSpawner,
  hurtAnimal,
  newAnimal,
  pickAnimalTile,
  SPECIES,
  type Species,
  takeMeat,
  targetPopulation,
} from '../src/game/animals';
import { PlayerStats } from '../src/game/player';
import { generateMap, isWalkable } from '../src/world/map';

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const zero = () => Object.fromEntries(ALL_SPECIES.map((s) => [s, 0])) as Record<Species, number>;

describe('species', () => {
  it('has neutral prey, a defensive animal and aggressive predators', () => {
    expect(SPECIES.rabbit.temper).toBe('skittish');
    expect(SPECIES.deer.temper).toBe('skittish');
    expect(SPECIES.boar.temper).toBe('defensive');
    expect(SPECIES.wolf.temper).toBe('aggressive');
    expect(SPECIES.bear.temper).toBe('aggressive');
    for (const s of ALL_SPECIES) expect(SPECIES[s].meat).toBeGreaterThan(0);
  });

  it('is slower than the running player, so you can always escape', () => {
    for (const s of ALL_SPECIES) if (SPECIES[s].temper === 'aggressive') expect(SPECIES[s].runSpeed).toBeLessThan(3.5);
  });

  it('has more wolves at night', () => {
    expect(targetPopulation('wolf', true)).toBeGreaterThan(targetPopulation('wolf', false));
    expect(targetPopulation('deer', true)).toBe(targetPopulation('deer', false));
  });
});

describe('animal life', () => {
  it('dies at 0 HP, once, and leaves a carcass with meat', () => {
    const a = newAnimal(1, 'deer', { x: 5, y: 5 });
    expect(hurtAnimal(a, 2, 100)).toBe(false);
    expect(hurtAnimal(a, 5, 101)).toBe(true);
    expect(a).toMatchObject({ dead: true, hp: 0, diedAt: 101, meat: SPECIES.deer.meat });
    expect(hurtAnimal(a, 1, 102)).toBe(false);
  });

  it('gives meat only from carcasses, up to what is left', () => {
    const a = newAnimal(1, 'boar', { x: 5, y: 5 });
    expect(takeMeat(a, 3)).toBe(0); // alive
    hurtAnimal(a, 99, 0);
    expect(takeMeat(a, 3)).toBe(3);
    expect(takeMeat(a, 10)).toBe(SPECIES.boar.meat - 3);
    expect(a.meat).toBe(0);
  });
});

describe('spawning', () => {
  it('refills the species that is most below its target, on an interval', () => {
    const sp = new AnimalSpawner();
    const alive = zero();
    expect(sp.update(0.1, alive, false)).not.toBeNull(); // first call spawns immediately
    expect(sp.update(1, alive, false)).toBeNull(); // then waits
    const full = Object.fromEntries(ALL_SPECIES.map((s) => [s, targetPopulation(s, false)])) as Record<Species, number>;
    expect(sp.update(ANIMAL_SPAWN_INTERVAL, full, false)).toBeNull();
    expect(sp.update(ANIMAL_SPAWN_INTERVAL, full, true)).toBe('wolf'); // night wants more wolves
  });

  it('places forest animals near trees and keeps away from given points', () => {
    const map = generateMap();
    const rng = seeded(4);
    const village = { x: Math.floor(map.spawn.x), y: Math.floor(map.spawn.y) };
    for (const s of ALL_SPECIES) {
      for (let i = 0; i < 10; i++) {
        const t = pickAnimalTile(map, rng, s, [village], 14)!;
        expect(isWalkable(map, t.x, t.y)).toBe(true);
        expect(Math.hypot(t.x - village.x, t.y - village.y)).toBeGreaterThanOrEqual(14);
      }
    }
  });
});

describe('player stats', () => {
  it('takes damage, knocks out at 0 and regenerates after a pause', () => {
    const p = new PlayerStats();
    expect(p.hurt(3)).toBe(false);
    expect(p.hp).toBe(PLAYER_MAX_HP - 3);
    p.update(PLAYER_REGEN_DELAY - 0.1);
    expect(p.hp).toBe(PLAYER_MAX_HP - 3); // still recovering from the hit
    p.update(0.1 + PLAYER_REGEN_EVERY);
    expect(p.hp).toBe(PLAYER_MAX_HP - 2);
    p.update(1000);
    expect(p.hp).toBe(PLAYER_MAX_HP);
    expect(p.hurt(999)).toBe(true);
    expect(p.hp).toBe(0);
  });
});
