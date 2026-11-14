import { describe, expect, it } from 'vitest';
import { BEDS_PER_HOUSE, MAX_WANDERERS, WANDERER_FIRST_SPAWN } from '../src/config';
import { Buildings } from '../src/game/buildings';
import { Inventory } from '../src/game/inventory';
import {
  canPayFrom,
  compass,
  generateWanderer,
  type NpcData,
  Population,
  payFrom,
  pickSpawnTile,
  TRAITS,
  WandererSpawner,
} from '../src/game/npcs';
import { SlotInventory } from '../src/game/slots';
import { generateMap, isWalkable, Obj, tileIndex } from '../src/world/map';
import { findPath, pathTo } from '../src/world/path';

/** Deterministic RNG for tests. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const spawnOf = (map: ReturnType<typeof generateMap>) => ({ x: Math.floor(map.spawn.x), y: Math.floor(map.spawn.y) });

describe('pathfinding', () => {
  it('finds a walkable path across the clearing', () => {
    const map = generateMap();
    const s = spawnOf(map);
    const path = pathTo(map, s, { x: s.x + 4, y: s.y + 3 })!;
    expect(path.length).toBeGreaterThanOrEqual(4);
    expect(path.at(-1)).toEqual({ x: s.x + 4, y: s.y + 3 });
    for (const t of path) expect(isWalkable(map, t.x, t.y)).toBe(true);
  });

  it('walks around obstacles and never cuts corners', () => {
    const map = generateMap();
    const s = spawnOf(map);
    // A wall of trees between start and goal, with a gap at the bottom.
    for (let y = s.y - 3; y <= s.y + 2; y++) map.objects[tileIndex(map, s.x + 1, y)] = Obj.Tree;
    const path = pathTo(map, s, { x: s.x + 2, y: s.y })!;
    expect(path).not.toBeNull();
    let prev = s;
    for (const t of path) {
      expect(isWalkable(map, t.x, t.y)).toBe(true);
      if (t.x !== prev.x && t.y !== prev.y) {
        expect(isWalkable(map, t.x, prev.y) && isWalkable(map, prev.x, t.y)).toBe(true);
      }
      prev = t;
    }
  });

  it('returns null when the goal is unreachable and [] when already there', () => {
    const map = generateMap();
    const s = spawnOf(map);
    expect(findPath(map, s, () => false, s, 500)).toBeNull();
    expect(pathTo(map, s, s)).toEqual([]);
  });
});

describe('wanderer generation', () => {
  it('produces valid NPCs whose requests scale with tier', () => {
    const rng = seeded(1);
    const seen = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const n = generateWanderer(rng, i, 1000);
      seen.add(n.tier);
      expect(n.name.length).toBeGreaterThan(0);
      expect(n.traits.length).toBe(n.tier === 'master' ? 2 : 1);
      for (const t of n.traits) expect(TRAITS[t]).toBeDefined();
      const asked = Object.values(n.request).reduce((a, b) => a + (b ?? 0), 0);
      if (n.tier === 'common') expect(asked).toBe(0);
      else expect(asked).toBeGreaterThan(0);
      if (n.tier === 'master') expect(n.request.iron).toBeGreaterThan(0);
      if (n.tier !== 'common') expect(n.traits.every((t) => TRAITS[t].positive)).toBe(true);
    }
    expect(seen).toEqual(new Set(['common', 'skilled', 'master']));
  });
});

describe('paying from inventory + stockpile', () => {
  it('takes from what you carry first, then the stockpile', () => {
    const inv = new SlotInventory(27, 9, 40);
    const stock = new Inventory();
    inv.add('wood', 4);
    stock.add('wood', 10);
    expect(canPayFrom({ wood: 15 }, inv, stock)).toBe(false);
    expect(payFrom({ wood: 15 }, inv, stock)).toBe(false);
    expect(payFrom({ wood: 10 }, inv, stock)).toBe(true);
    expect(inv.count('wood')).toBe(0);
    expect(stock.items.wood).toBe(4);
  });
});

describe('population', () => {
  const setup = () => {
    const map = generateMap();
    const buildings = new Buildings(map);
    const pop = new Population(buildings);
    const s = spawnOf(map);
    const wanderer = (request: NpcData['request'] = {}): NpcData => {
      const n = { ...generateWanderer(seeded(7), pop.newId(), 1000), request };
      pop.npcs.push(n);
      return n;
    };
    return { map, buildings, pop, s, wanderer, inv: new SlotInventory(27, 9, 40), stock: new Inventory() };
  };

  it('needs a built house with a free bed', () => {
    const { buildings, pop, s, wanderer, inv, stock } = setup();
    const n = wanderer();
    expect(pop.check(n, inv, stock)).toEqual({ bed: false, items: true, ok: false });
    const site = buildings.place('house', s.x - 3, s.y - 3); // unbuilt sites don't count
    expect(pop.beds).toBe(0);
    buildings.work(site, 999);
    expect(pop.beds).toBe(BEDS_PER_HOUSE);
    expect(pop.recruit(n, inv, stock)).toBe(site);
    expect(n.role).toBe('villager');
    expect(n.homeId).toBe(site.id);
  });

  it('fills a house, then refuses until another is built', () => {
    const { buildings, pop, s, wanderer, inv, stock } = setup();
    buildings.work(buildings.place('house', s.x - 3, s.y - 3), 999);
    for (let i = 0; i < BEDS_PER_HOUSE; i++) expect(pop.recruit(wanderer(), inv, stock)).not.toBeNull();
    const extra = wanderer();
    expect(pop.freeBeds).toBe(0);
    expect(pop.recruit(extra, inv, stock)).toBeNull();
    const second = buildings.place('house', s.x + 2, s.y + 2);
    buildings.work(second, 999);
    expect(pop.recruit(extra, inv, stock)).toBe(second);
  });

  it('charges the request and refuses when it cannot be paid', () => {
    const { buildings, pop, s, wanderer, inv, stock } = setup();
    buildings.work(buildings.place('house', s.x - 3, s.y - 3), 999);
    const n = wanderer({ iron: 5 });
    expect(pop.recruit(n, inv, stock)).toBeNull();
    stock.add('iron', 3);
    inv.add('iron', 2);
    expect(pop.recruit(n, inv, stock)).not.toBeNull();
    expect(stock.items.iron + inv.count('iron')).toBe(0);
  });
});

describe('spawning', () => {
  it('spawns the first wanderer early, then periodically, up to the cap', () => {
    const sp = new WandererSpawner(seeded(3));
    expect(sp.update(WANDERER_FIRST_SPAWN - 1, 0)).toBe(false);
    expect(sp.update(1, 0)).toBe(true);
    let spawned = 0;
    for (let t = 0; t < 2000; t++) if (sp.update(1, 0)) spawned++;
    expect(spawned).toBeGreaterThan(5);
    let capped = 0;
    for (let t = 0; t < 2000; t++) if (sp.update(1, MAX_WANDERERS)) capped++;
    expect(capped).toBe(0);
  });

  it('picks walkable spawn tiles away from the village', () => {
    const map = generateMap();
    const c = spawnOf(map);
    const rng = seeded(9);
    for (let i = 0; i < 50; i++) {
      const t = pickSpawnTile(map, rng, c)!;
      expect(isWalkable(map, t.x, t.y)).toBe(true);
      expect(Math.hypot(t.x - c.x, t.y - c.y)).toBeGreaterThanOrEqual(11);
    }
  });

  it('describes directions as seen on screen', () => {
    expect(compass(-5, -5)).toBe('ao norte'); // grid (-1,-1) is straight up on screen
    expect(compass(5, 5)).toBe('ao sul');
    expect(compass(5, -5)).toBe('a leste');
    expect(compass(-5, 5)).toBe('a oeste');
  });
});
