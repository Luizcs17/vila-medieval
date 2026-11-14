import { emptyAmounts, RESOURCE_LABEL, RESOURCES, type Amounts, type Resource } from './inventory';

/** Anything that can sit in an inventory slot. Only resources for now; tools come later. */
export type ItemId = Resource;

export interface Stack {
  item: ItemId;
  count: number;
}

export const ITEM_LABEL: Record<ItemId, string> = RESOURCE_LABEL;

export const MAX_STACK: Record<ItemId, number> = { wood: 20, stone: 20, iron: 20, meat: 20 };

/** Weight of one unit, in kg. What the player can carry is limited by total weight. */
export const ITEM_WEIGHT: Record<ItemId, number> = { wood: 2, stone: 3, iron: 4, meat: 1 };

const isResource = (item: ItemId): item is Resource => (RESOURCES as readonly string[]).includes(item);

/**
 * Minecraft-style slot inventory. Slots [0, hotbarSize) are the hotbar; the rest is the bag.
 * Capacity is limited by total weight (`maxWeight`, kg) as well as by slots and stack sizes.
 * Mouse operations take and return the stack "held" on the cursor; they never change total weight.
 */
export class SlotInventory {
  readonly slots: (Stack | null)[];

  constructor(
    size: number,
    readonly hotbarSize = 9,
    public maxWeight = Infinity,
  ) {
    this.slots = new Array<Stack | null>(size).fill(null);
  }

  count(item: ItemId): number {
    return this.slots.reduce((n, s) => n + (s?.item === item ? s.count : 0), 0);
  }

  /** Total carried weight, in kg. */
  get weight(): number {
    return this.slots.reduce((w, s) => w + (s ? s.count * ITEM_WEIGHT[s.item] : 0), 0);
  }

  /** How many more units of `item` fit, by slots and by weight. */
  space(item: ItemId): number {
    const max = MAX_STACK[item];
    const bySlots = this.slots.reduce((n, s) => n + (s === null ? max : s.item === item ? max - s.count : 0), 0);
    const byWeight = Math.floor((this.maxWeight - this.weight) / ITEM_WEIGHT[item]);
    return Math.max(0, Math.min(bySlots, byWeight));
  }

  /** Adds up to `n` units: tops up existing stacks first, then fills empty slots (hotbar first). Returns units added. */
  add(item: ItemId, n = 1): number {
    const max = MAX_STACK[item];
    const byWeight = Math.floor((this.maxWeight - this.weight) / ITEM_WEIGHT[item]);
    let left = Math.max(0, Math.min(n, byWeight));
    const wanted = left;
    for (const s of this.slots) {
      if (left === 0) break;
      if (s && s.item === item && s.count < max) {
        const put = Math.min(left, max - s.count);
        s.count += put;
        left -= put;
      }
    }
    for (let i = 0; i < this.slots.length && left > 0; i++) {
      if (this.slots[i] === null) {
        const put = Math.min(left, max);
        this.slots[i] = { item, count: put };
        left -= put;
      }
    }
    return wanted - left;
  }

  /** Removes up to `n` units, taking from the last slots first. Returns units removed. */
  remove(item: ItemId, n: number): number {
    let left = n;
    for (let i = this.slots.length - 1; i >= 0 && left > 0; i--) {
      const s = this.slots[i];
      if (s?.item !== item) continue;
      const take = Math.min(left, s.count);
      s.count -= take;
      left -= take;
      if (s.count === 0) this.slots[i] = null;
    }
    return n - left;
  }

  /** Empties every resource stack (for depositing at the stockpile). Returns the amounts removed. */
  takeAllResources(): Amounts {
    const taken = emptyAmounts();
    this.slots.forEach((s, i) => {
      if (s && isResource(s.item)) {
        taken[s.item] += s.count;
        this.slots[i] = null;
      }
    });
    return taken;
  }

  /** Left click: pick up the whole stack, put the held stack down, merge, or swap. */
  leftClick(i: number, held: Stack | null): Stack | null {
    const s = this.slots[i];
    if (!held) {
      this.slots[i] = null;
      return s;
    }
    if (!s) {
      this.slots[i] = held;
      return null;
    }
    if (s.item === held.item) {
      const put = Math.min(held.count, MAX_STACK[s.item] - s.count);
      s.count += put;
      held.count -= put;
      return held.count > 0 ? held : null;
    }
    this.slots[i] = held;
    return s;
  }

  /** Right click: pick up half a stack, or put down a single unit. Different items swap. */
  rightClick(i: number, held: Stack | null): Stack | null {
    const s = this.slots[i];
    if (!held) {
      if (!s) return null;
      const take = Math.ceil(s.count / 2);
      s.count -= take;
      if (s.count === 0) this.slots[i] = null;
      return { item: s.item, count: take };
    }
    if (!s) {
      this.slots[i] = { item: held.item, count: 1 };
      held.count -= 1;
      return held.count > 0 ? held : null;
    }
    if (s.item === held.item) {
      if (s.count < MAX_STACK[s.item]) {
        s.count += 1;
        held.count -= 1;
      }
      return held.count > 0 ? held : null;
    }
    return this.leftClick(i, held);
  }

  /** Shift+click: send a stack between the hotbar and the bag, merging where possible. */
  quickMove(i: number): void {
    const s = this.slots[i];
    if (!s) return;
    const toHotbar = i >= this.hotbarSize;
    const from = toHotbar ? 0 : this.hotbarSize;
    const to = toHotbar ? this.hotbarSize : this.slots.length;
    const max = MAX_STACK[s.item];
    for (let j = from; j < to && s.count > 0; j++) {
      const t = this.slots[j];
      if (t && t.item === s.item && t.count < max) {
        const put = Math.min(s.count, max - t.count);
        t.count += put;
        s.count -= put;
      }
    }
    for (let j = from; j < to && s.count > 0; j++) {
      if (this.slots[j] === null) {
        this.slots[j] = { item: s.item, count: s.count };
        s.count = 0;
      }
    }
    if (s.count === 0) this.slots[i] = null;
  }
}
