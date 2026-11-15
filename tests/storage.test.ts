import { describe, expect, it } from 'vitest';
import { Buildings } from '../src/game/buildings';
import { createFactions } from '../src/game/factions';
import { Inventory } from '../src/game/inventory';
import { ITEM_DEFS } from '../src/game/items';
import { SlotInventory } from '../src/game/slots';
import { buildingStorage, contents, depositResources, putInto, takeFrom, villageStorage } from '../src/game/storage';
import { generateMap } from '../src/world/map';

const setup = () => {
  const map = generateMap();
  const stock = new Inventory();
  const f = createFactions(map.sites, stock)[0];
  return { map, stock, f, village: villageStorage(f), inv: new SlotInventory(27, 9, 40) };
};

describe('village stock', () => {
  it('holds resources in the stockpile and tools in the warehouse', () => {
    const { stock, f, village } = setup();
    village.add('wood', 5);
    village.add('stone_axe', 2);
    expect(stock.items.wood).toBe(5);
    expect(f.tools.stone_axe).toBe(2);
    expect(contents(village)).toEqual([
      ['wood', 5],
      ['stone_axe', 2],
    ]);
  });

  it('lets you take items out, limited by your weight', () => {
    const { village, inv } = setup();
    village.add('stone', 50);
    expect(takeFrom(village, inv, 'stone', Infinity)).toBe(13); // 13 × 3 kg ≤ 40
    expect(village.have('stone')).toBe(37);
    village.add('iron_sword', 1);
    expect(takeFrom(village, inv, 'iron_sword', 1)).toBe(0); // 39 kg + 3 kg doesn't fit
  });

  it('takes tools out with full durability', () => {
    const { village, inv } = setup();
    village.add('iron_axe', 1);
    takeFrom(village, inv, 'iron_axe', 1);
    expect(inv.slots.find((s) => s?.item === 'iron_axe')?.durability).toBe(ITEM_DEFS.iron_axe.tool!.durability);
  });
});

describe('putting things away', () => {
  it('stores resources and good tools, but keeps worn tools with you', () => {
    const { village, inv } = setup();
    inv.add('wood', 6);
    inv.add('stone_pick', 2);
    inv.slots.find((s) => s?.item === 'stone_pick')!.durability = 10; // worn
    expect(putInto(village, inv, 'wood', 4)).toBe(4);
    expect(putInto(village, inv, 'stone_pick', 2)).toBe(1);
    expect(inv.count('stone_pick')).toBe(1);
    expect(village.have('stone_pick')).toBe(1);
    expect(depositResources(village, inv)).toEqual({ wood: 2 });
    expect(inv.count('wood')).toBe(0);
  });

  it('every building has its own inventory', () => {
    const { map, inv } = setup();
    const b = new Buildings(map);
    const s = map.sites[0];
    const hut = b.place('lumberjack', s.x + 3, s.y + 3, true);
    expect(hut.storage).toEqual({});
    const st = buildingStorage(hut);
    inv.add('stone_axe', 1);
    putInto(st, inv, 'stone_axe', 1);
    expect(hut.storage).toEqual({ stone_axe: 1 });
    expect(takeFrom(st, inv, 'stone_axe', 5)).toBe(1);
    expect(hut.storage).toEqual({});
    // Survives a save/restore round trip.
    st.add('wood', 3);
    const b2 = new Buildings(generateMap());
    b2.restore(JSON.parse(JSON.stringify(b.snapshot())));
    expect(b2.list[0].storage).toEqual({ wood: 3 });
  });
});
