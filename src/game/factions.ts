import { RIVAL_TOWNS } from '../config';
import { Inventory } from './inventory';

/** The player's faction id. Rival towns are 1..N in TOWN_SITES order. */
export const PLAYER_FACTION = 0;

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
  }));
  return [player, ...rivals];
}
