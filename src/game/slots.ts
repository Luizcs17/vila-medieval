import { type Amounts, emptyAmounts, RESOURCES, type Resource } from './inventory';
import { ALL_ITEMS, ITEM_DEFS, type ItemId, maxDurability } from './items';

export type { ItemId } from './items';

export interface Stack {
  item: ItemId;
  count: number;
  /** Uses left, for tools and weapons. */
  durability?: number;
}

const table = <T>(f: (i: ItemId) => T) => Object.fromEntries(ALL_ITEMS.map((i) => [i, f(i)])) as Record<ItemId, T>;
export const ITEM_LABEL = table((i) => ITEM_DEFS[i].label);
export const MAX_STACK = table((i) => ITEM_DEFS[i].maxStack);
/** Weight of one unit, in kg. What the player can carry is limited by total weight. */
export const ITEM_WEIGHT = table((i) => ITEM_DEFS[i].weight);

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
  /** Armour you wear (one piece; it protects you and still weighs). */
  armor: Stack | null = null;

  get weight(): number {
    const worn = this.armor ? ITEM_WEIGHT[this.armor.item] : 0;
    const w = this.slots.reduce((sum, s) => sum + (s ? s.count * ITEM_WEIGHT[s.item] : 0), worn);
    return Math.round(w * 10) / 10; // seeds weigh fractions of a kg
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
        const wear = maxDurability(item);
        this.slots[i] = wear !== undefined ? { item, count: put, durability: wear } : { item, count: put };
        left -= put;
      }
    }
    return wanted - left;
  }

  /** Puts a stack taken out with the mouse back into the first place it fits. Returns what didn't fit (or null). */
  stow(stack: Stack): Stack | null {
    if (MAX_STACK[stack.item] === 1) {
      const i = this.slots.indexOf(null);
      if (i < 0) return stack;
      this.slots[i] = stack;
      return null;
    }
    stack.count -= this.add(stack.item, stack.count);
    return stack.count > 0 ? stack : null;
  }

  /** Click on the armour slot: put on the held armour (or take yours off into the hand). Returns the new held stack. */
  armorClick(held: Stack | null): Stack | null {
    if (held && !ITEM_DEFS[held.item].armor) return held; // only armour goes there
    const off = this.armor;
    this.armor = held;
    return off;
  }

  /** Shift+click on armour in the bag: wear it (whatever you wore goes to that slot). */
  equipFrom(i: number): boolean {
    const s = this.slots[i];
    if (!s || !ITEM_DEFS[s.item].armor) return false;
    this.slots[i] = this.armor;
    this.armor = s;
    return true;
  }

  /** One hit on the worn armour. Returns true if it broke. */
  wearArmor(): boolean {
    if (this.armor?.durability === undefined) return false;
    this.armor.durability -= 1;
    if (this.armor.durability > 0) return false;
    this.armor = null;
    return true;
  }

  /** Wears the tool in slot `i` by one use. Returns true if it broke (and was removed). */
  wear(i: number): boolean {
    const s = this.slots[i];
    if (s?.durability === undefined) return false;
    s.durability -= 1;
    if (s.durability > 0) return false;
    this.slots[i] = null;
    return true;
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
    if (s.item === held.item && MAX_STACK[s.item] > 1) {
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
    // Unstackable items (tools) move whole, keeping their durability.
    const unstackable = (held && MAX_STACK[held.item] === 1) || (!held && this.slots[i] && MAX_STACK[this.slots[i]!.item] === 1);
    if (unstackable) return this.leftClick(i, held);
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
        this.slots[j] = { ...s };
        s.count = 0;
      }
    }
    if (s.count === 0) this.slots[i] = null;
  }
}
