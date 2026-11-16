import { describe, expect, it } from 'vitest';
import { Buildings } from '../src/game/buildings';
import { createFactions, policyAccepts } from '../src/game/factions';
import { autoPlot } from '../src/game/farms';
import { Inventory } from '../src/game/inventory';
import { Population } from '../src/game/npcs';
import { foundTown, populateTown } from '../src/game/towns';
import { Ground, generateMap, Obj } from '../src/world/map';

const seq = (seed: number) => () => {
  seed = (seed * 9301 + 49297) % 233280;
  return seed / 233280;
};

describe('rival villages', () => {
  it('are founded with a farm and an embassy, and staff food jobs first', () => {
    const map = generateMap();
    const buildings = new Buildings(map);
    const f = createFactions(map.sites, new Inventory())[1];
    const placed = foundTown(buildings, f, seq(5));
    const types = placed.map((b) => b.type);
    expect(types).toContain('farm');
    expect(types).toContain('embassy');
    const pop = new Population(buildings);
    populateTown(pop, buildings, f, seq(9), 4);
    const jobs = pop.villagersOf(f.id).map((n) => buildings.list.find((b) => b.id === n.jobId)?.type);
    // With only 4 people, one each goes to the four most urgent jobs: food first.
    expect(jobs.sort()).toEqual(['farm', 'hunter', 'lumberjack', 'quarry']);
  });

  it('get an automatic planting area of free grass', () => {
    const map = generateMap();
    const buildings = new Buildings(map);
    const s = map.sites[0];
    for (let y = s.y - 8; y <= s.y + 8; y++)
      for (let x = s.x - 8; x <= s.x + 8; x++) {
        map.ground[y * map.w + x] = Ground.Grass;
        map.objects[y * map.w + x] = Obj.None;
      }
    const farm = buildings.place('farm', s.x, s.y, true, 1);
    const tiles = autoPlot(map, farm, () => -1);
    expect(tiles).toHaveLength(25);
    expect(autoPlot(map, farm, () => 3)).toBeNull(); // all of it someone else's land
  });
});

describe('diplomats recruiting', () => {
  it('follow the village policy', () => {
    expect(policyAccepts('none', 'master')).toBe(false);
    expect(policyAccepts('special', 'common')).toBe(false);
    expect(policyAccepts('special', 'skilled')).toBe(true);
    expect(policyAccepts('all', 'common')).toBe(true);
    expect(policyAccepts(undefined, 'master')).toBe(false);
  });
});
