import { describe, expect, it } from 'vitest';
import { INVENTORY_SLOTS } from '../src/config';
import { DROP_LIFETIME, Drops, takeFromSlot } from '../src/game/drops';
import { SlotInventory } from '../src/game/slots';

const bag = (maxWeight = 1000) => new SlotInventory(INVENTORY_SLOTS, 9, maxWeight);

describe('items on the ground', () => {
  it('drop one or the whole stack from a slot', () => {
    const inv = bag();
    inv.add('wood', 5);
    expect(takeFromSlot(inv, 0, 1)).toEqual({ item: 'wood', count: 1 });
    expect(inv.count('wood')).toBe(4);
    expect(takeFromSlot(inv, 0, Infinity)?.count).toBe(4);
    expect(inv.slots[0]).toBeNull();
    expect(takeFromSlot(inv, 0, 1)).toBeNull();
  });

  it('keep a tool’s wear when picked back up', () => {
    const inv = bag();
    const drops = new Drops();
    const d = drops.add({ item: 'iron_axe', count: 1, durability: 17 }, 3, 3, 0);
    expect(drops.nearest(3.5, 3, 1)).toBe(d);
    expect(drops.take(d, inv)).toBe(1);
    expect(inv.slots.find((s) => s?.item === 'iron_axe')?.durability).toBe(17);
    expect(drops.list).toHaveLength(0);
  });

  it('leave what doesn’t fit, and vanish after a while', () => {
    const inv = bag(10); // 5 wood at 2 kg
    const drops = new Drops();
    const d = drops.add({ item: 'wood', count: 8 }, 0, 0, 100);
    expect(drops.take(d, inv)).toBe(5);
    expect(d.count).toBe(3);
    expect(drops.expire(100 + DROP_LIFETIME - 1)).toHaveLength(0);
    expect(drops.expire(100 + DROP_LIFETIME)).toEqual([d]);
    const s = new Drops();
    s.restore(drops.snapshot());
    expect(s.list).toHaveLength(0);
  });
});
