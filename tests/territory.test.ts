import { describe, expect, it } from 'vitest';
import { BUILDING_DEFS, Buildings } from '../src/game/buildings';
import { createFactions } from '../src/game/factions';
import { Inventory } from '../src/game/inventory';
import { Population } from '../src/game/npcs';
import { NO_OWNER, Territory } from '../src/game/territory';
import { foundTown, populateTown } from '../src/game/towns';
import { generateMap, isWalkable } from '../src/world/map';

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe('map sites', () => {
  it('has a dry clearing for the player and every rival town', () => {
    const map = generateMap();
    expect(map.sites.length).toBe(4);
    for (const s of map.sites) {
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) expect(isWalkable(map, s.x + dx, s.y + dy)).toBe(true);
    }
  });
});

describe('territory', () => {
  it('is claimed around buildings, nearest building wins', () => {
    const map = generateMap();
    const b = new Buildings(map);
    const t = new Territory(map);
    const [p, r] = map.sites;
    b.place('stockpile', p.x, p.y, true, 0);
    b.place('stockpile', r.x, r.y, true, 1);
    t.recompute(b.list);
    expect(t.ownerAt(p.x, p.y)).toBe(0);
    expect(t.ownerAt(p.x + 8, p.y)).toBe(0);
    expect(t.ownerAt(p.x + 11, p.y)).toBe(NO_OWNER);
    expect(t.ownerAt(r.x, r.y)).toBe(1);
    expect(t.area(0)).toBeGreaterThan(200);
  });

  it('only lets you build on your own land (growing from the border)', () => {
    const map = generateMap();
    const b = new Buildings(map);
    const t = new Territory(map);
    const p = map.sites[0];
    b.place('stockpile', p.x, p.y, true, 0);
    t.recompute(b.list);
    expect(t.canBuild(0, p.x + 3, p.y + 3, 2)).toBe(true);
    expect(t.canBuild(0, p.x + 20, p.y, 2)).toBe(false); // outside
    expect(t.canBuild(1, p.x + 3, p.y + 3, 2)).toBe(false); // someone else's land
    // A house at the edge pushes the border out.
    b.place('house', p.x + 7, p.y, true, 0);
    t.recompute(b.list);
    expect(t.ownerAt(p.x + 11, p.y)).toBe(0); // was outside the hall's radius 9
    expect(BUILDING_DEFS.stockpile.claim).toBeGreaterThan(BUILDING_DEFS.house.claim);
  });
});

describe('rival towns', () => {
  it('are founded with a hall, houses and workplaces, and staffed', () => {
    const map = generateMap();
    const b = new Buildings(map);
    const factions = createFactions(map.sites, new Inventory());
    const pop = new Population(b);
    const rng = seeded(11);
    for (const f of factions.slice(1)) {
      const made = foundTown(b, f, rng);
      const types = made.map((x) => x.type);
      expect(types).toContain('stockpile');
      expect(types.filter((x) => x === 'house').length).toBeGreaterThanOrEqual(2);
      expect(made.every((x) => x.faction === f.id && x.built)).toBe(true);
      const people = populateTown(pop, b, f, rng, 6);
      expect(people).toHaveLength(6);
      expect(people.every((n) => n.faction === f.id && n.role === 'villager' && n.homeId !== null)).toBe(true);
      expect(people.some((n) => n.jobId !== null)).toBe(true);
      expect(f.rulerId).toBe(people[0].id);
    }
    expect(pop.villagers).toHaveLength(0); // none of them are the player's
  });
});

describe('rival town jobs', () => {
  it('respect slot limits for rival workers too', () => {
    const map = generateMap();
    const b = new Buildings(map);
    const pop = new Population(b);
    const factions = createFactions(map.sites, new Inventory());
    foundTown(b, factions[1], seeded(4));
    populateTown(pop, b, factions[1], seeded(4), 8);
    for (const w of b.list.filter((x) => x.faction === 1 && BUILDING_DEFS[x.type].job)) {
      expect(pop.workers(w.id).length).toBeLessThanOrEqual(BUILDING_DEFS[w.type].job!.slots);
    }
    const soldiers = b.list.filter((x) => x.faction === 1 && x.type === 'barracks').flatMap((x) => pop.workers(x.id));
    expect(soldiers.length).toBeGreaterThan(0);
  });
});
