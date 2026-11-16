import { describe, expect, it } from 'vitest';
import { BUILD_MENU, BUILDING_DEFS, Buildings } from '../src/game/buildings';
import { Inventory } from '../src/game/inventory';
import { generateMap, isWalkable, Obj, tileIndex } from '../src/world/map';

const spawnTile = (map: ReturnType<typeof generateMap>) => ({ x: Math.floor(map.spawn.x), y: Math.floor(map.spawn.y) });

/** Searches the map for a valid spot for `type` (brute force; the map is small). */
function findSpot(b: Buildings, type: Parameters<Buildings['check']>[0], w: number, h: number) {
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (b.check(type, x, y).ok) return { x, y };
  return null;
}

describe('buildings', () => {
  it('a house fits in the spawn clearing and blocks its 2x2 footprint', () => {
    const map = generateMap();
    const b = new Buildings(map);
    const s = spawnTile(map);
    expect(b.check('house', s.x - 3, s.y - 3)).toEqual({ ok: true });
    const house = b.place('house', s.x - 3, s.y - 3);
    for (const i of b.footprint('house', house.tx, house.ty)) {
      expect(map.objects[i]).toBe(Obj.Building);
      expect(b.at(i)).toBe(house);
    }
    expect(isWalkable(map, s.x - 3, s.y - 3)).toBe(false);
    expect(b.check('house', s.x - 4, s.y - 4)).toEqual({ ok: false, reason: 'Local ocupado' });
  });

  it('rejects water, map edges and tiles the caller blocks', () => {
    const map = generateMap();
    const b = new Buildings(map);
    expect(b.check('depot', 0, 0).ok).toBe(false); // coast is water
    expect(b.check('depot', -1, 5)).toEqual({ ok: false, reason: 'Fora do mapa' });
    const s = spawnTile(map);
    expect(b.check('depot', s.x, s.y, (i) => i === tileIndex(map, s.x, s.y))).toEqual({
      ok: false,
      reason: 'Saia de cima do local',
    });
  });

  it('enforces "near" requirements', () => {
    const map = generateMap();
    const b = new Buildings(map);
    const s = spawnTile(map);
    // The spawn clearing has no iron within 6 tiles of its centre.
    expect(b.check('mine', s.x - 1, s.y - 1)).toEqual({ ok: false, reason: 'Precisa de ferro por perto' });
    // ...but there is somewhere a mine can go.
    expect(findSpot(b, 'mine', map.w, map.h)).not.toBeNull();
  });

  it('can be built over stumps and saplings', () => {
    const map = generateMap();
    const b = new Buildings(map);
    const s = spawnTile(map);
    map.objects[tileIndex(map, s.x - 3, s.y - 3)] = Obj.Stump;
    map.objects[tileIndex(map, s.x - 2, s.y - 3)] = Obj.Sapling;
    expect(b.check('house', s.x - 3, s.y - 3).ok).toBe(true);
  });

  it('construction completes after buildSeconds of work, exactly once', () => {
    const map = generateMap();
    const b = new Buildings(map);
    const s = spawnTile(map);
    const site = b.place('depot', s.x - 3, s.y);
    const total = BUILDING_DEFS.depot.buildSeconds;
    expect(b.work(site, total - 1)).toBe(false);
    expect(site.built).toBe(false);
    expect(b.work(site, 1)).toBe(true);
    expect(site.built).toBe(true);
    expect(b.work(site, 1)).toBe(false);
  });

  it('every buildable building (but founding a colony) has a cost a modest stockpile can pay', () => {
    const stock = new Inventory();
    stock.add('wood', 100);
    stock.add('stone', 100);
    for (const type of BUILD_MENU.filter((t) => t !== 'colony')) {
      expect(Object.keys(BUILDING_DEFS[type].cost).length).toBeGreaterThan(0);
      expect(stock.canAfford(BUILDING_DEFS[type].cost)).toBe(true);
    }
    expect(stock.pay({ wood: 101 })).toBe(false);
    expect(stock.items.wood).toBe(100);
    expect(stock.pay({ wood: 20, stone: 10 })).toBe(true);
    expect(stock.items).toMatchObject({ wood: 80, stone: 90 });
  });
});

describe('moving buildings', () => {
  it('costs half (rounded up) when built, nothing for a site; halls stay put', async () => {
    const { relocationCost, canRelocate } = await import('../src/game/buildings');
    expect(relocationCost({ type: 'house', built: true })).toEqual({ wood: 10, stone: 5 });
    expect(relocationCost({ type: 'mine', built: true })).toEqual({ wood: 10, stone: 8 });
    expect(relocationCost({ type: 'house', built: false })).toEqual({});
    expect(canRelocate({ type: 'stockpile' })).toBe(false);
    expect(canRelocate({ type: 'smithy' })).toBe(true);
  });

  it('frees the old tiles, covers the new ones, and may overlap its own old spot', async () => {
    const { Buildings } = await import('../src/game/buildings');
    const { generateMap, Obj, tileIndex } = await import('../src/world/map');
    const map = generateMap();
    const s = map.sites[0];
    const bs = new Buildings(map);
    const b = bs.place('house', s.x, s.y, true, 0);
    b.storage.wood = 3;
    expect(bs.check('house', s.x + 1, s.y).ok).toBe(false);
    expect(bs.check('house', s.x + 1, s.y, () => false, b).ok).toBe(true);
    bs.move(b, s.x + 1, s.y);
    expect(map.objects[tileIndex(map, s.x, s.y)]).toBe(Obj.None);
    expect(bs.at(tileIndex(map, s.x + 2, s.y))).toBe(b);
    expect(b.storage.wood).toBe(3);
  });
});
