import { DAY_SECONDS } from '../config';
import type { Inventory } from './inventory';
import type { NpcData } from './npcs';

/** Satiety is 0–100. A full day without food empties it. */
export const MAX_FOOD = 100;
export const HUNGER_PER_DAY = 100;
/** One meat restores this much satiety; villagers eat when they drop to EAT_BELOW. */
export const MEAL_SATIETY = 50;
export const EAT_BELOW = 50;
/** Game seconds at zero satiety before a villager dies. */
export const STARVE_DEATH = DAY_SECONDS * 1.5;

/** Frugal eats 30% less, Apetite grande 40% more. */
export function appetite(npc: Pick<NpcData, 'traits'>): number {
  if (npc.traits.includes('frugal')) return 0.7;
  if (npc.traits.includes('appetite')) return 1.4;
  return 1;
}

/** Meat a villager eats per in-game day. */
export function dailyMeat(npc: Pick<NpcData, 'traits'>): number {
  return (HUNGER_PER_DAY / MEAL_SATIETY) * appetite(npc);
}

export const isStarving = (npc: Pick<NpcData, 'food'>) => npc.food <= 0;

/** Days of food left in the stockpile for these villagers (Infinity with nobody to feed). */
export function foodDays(villagers: NpcData[], stock: Inventory): number {
  const perDay = villagers.reduce((sum, v) => sum + dailyMeat(v), 0);
  return perDay === 0 ? Infinity : stock.items.meat / perDay;
}

export type NeedsEvent = { type: 'starving' | 'died'; npc: NpcData };

/**
 * Advances hunger by `dt` game seconds. Hungry villagers eat meat straight from the stockpile.
 * Returns events for villagers who just started starving or who died (the caller removes the dead).
 */
export function updateNeeds(
  villagers: NpcData[],
  stock: Inventory,
  dt: number,
  factor: (n: NpcData) => number = () => 1,
): NeedsEvent[] {
  const events: NeedsEvent[] = [];
  for (const v of villagers) {
    const wasStarving = isStarving(v);
    v.food = Math.max(0, v.food - (HUNGER_PER_DAY / DAY_SECONDS) * appetite(v) * factor(v) * dt);
    while (v.food < EAT_BELOW && stock.items.meat > 0) {
      stock.items.meat -= 1;
      v.food = Math.min(MAX_FOOD, v.food + MEAL_SATIETY);
    }
    if (isStarving(v)) {
      v.starving += dt;
      if (!wasStarving) events.push({ type: 'starving', npc: v });
      if (v.starving >= STARVE_DEATH) events.push({ type: 'died', npc: v });
    } else {
      v.starving = 0;
    }
  }
  return events;
}
