import { DAY_SECONDS } from '../config';
import type { ItemId } from './items';
import type { SlotInventory, Stack } from './slots';

/** Items lying on the ground stay this long (game seconds), then they're gone. */
export const DROP_LIFETIME = DAY_SECONDS * 3;

/** Something dropped on the ground (G): one stack, with its wear if it's a tool. */
export interface Drop {
  id: number;
  gx: number;
  gy: number;
  item: ItemId;
  count: number;
  durability?: number;
  /** Game time when it disappears. */
  expiresAt: number;
}

/** Every item on the ground. Phaser-free; the scene draws them. */
export class Drops {
  list: Drop[] = [];
  private nextId = 1;

  /** Puts a stack on the ground at (gx, gy). */
  add(stack: Stack, gx: number, gy: number, now: number): Drop {
    const d: Drop = { id: this.nextId++, gx, gy, item: stack.item, count: stack.count, expiresAt: now + DROP_LIFETIME };
    if (stack.durability !== undefined) d.durability = stack.durability;
    this.list.push(d);
    return d;
  }

  /** Nearest drop within `r` tiles of (gx, gy). */
  nearest(gx: number, gy: number, r: number): Drop | null {
    let best: Drop | null = null;
    let bestD = r;
    for (const d of this.list) {
      const dist = Math.hypot(d.gx - gx, d.gy - gy);
      if (dist <= bestD) {
        bestD = dist;
        best = d;
      }
    }
    return best;
  }

  /** Picks up as much of `d` as fits in `inv`. Returns how many were taken (the drop goes when empty). */
  take(d: Drop, inv: SlotInventory): number {
    let taken: number;
    if (d.durability !== undefined) {
      const left = inv.stow({ item: d.item, count: d.count, durability: d.durability });
      taken = d.count - (left?.count ?? 0);
    } else taken = inv.add(d.item, d.count);
    d.count -= taken;
    if (d.count <= 0) this.remove(d);
    return taken;
  }

  remove(d: Drop): void {
    const k = this.list.indexOf(d);
    if (k >= 0) this.list.splice(k, 1);
  }

  /** Removes drops whose time is up; returns them (so the scene can remove their sprites). */
  expire(now: number): Drop[] {
    const gone = this.list.filter((d) => now >= d.expiresAt);
    for (const d of gone) this.remove(d);
    return gone;
  }

  snapshot(): { list: Drop[]; nextId: number } {
    return { list: this.list.map((d) => ({ ...d })), nextId: this.nextId };
  }

  restore(s: { list: Drop[]; nextId: number } | undefined): void {
    this.list = (s?.list ?? []).map((d) => ({ ...d }));
    this.nextId = s?.nextId ?? 1;
  }
}

/** Takes `n` units (all of it with n = Infinity) out of slot `i` as a stack to drop, or null if it's empty. */
export function takeFromSlot(inv: SlotInventory, i: number, n: number): Stack | null {
  const s = inv.slots[i];
  if (!s) return null;
  const k = Math.min(n, s.count);
  const out: Stack = { ...s, count: k };
  s.count -= k;
  if (s.count <= 0) inv.slots[i] = null;
  return out;
}
