import { describe, expect, it } from 'vitest';
import { Diplomacy } from '../src/game/diplomacy';
import { COLONY_MIN_DISTANCE, colonySiteOk, createColony, createFactions, realmOf } from '../src/game/factions';
import { Inventory } from '../src/game/inventory';
import { isSaveData } from '../src/game/save';
import { generateMap } from '../src/world/map';

const setup = () => {
  const map = generateMap();
  const factions = createFactions(map.sites, new Inventory());
  const home = factions[0].center;
  const colony = createColony(factions.length, { x: home.x + 40, y: home.y }, 'Nova Esperança');
  factions.push(colony);
  return { factions, colony };
};

describe('colonies', () => {
  it('are the player’s, with their own stock, and follow their founder', () => {
    const { factions, colony } = setup();
    expect(colony.isPlayer).toBe(true);
    expect(colony.stock).not.toBe(factions[0].stock);
    expect(realmOf(factions, colony.id)).toBe(0);
    expect(realmOf(factions, 1)).toBe(1);
  });

  it('share the founder’s wars and alliances', () => {
    const { factions, colony } = setup();
    const d = new Diplomacy();
    d.realm = (id) => realmOf(factions, id);
    expect(d.atWar(colony.id, 0)).toBe(false);
    d.declareWar(1, 0, [0, 1, 2, 3], 'teste');
    expect(d.atWar(1, colony.id)).toBe(true);
    expect(d.atWar(colony.id, 0)).toBe(false); // never with itself
    d.makePeace(colony.id, 1);
    expect(d.atWar(1, 0)).toBe(false);
  });

  it('must be founded far from every village and on free land', () => {
    const { factions } = setup();
    const c = factions[0].center;
    expect(colonySiteOk(factions, c.x + 5, c.y, () => false)).toMatch(/perto/);
    const far = { x: c.x + COLONY_MIN_DISTANCE + 2, y: c.y + COLONY_MIN_DISTANCE + 2 };
    const clear = factions.every((f) => Math.hypot(f.center.x - far.x, f.center.y - far.y) >= COLONY_MIN_DISTANCE);
    if (clear) {
      expect(colonySiteOk(factions, far.x, far.y, () => false)).toBeNull();
      expect(colonySiteOk(factions, far.x, far.y, () => true)).toMatch(/sem dono/);
    }
  });

  it('old (v6) and new saves both load', () => {
    const base = {
      clock: 0,
      objects: [],
      inventory: [],
      player: { gx: 1 },
      buildings: { list: [] },
      population: { npcs: [] },
      animals: [],
      factions: [],
    };
    expect(isSaveData({ ...base, version: 6 })).toBe(true);
    expect(isSaveData({ ...base, version: 7 })).toBe(true);
    expect(isSaveData({ ...base, version: 5 })).toBe(false);
  });
});
