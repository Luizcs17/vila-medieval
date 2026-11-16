import { describe, expect, it } from 'vitest';
import { INVENTORY_SLOTS } from '../src/config';
import { ResourceNodes } from '../src/game/gathering';
import { RECIPES } from '../src/game/items';
import { SlotInventory } from '../src/game/slots';
import { generateMap, Obj } from '../src/world/map';

describe('the shovel', () => {
  it('is craftable and digs stumps out for good', () => {
    expect(RECIPES.some((r) => r.item === 'shovel')).toBe(true);
    const map = generateMap();
    const nodes = new ResourceNodes(map);
    const i = map.objects.indexOf(Obj.Tree);
    while (map.objects[i] === Obj.Tree) nodes.harvest(i);
    expect(map.objects[i]).toBe(Obj.Stump);
    expect(nodes.dig(i)).toBe(true);
    expect(map.objects[i]).toBe(Obj.None);
    nodes.update(1e6, () => true);
    expect(map.objects[i]).toBe(Obj.None); // no tree comes back
    expect(nodes.dig(i)).toBe(false);
  });
});

describe('the armour slot', () => {
  const bag = () => new SlotInventory(INVENTORY_SLOTS, 9, 1000);

  it('only takes armour, swaps with what you wear, and counts its weight', () => {
    const inv = bag();
    expect(inv.armorClick({ item: 'wood', count: 3 })).toEqual({ item: 'wood', count: 3 });
    expect(inv.armor).toBeNull();
    const leather = { item: 'leather_armor' as const, count: 1, durability: 60 };
    expect(inv.armorClick(leather)).toBeNull();
    expect(inv.armor).toBe(leather);
    expect(inv.weight).toBe(4);
    const iron = { item: 'iron_armor' as const, count: 1, durability: 150 };
    expect(inv.armorClick(iron)).toBe(leather);
  });

  it('shift+click wears armour from the bag, and it breaks after its hits', () => {
    const inv = bag();
    inv.add('leather_armor', 1);
    const i = inv.slots.findIndex((s) => s?.item === 'leather_armor');
    expect(inv.equipFrom(i)).toBe(true);
    expect(inv.slots[i]).toBeNull();
    inv.armor!.durability = 1;
    expect(inv.wearArmor()).toBe(true);
    expect(inv.armor).toBeNull();
  });
});
