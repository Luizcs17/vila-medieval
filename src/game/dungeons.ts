import { DAY_SECONDS } from '../config';
import type { DungeonKind } from '../world/map';
import type { ItemId, ToolId } from './items';

/** Days until a looted ruin has a full chest and new guardians again. */
export const DUNGEON_REFILL = 5 * DAY_SECONDS;
/** Guardians per ruin, by kind. */
export const GUARDS: Record<DungeonKind, number> = { wolves: 3, bears: 2, bandits: 3 };
export const DUNGEON_LABEL: Record<DungeonKind, string> = {
  wolves: 'Ruína dos lobos',
  bears: 'Ruína dos ursos',
  bandits: 'Esconderijo de bandidos',
};

/** What's saved about each ruin (same order as map.dungeons). */
export interface DungeonState {
  /** Ids of its living guardians (animal ids, or person ids for bandits). */
  guardians: number[];
  /** The chest was opened; it fills again at `refillAt`. */
  looted: boolean;
  refillAt: number;
  /** You've seen it (it shows on the maps). */
  discovered: boolean;
}

export const freshDungeon = (): DungeonState => ({ guardians: [], looted: false, refillAt: 0, discovered: false });

export interface Loot {
  coins: number;
  items: { item: ItemId; count: number }[];
}

const GEAR: ToolId[] = ['iron_sword', 'iron_armor', 'iron_axe', 'iron_pick', 'leather_armor'];

/** A chest's contents: coins, one or two pieces of good gear, iron and leather. Bears guard more. */
export function rollLoot(rng: () => number, kind: DungeonKind): Loot {
  const rich = kind === 'bears' ? 1.5 : 1;
  const coins = Math.round((30 + rng() * 50) * rich);
  const items: Loot['items'] = [];
  const gearCount = 1 + (rng() < 0.4 * rich ? 1 : 0);
  for (let k = 0; k < gearCount; k++) items.push({ item: GEAR[Math.floor(rng() * GEAR.length)], count: 1 });
  items.push({ item: 'iron', count: 5 + Math.floor(rng() * 6) });
  items.push({ item: 'leather', count: 3 + Math.floor(rng() * 4) });
  return { coins, items };
}
