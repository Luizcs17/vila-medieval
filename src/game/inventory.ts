export const RESOURCES = ['wood', 'stone', 'iron', 'meat'] as const;
export type Resource = (typeof RESOURCES)[number];

export const RESOURCE_LABEL: Record<Resource, string> = {
  wood: 'Madeira',
  stone: 'Pedra',
  iron: 'Ferro',
  meat: 'Carne',
};

export type Amounts = Record<Resource, number>;

export function emptyAmounts(): Amounts {
  return { wood: 0, stone: 0, iron: 0, meat: 0 };
}

/** A bag of resources with an optional total capacity (the player's backpack, the central stockpile). */
export class Inventory {
  readonly items: Amounts = emptyAmounts();

  constructor(readonly capacity = Infinity) {}

  get total(): number {
    return RESOURCES.reduce((sum, r) => sum + this.items[r], 0);
  }

  get free(): number {
    return this.capacity - this.total;
  }

  /** Adds up to `n` units, limited by free space. Returns how many were actually added. */
  add(resource: Resource, n = 1): number {
    const added = Math.max(0, Math.min(n, this.free));
    this.items[resource] += added;
    return added;
  }

  canAfford(cost: Partial<Amounts>): boolean {
    return RESOURCES.every((r) => this.items[r] >= (cost[r] ?? 0));
  }

  /** Removes `cost` if all of it is available. Returns false (and changes nothing) otherwise. */
  pay(cost: Partial<Amounts>): boolean {
    if (!this.canAfford(cost)) return false;
    for (const r of RESOURCES) this.items[r] -= cost[r] ?? 0;
    return true;
  }

  /** Moves as much as fits into `target`. Returns the amounts moved. */
  transferAllTo(target: Inventory): Amounts {
    const moved = emptyAmounts();
    for (const r of RESOURCES) {
      const n = target.add(r, this.items[r]);
      this.items[r] -= n;
      moved[r] = n;
    }
    return moved;
  }
}
