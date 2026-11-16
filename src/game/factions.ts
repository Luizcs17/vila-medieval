import { RIVAL_TOWNS, STARTING_COINS } from '../config';
import { Inventory } from './inventory';
import type { ToolId } from './items';
import type { Good } from './trade';

/** The player's faction id. Rival towns are 1..N in TOWN_SITES order. */
export const PLAYER_FACTION = 0;
/** Bandits belong to no village and are hostile to everyone. */
export const BANDITS = -1;

/** Diplomats recruiting wanderers: nobody, only skilled and master ones, or anyone. */
export type RecruitPolicy = 'none' | 'special' | 'all';
export const RECRUIT_POLICY_LABEL: Record<RecruitPolicy, string> = {
  none: 'Não recrutar',
  special: 'Só especiais',
  all: 'Todos',
};

/** Does `policy` take a wanderer of this tier? */
export const policyAccepts = (policy: RecruitPolicy | undefined, tier: 'common' | 'skilled' | 'master') =>
  policy === 'all' || (policy === 'special' && tier !== 'common');

export interface Faction {
  id: number;
  name: string;
  /** Display colour (0xRRGGBB) and its CSS form. */
  color: number;
  css: string;
  isPlayer: boolean;
  /** Each town's own stockpile. The player's is WorldScene.stockpile. */
  stock: Inventory;
  /** Town centre tile (its stockpile/hall). */
  center: { x: number; y: number };
  /** False once conquered. */
  alive: boolean;
  /** Ruler NPC id (rival towns) — the player rules faction 0. */
  rulerId: number | null;
  /** Treasury, in coins (moedas). */
  coins: number;
  /** Market warehouse of finished tools and weapons, for trade. */
  tools: Partial<Record<ToolId, number>>;
  /** Colonies: the village that founded them (same realm: shared relations and wars). */
  parent?: number;
  /** Which wanderers its diplomats go and bring in. */
  recruitPolicy?: RecruitPolicy;
}

/** Player's standing orders for visiting merchants: sell what's above `sellAbove`, buy up to `buyUpTo`. */
export interface TradePolicy {
  sellAbove: Partial<Record<Good, number>>;
  buyUpTo: Partial<Record<Good, number>>;
}

const css = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

/** Builds the faction list: the player's village plus one per rival town site. */
export function createFactions(sites: { x: number; y: number }[], playerStock: Inventory, playerName = 'Sua vila'): Faction[] {
  const player: Faction = {
    id: PLAYER_FACTION,
    name: playerName,
    color: 0x58c058,
    css: css(0x58c058),
    isPlayer: true,
    stock: playerStock,
    center: sites[0],
    alive: true,
    rulerId: null,
    coins: STARTING_COINS,
    tools: {},
  };
  const rivals = RIVAL_TOWNS.map((t, k) => ({
    id: k + 1,
    name: t.name,
    color: t.color,
    css: css(t.color),
    isPlayer: false,
    stock: new Inventory(),
    center: sites[k + 1],
    alive: true,
    rulerId: null,
    coins: STARTING_COINS * 2,
    tools: {},
  }));
  return [player, ...rivals];
}

/** Names for the player's colonies, in founding order. */
export const COLONY_NAMES = ['Nova Esperança', 'Vale do Corvo', 'Monte Claro', 'Ribeira Funda', 'Campo Verde', 'Porto Velho'];

/** Resources a new colony starts with (part of its founding cost). */
export const COLONY_START = { wood: 30, stone: 20, meat: 10 } as const;

/** Tiles a new colony's hall must keep from every other village centre. */
export const COLONY_MIN_DISTANCE = 24;

/** A new colony of `parent`: its own stock, centre and territory, ruled by the same player. */
export function createColony(id: number, center: { x: number; y: number }, name: string, parent = PLAYER_FACTION): Faction {
  const color = [0x7ad070, 0x48a890, 0xa0c050, 0x50b8a0, 0x8cc890, 0x60a040][(id - 1) % 6];
  return {
    id,
    name,
    color,
    css: css(color),
    isPlayer: true,
    stock: new Inventory(),
    center,
    alive: true,
    rulerId: null,
    coins: 0,
    tools: {},
    parent,
  };
}

/** The faction whose relations and wars `id` shares (colonies follow their founder). */
export const realmOf = (factions: Faction[], id: number): number => factions[id]?.parent ?? id;

/** Can a colony hall stand at (x, y)? Far from every living village and on nobody's land. */
export function colonySiteOk(factions: Faction[], x: number, y: number, ownerNear: (r: number) => boolean): string | null {
  for (const f of factions)
    if (f.alive && Math.hypot(f.center.x - x, f.center.y - y) < COLONY_MIN_DISTANCE)
      return `Muito perto de ${f.name} (mín. ${COLONY_MIN_DISTANCE} passos)`;
  if (ownerNear(10)) return 'Precisa de terra sem dono ao redor';
  return null;
}
