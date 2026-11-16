import { DAY_SECONDS } from '../config';
import { type DungeonKind, type DungeonSite, Ground, inBounds, Obj, type WorldMap } from '../world/map';
import type { ItemId, ToolId } from './items';

/** A looted ruin collapses this long after, and a new one appears elsewhere. */
export const DUNGEON_COLLAPSE = 3 * DAY_SECONDS;
const KINDS: DungeonKind[] = ['wolves', 'bears', 'bandits'];
/** Guardians per ruin, by kind. */
export const GUARDS: Record<DungeonKind, number> = { wolves: 3, bears: 2, bandits: 3 };
export const DUNGEON_LABEL: Record<DungeonKind, string> = {
  wolves: 'Ruína dos lobos',
  bears: 'Ruína dos ursos',
  bandits: 'Esconderijo de bandidos',
};

/** A ruin as the game keeps it: where it is, who guards it, and whether it's been looted. */
export interface DungeonState extends DungeonSite {
  /** Ids of its living guardians (animal ids, or person ids for bandits). */
  guardians: number[];
  /** The chest was opened; the ruin collapses at `collapseAt`. */
  looted: boolean;
  collapseAt: number;
  /** You've seen it (it shows on the maps). */
  discovered: boolean;
}

export const freshDungeon = (site: DungeonSite): DungeonState => ({
  ...site,
  guardians: [],
  looted: false,
  collapseAt: 0,
  discovered: false,
});

/** Tiles a ruin covers (7×7 around its chest). */
export function ruinTiles(map: WorldMap, d: { x: number; y: number }): number[] {
  const out: number[] = [];
  for (let dy = -3; dy <= 3; dy++)
    for (let dx = -3; dx <= 3; dx++) if (inBounds(map, d.x + dx, d.y + dy)) out.push((d.y + dy) * map.w + d.x + dx);
  return out;
}

/** Clears a collapsed ruin: walls and chest are gone. Returns the tiles that changed. */
export function removeRuin(map: WorldMap, d: { x: number; y: number }): number[] {
  const changed: number[] = [];
  for (const i of ruinTiles(map, d)) {
    const o = map.objects[i];
    if (o === Obj.Ruin || o === Obj.Chest || o === Obj.ChestOpen) {
      map.objects[i] = Obj.None;
      changed.push(i);
    }
  }
  return changed;
}

/**
 * A spot for a new ruin, at random: dry land with nothing built or planted on the 7×7 around it,
 * nobody's land, away from villages, other ruins and the player (`away`). Null if none is found.
 */
export function pickRuinSite(
  map: WorldMap,
  rng: () => number,
  ownerAt: (i: number) => number,
  away: { x: number; y: number; r: number }[],
): DungeonSite | null {
  const ok = new Set<Obj>([Obj.None, Obj.Grass, Obj.Tree, Obj.Pine, Obj.Stump, Obj.Sapling, Obj.Rock]);
  for (let k = 0; k < 400; k++) {
    const x = 10 + Math.floor(rng() * (map.w - 20));
    const y = 10 + Math.floor(rng() * (map.h - 20));
    if (away.some((a) => Math.hypot(a.x - x, a.y - y) < a.r)) continue;
    const tiles = ruinTiles(map, { x, y });
    if (tiles.some((i) => map.ground[i] === Ground.Water || !ok.has(map.objects[i]) || ownerAt(i) !== -1)) continue;
    return { x, y, kind: KINDS[Math.floor(rng() * KINDS.length)] };
  }
  return null;
}

/** Lays a new ruin at runtime (the ground is left as it is): broken walls around a full chest. */
export function placeRuin(map: WorldMap, d: DungeonSite, rng: () => number): number[] {
  const changed: number[] = [];
  for (let dy = -3; dy <= 3; dy++)
    for (let dx = -3; dx <= 3; dx++) {
      const i = (d.y + dy) * map.w + d.x + dx;
      const ring = Math.max(Math.abs(dx), Math.abs(dy)) === 2;
      const gap = (dx === 0 && dy === 2) || (dx === 2 && dy === 0) || rng() < 0.25;
      map.objects[i] = ring && !gap ? Obj.Ruin : Obj.None;
      changed.push(i);
    }
  map.objects[d.y * map.w + d.x] = Obj.Chest;
  return changed;
}

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
