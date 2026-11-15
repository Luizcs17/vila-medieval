import { describe, expect, it } from 'vitest';
import { ITEM_WEIGHT, MAX_STACK, SlotInventory } from '../src/game/slots';

const MAX = MAX_STACK.wood;

describe('SlotInventory', () => {
  it('stacks up to the max, hotbar first, then spills into new slots', () => {
    const inv = new SlotInventory(4, 2);
    expect(inv.add('wood', MAX + 3)).toBe(MAX + 3);
    expect(inv.slots[0]).toEqual({ item: 'wood', count: MAX });
    expect(inv.slots[1]).toEqual({ item: 'wood', count: 3 });
    inv.add('stone', 1);
    expect(inv.slots[2]).toEqual({ item: 'stone', count: 1 });
  });

  it('tops up existing stacks before using empty slots', () => {
    const inv = new SlotInventory(3, 1);
    inv.slots[2] = { item: 'iron', count: 5 };
    inv.add('iron', 2);
    expect(inv.slots[2]).toEqual({ item: 'iron', count: 7 });
    expect(inv.slots[0]).toBeNull();
  });

  it('reports space and refuses overflow', () => {
    const inv = new SlotInventory(2, 1);
    inv.add('wood', MAX);
    inv.add('stone', 1);
    expect(inv.space('wood')).toBe(0);
    expect(inv.space('stone')).toBe(MAX - 1);
    expect(inv.add('wood', 1)).toBe(0);
  });

  it('takes all resources for the stockpile', () => {
    const inv = new SlotInventory(4, 2);
    inv.add('wood', 3);
    inv.add('iron', 2);
    expect(inv.takeAllResources()).toEqual({ wood: 3, stone: 0, iron: 2, meat: 0, leather: 0, seed: 0 });
    expect(inv.slots.every((s) => s === null)).toBe(true);
  });

  it('removes from the last slots first', () => {
    const inv = new SlotInventory(3, 1);
    inv.add('wood', MAX + 4);
    expect(inv.remove('wood', 6)).toBe(6);
    expect(inv.count('wood')).toBe(MAX - 2);
    expect(inv.slots[1]).toBeNull();
  });

  describe('mouse', () => {
    it('left click picks up, places, merges and swaps', () => {
      const inv = new SlotInventory(3, 1);
      inv.slots[0] = { item: 'wood', count: 5 };
      inv.slots[1] = { item: 'stone', count: 2 };
      let held = inv.leftClick(0, null);
      expect(held).toEqual({ item: 'wood', count: 5 });
      expect(inv.slots[0]).toBeNull();
      held = inv.leftClick(1, held); // swap
      expect(inv.slots[1]).toEqual({ item: 'wood', count: 5 });
      expect(held).toEqual({ item: 'stone', count: 2 });
      held = inv.leftClick(2, held); // place in empty slot
      expect(held).toBeNull();
    });

    it('left click merges into a same-item stack and keeps the overflow', () => {
      const inv = new SlotInventory(1, 1);
      inv.slots[0] = { item: 'wood', count: MAX - 2 };
      const held = inv.leftClick(0, { item: 'wood', count: 5 });
      expect(inv.slots[0]!.count).toBe(MAX);
      expect(held).toEqual({ item: 'wood', count: 3 });
    });

    it('right click takes half (rounded up) and places one at a time', () => {
      const inv = new SlotInventory(2, 1);
      inv.slots[0] = { item: 'stone', count: 5 };
      let held = inv.rightClick(0, null);
      expect(held).toEqual({ item: 'stone', count: 3 });
      expect(inv.slots[0]!.count).toBe(2);
      held = inv.rightClick(1, held);
      expect(inv.slots[1]).toEqual({ item: 'stone', count: 1 });
      expect(held!.count).toBe(2);
    });

    it('shift+click moves a stack between hotbar and bag', () => {
      const inv = new SlotInventory(4, 2);
      inv.slots[0] = { item: 'wood', count: 4 };
      inv.slots[3] = { item: 'wood', count: MAX - 1 };
      inv.quickMove(0); // hotbar → bag: tops up slot 3, rest into slot 2
      expect(inv.slots[0]).toBeNull();
      expect(inv.slots[3]!.count).toBe(MAX);
      expect(inv.slots[2]).toEqual({ item: 'wood', count: 3 });
      inv.quickMove(2); // bag → hotbar
      expect(inv.slots[0]).toEqual({ item: 'wood', count: 3 });
    });
  });
});

describe('weight limit', () => {
  it('caps how much can be added by total weight', () => {
    const inv = new SlotInventory(27, 9, 10);
    expect(inv.add('stone', 10)).toBe(3); // 3 kg each → 9 kg
    expect(inv.weight).toBe(9);
    expect(inv.space('stone')).toBe(0);
    expect(inv.space('meat')).toBe(1); // 1 kg left
    expect(inv.add('wood', 1)).toBe(0); // 2 kg doesn't fit
  });

  it('moving stacks around never changes the weight', () => {
    const inv = new SlotInventory(4, 2, 40);
    inv.add('iron', 5);
    const held = inv.rightClick(0, null);
    inv.leftClick(3, held);
    expect(inv.weight).toBe(5 * ITEM_WEIGHT.iron);
  });
});
