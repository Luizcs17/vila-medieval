import { BUILDING_DEFS, type Building } from './buildings';
import { ITEM_DEFS, type ItemId, maxDurability, RECIPES, type Recipe, type ToolId } from './items';
import type { Rng } from './npcs';
import type { Storage } from './storage';

// ---------- workplace tools ----------

/** Tools of the accepted kinds in a workplace's inventory, one entry per unit, best first. */
export function workplaceTools(b: Building): ToolId[] {
  const accepted = BUILDING_DEFS[b.type].job?.tools ?? [];
  return accepted.flatMap((t) => Array<ToolId>(b.storage?.[t] ?? 0).fill(t));
}

/** Whether the job needs tools at all. */
export const needsTools = (b: Building) => (BUILDING_DEFS[b.type].job?.tools?.length ?? 0) > 0;

/**
 * The tool worker number `index` (0-based among the building's workers) uses, or null if there
 * aren't enough. Jobs without tools return 'none'.
 */
export function toolForWorker(b: Building, index: number): ToolId | null | 'none' {
  if (!needsTools(b)) return 'none';
  return workplaceTools(b)[index] ?? null;
}

/** Work speed from a tool: axes and picks use their speed, other gear 1. */
export const toolSpeed = (t: ToolId | 'none') => (t === 'none' ? 1 : (ITEM_DEFS[t].tool?.speed ?? 1));

/** One use of `tool` at a workplace. Returns true when a tool wore out (and was removed). */
export function wearWorkplaceTool(b: Building, tool: ToolId): boolean {
  b.wear = (b.wear ?? 0) + 1;
  if (b.wear < (maxDurability(tool) ?? Infinity)) return false;
  b.wear = 0;
  const n = (b.storage[tool] ?? 0) - 1;
  if (n > 0) b.storage[tool] = n;
  else delete b.storage[tool];
  return true;
}

/**
 * Tools go from the village's stock to a workplace whose workers lack one: one tool per worker,
 * the best accepted kind first. Returns the tools moved (empty when nothing was needed or available).
 */
export function autoSupply(b: Building, workers: number, village: Storage): ToolId[] {
  const moved: ToolId[] = [];
  if (!b.built || !needsTools(b)) return moved;
  const accepted = BUILDING_DEFS[b.type].job?.tools ?? [];
  let missing = workers - workplaceTools(b).length;
  for (const t of accepted) {
    while (missing > 0 && village.have(t) > 0 && village.remove(t, 1) === 1) {
      b.storage[t] = (b.storage[t] ?? 0) + 1;
      moved.push(t);
      missing--;
    }
  }
  return moved;
}

// ---------- armour ----------

/** Damage after armour: the share it absorbs, with the fraction rounded at random. */
export function absorb(damage: number, armor: ToolId | null | undefined, rng: Rng): number {
  const r = armor ? (ITEM_DEFS[armor].armor?.reduction ?? 0) : 0;
  const x = damage * (1 - r);
  return Math.floor(x) + (rng() < x - Math.floor(x) ? 1 : 0);
}

/** The best armour in a list of items (highest reduction), if any. */
export function bestArmor(items: ItemId[]): ItemId | null {
  let best: ItemId | null = null;
  for (const i of items) {
    const a = ITEM_DEFS[i].armor;
    if (a && (!best || a.reduction > (ITEM_DEFS[best].armor?.reduction ?? 0))) best = i;
  }
  return best;
}

// ---------- smithy ----------

export const recipeOf = (item: ToolId): Recipe => RECIPES.find((r) => r.item === item)!;

export type SmithEvent = { type: 'made'; item: ToolId } | { type: 'blocked'; item: ToolId } | null;

/**
 * Advances a smithy's production queue by `dt` game seconds with the given total workforce
 * (sum of its smiths' productivity; 0 when nobody is working). Materials for each item are taken
 * from `village` when it starts; finished items go to `out` (the village warehouse in the game).
 */
export function tickSmithy(b: Building, workforce: number, dt: number, village: Storage, out: Storage): SmithEvent {
  const item = b.queue?.[0];
  if (!item || workforce <= 0) return null;
  const recipe = recipeOf(item);
  if (!b.paid) {
    const cost = Object.entries(recipe.cost) as [ItemId, number][];
    if (!cost.every(([r, n]) => village.have(r) >= n)) return { type: 'blocked', item };
    for (const [r, n] of cost) village.remove(r, n);
    b.paid = true;
    b.craft = 0;
  }
  b.craft = (b.craft ?? 0) + dt * workforce;
  if (b.craft < recipe.seconds) return null;
  out.add(item, 1);
  b.queue!.shift();
  b.craft = 0;
  b.paid = false;
  return { type: 'made', item };
}

/** Smithy queue length limit. */
export const QUEUE_MAX = 8;
/** Recurring production: the maximum a new item starts with, and the highest allowed. */
export const RECURRING_DEFAULT = 2;
export const RECURRING_LIMIT = 99;

/**
 * Recurring production: with an empty queue, the smithy queues the first recurring item (in recipe
 * order) whose stock (`have`, the village warehouse) plus what's already queued is below its
 * maximum. Manual orders always come first. Returns the item queued, or null.
 */
export function planRecurring(b: Building, have: (t: ToolId) => number): ToolId | null {
  const rec = b.recurring;
  if (!rec || (b.queue?.length ?? 0) > 0) return null;
  for (const r of RECIPES) {
    const max = rec[r.item];
    if (max === undefined || have(r.item) >= max) continue;
    b.queue = [r.item];
    return r.item;
  }
  return null;
}

/** Turns recurring production of `item` on (with the default maximum) or sets its maximum. */
export function setRecurring(b: Building, item: ToolId, max: number | null): void {
  b.recurring ??= {};
  if (max === null) delete b.recurring[item];
  else b.recurring[item] = Math.max(0, Math.min(RECURRING_LIMIT, Math.round(max)));
}

/** Is the smithy able to forge now: something queued, already paid or affordable from `village`? */
export function smithyCanWork(b: Building, village: Storage): boolean {
  const item = b.queue?.[0];
  if (!item) return false;
  if (b.paid) return true;
  return (Object.entries(recipeOf(item).cost) as [ItemId, number][]).every(([r, n]) => village.have(r) >= n);
}

/** Cancels queue entry `i`; refunds the materials if it was already started. */
export function unqueue(b: Building, i: number, village: Storage): void {
  const item = b.queue?.[i];
  if (!item) return;
  if (i === 0 && b.paid) {
    for (const [r, n] of Object.entries(recipeOf(item).cost) as [ItemId, number][]) village.add(r, n);
    b.paid = false;
    b.craft = 0;
  }
  b.queue!.splice(i, 1);
}

/** The basic tool a workplace starts with (the last, cheapest accepted kind). */
export function basicTool(b: Building): ToolId | null {
  const t = BUILDING_DEFS[b.type].job?.tools;
  return t?.length ? t[t.length - 1] : null;
}

/** Stocks a workplace with one basic tool per job slot (new rival towns, old saves). */
export function grantStarterTools(b: Building): void {
  const t = basicTool(b);
  const job = BUILDING_DEFS[b.type].job;
  if (!t || !job) return;
  b.storage[t] = Math.max(b.storage[t] ?? 0, job.slots);
}

/** Gear a soldier can be given. */
export const WEAPONS: ToolId[] = ['spear', 'iron_sword', 'iron_axe', 'stone_axe'];
export const ARMORS: ToolId[] = ['leather_armor', 'iron_armor'];
