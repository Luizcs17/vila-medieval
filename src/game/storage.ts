import type { Building } from './buildings';
import type { Faction } from './factions';
import { RESOURCES, type Resource } from './inventory';
import { ALL_ITEMS, type ItemId, maxDurability, type ToolId } from './items';
import type { SlotInventory } from './slots';

/**
 * Something you can take items out of and put items into: a village's stock (its stockpile
 * resources plus the tool warehouse) or one building's own inventory.
 */
export interface Storage {
  have(item: ItemId): number;
  add(item: ItemId, n: number): void;
  /** Removes up to `n`; returns how many were removed. */
  remove(item: ItemId, n: number): number;
}

const isResource = (i: ItemId): i is Resource => (RESOURCES as readonly string[]).includes(i);

/** A village's central stock: resources in the stockpile, tools and weapons in the warehouse. */
export function villageStorage(f: Faction): Storage {
  return {
    have: (i) => (isResource(i) ? f.stock.items[i] : (f.tools[i as ToolId] ?? 0)),
    add: (i, n) => {
      if (isResource(i)) f.stock.add(i, n);
      else f.tools[i as ToolId] = (f.tools[i as ToolId] ?? 0) + n;
    },
    remove: (i, n) => {
      if (isResource(i)) {
        const k = Math.min(n, f.stock.items[i]);
        f.stock.items[i] -= k;
        return k;
      }
      const k = Math.min(n, f.tools[i as ToolId] ?? 0);
      f.tools[i as ToolId] = (f.tools[i as ToolId] ?? 0) - k;
      return k;
    },
  };
}

/** One building's own inventory. */
export function buildingStorage(b: Building): Storage {
  b.storage ??= {};
  return {
    have: (i) => b.storage[i] ?? 0,
    add: (i, n) => {
      b.storage[i] = (b.storage[i] ?? 0) + n;
    },
    remove: (i, n) => {
      const k = Math.min(n, b.storage[i] ?? 0);
      b.storage[i] = (b.storage[i] ?? 0) - k;
      if (b.storage[i] === 0) delete b.storage[i];
      return k;
    },
  };
}

/** Items present in a storage, in a stable order. */
export function contents(s: Storage): [ItemId, number][] {
  return ALL_ITEMS.map((i) => [i, s.have(i)] as [ItemId, number]).filter(([, n]) => n > 0);
}

/** Tools must be in good shape (≥75% durability) to be stored: storage doesn't track wear. */
export const STORE_MIN_DURABILITY = 0.75;

/** Moves up to `n` of `item` from a storage into your inventory (weight and slots permitting). */
export function takeFrom(s: Storage, inv: SlotInventory, item: ItemId, n: number): number {
  const k = Math.min(n, s.have(item), inv.space(item));
  if (k <= 0) return 0;
  s.remove(item, k);
  inv.add(item, k); // tools come out fresh: storage only accepts tools in good shape
  return k;
}

/**
 * Moves up to `n` of `item` from your inventory into a storage. Worn tools stay with you.
 * Returns how many moved.
 */
export function putInto(s: Storage, inv: SlotInventory, item: ItemId, n: number): number {
  const wear = maxDurability(item);
  if (wear === undefined) {
    const k = inv.remove(item, Math.min(n, inv.count(item))); // n may be Infinity ("everything")
    s.add(item, k);
    return k;
  }
  let moved = 0;
  inv.slots.forEach((slot, i) => {
    if (moved >= n || slot?.item !== item) return;
    if ((slot.durability ?? wear) < wear * STORE_MIN_DURABILITY) return;
    inv.slots[i] = null;
    s.add(item, 1);
    moved++;
  });
  return moved;
}

/** Moves every resource you carry into a storage (the old one-key deposit). */
export function depositResources(s: Storage, inv: SlotInventory): Partial<Record<Resource, number>> {
  const out: Partial<Record<Resource, number>> = {};
  for (const r of RESOURCES) {
    const k = putInto(s, inv, r, Infinity);
    if (k > 0) out[r] = k;
  }
  return out;
}
