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
  productivity,
  TRAITS,
  type TraitId,
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
      // Skill ratings carry the tier: common ≤3, skilled has a 4, master a 5 and a 4.
      const ratings = Object.values(n.skills).sort((a, b) => b - a);
      for (const r of ratings) expect(r).toBeGreaterThanOrEqual(1);
      if (n.tier === 'common') expect(ratings[0]).toBeLessThanOrEqual(3);
      if (n.tier === 'skilled') expect(ratings[0]).toBe(4);
      if (n.tier === 'master') expect(ratings.slice(0, 2)).toEqual([5, 4]);
      expect(n.jobId).toBeNull();
    }
    expect(seen).toEqual(new Set(['common', 'skilled', 'master']));
  });
});

describe('skills and productivity', () => {
  it('rates 1–5 and turns ratings and traits into a work multiplier', () => {
    const base = {
      skills: { woodcutting: 1, stonework: 3, mining: 5, hunting: 2, combat: 1, diplomacy: 1, smithing: 1, farming: 1 },
      traits: [] as TraitId[],
    };
    expect(productivity(base, 'woodcutting')).toBeCloseTo(0.75);
    expect(productivity(base, 'stonework')).toBeCloseTo(1.25);
    expect(productivity(base, 'mining')).toBeCloseTo(1.75);
    expect(productivity({ ...base, traits: ['axe'] }, 'woodcutting')).toBeCloseTo(1.125);
    expect(productivity({ ...base, traits: ['axe'] }, 'mining')).toBeCloseTo(1.75); // trait only helps its own job
    expect(productivity({ ...base, traits: ['tireless'] }, 'mining')).toBeCloseTo(2.1);
    expect(productivity({ ...base, traits: ['slow'] }, 'stonework')).toBeCloseTo(1.0);
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

describe('jobs', () => {
  it('assigns villagers to finished workplaces up to the slot limit', () => {
    const map = generateMap();
    const buildings = new Buildings(map);
    const pop = new Population(buildings);
    const s = spawnOf(map);
    const mk = () => {
      const n = { ...generateWanderer(seeded(pop.newId()), pop.newId(), 0), role: 'villager' as const };
      pop.npcs.push(n);
      return n;
    };
    const [a, b, c] = [mk(), mk(), mk()];
    const hut = buildings.place('hunter', s.x - 3, s.y - 3);
    expect(pop.assign(a, hut)).toBe(false); // not built yet
    buildings.work(hut, 999);
    expect(pop.assign(a, hut)).toBe(true);
    expect(pop.assign(b, hut)).toBe(true);
    expect(pop.assign(c, hut)).toBe(false); // 2 slots
    expect(pop.workers(hut.id)).toEqual([a, b]);
    expect(pop.unemployed()).toEqual([c]);
    pop.unassign(a);
    expect(pop.assign(c, hut)).toBe(true);
    const house = buildings.place('house', s.x + 2, s.y + 2);
    buildings.work(house, 999);
    expect(pop.assign(a, house)).toBe(false); // houses aren't workplaces
  });

  it('lists the unemployed best-first for a skill', () => {
    const map = generateMap();
    const pop = new Population(new Buildings(map));
    const mk = (rating: number) => {
      const n = { ...generateWanderer(seeded(rating), pop.newId(), 0), role: 'villager' as const, traits: [] as TraitId[] };
      n.skills = { ...n.skills, mining: rating };
      pop.npcs.push(n);
      return n;
    };
    const low = mk(1);
    const high = mk(5);
    const mid = mk(3);
    expect(pop.unemployed('mining')).toEqual([high, mid, low]);
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
