import { Obj, tileCenter, tileIndex, inBounds, type WorldMap } from '../world/map';
import type { Resource } from './inventory';

export interface NodeDef {
  resource: Resource;
  /** Units a fresh node holds before it is depleted. */
  amount: number;
  /** Seconds of holding the gather key per unit. */
  secondsPerUnit: number;
  /** What the tile becomes when the node runs out. */
  depletesTo: Obj;
  /** Game seconds until a depleted node grows back (trees pass through a sapling stage at half time). */
  regrowSeconds: number;
  /** UI words, e.g. "Cortar árvore". */
  verb: string;
  name: string;
}

// Regrow times are relative to the day length (DAY_SECONDS = 480 → half a day = 240 s).
export const NODE_DEFS: Partial<Record<Obj, NodeDef>> = {
  [Obj.Tree]: { resource: 'wood', amount: 4, secondsPerUnit: 0.9, depletesTo: Obj.Stump, regrowSeconds: 240, verb: 'Cortar', name: 'árvore' },
  [Obj.Pine]: { resource: 'wood', amount: 5, secondsPerUnit: 1.0, depletesTo: Obj.Stump, regrowSeconds: 300, verb: 'Cortar', name: 'pinheiro' },
  [Obj.Rock]: { resource: 'stone', amount: 4, secondsPerUnit: 1.2, depletesTo: Obj.None, regrowSeconds: 480, verb: 'Quebrar', name: 'pedra' },
  [Obj.Iron]: { resource: 'iron', amount: 3, secondsPerUnit: 1.8, depletesTo: Obj.None, regrowSeconds: 720, verb: 'Minerar', name: 'ferro' },
};

interface Regrowth {
  i: number;
  original: Obj;
  timeLeft: number;
  total: number;
}

/** Objects a regrowing node may currently be in; anything else means something replaced it. */
const REGROW_STAGES = new Set<Obj>([Obj.None, Obj.Stump, Obj.Sapling]);

export interface HarvestResult {
  resource: Resource;
  depleted: boolean;
  /** The tile's object after harvesting (changes only when depleted). */
  obj: Obj;
}

/** Tracks how much is left in each resource node, depletes it on the map and grows it back over time. */
export class ResourceNodes {
  private readonly remaining = new Map<number, number>();
  private regrowing: Regrowth[] = [];

  constructor(private readonly map: WorldMap) {}

  remainingAt(i: number): number {
    const def = NODE_DEFS[this.map.objects[i]];
    if (!def) return 0;
    return this.remaining.get(i) ?? def.amount;
  }

  /** Takes one unit from the node at tile index `i`. Returns null if there is no node there. */
  harvest(i: number): HarvestResult | null {
    const def = NODE_DEFS[this.map.objects[i]];
    if (!def) return null;
    const left = this.remainingAt(i) - 1;
    if (left > 0) {
      this.remaining.set(i, left);
      return { resource: def.resource, depleted: false, obj: this.map.objects[i] };
    }
    this.remaining.delete(i);
    this.regrowing.push({ i, original: this.map.objects[i], timeLeft: def.regrowSeconds, total: def.regrowSeconds });
    this.map.objects[i] = def.depletesTo;
    return { resource: def.resource, depleted: true, obj: def.depletesTo };
  }

  /**
   * Advances regrowth by `dt` game seconds. A node that would block movement only reappears
   * when `canPlace(i)` is true (e.g. the player is not standing there); otherwise it waits.
   * Returns the tile indices whose object changed, so the caller can refresh sprites.
   */
  update(dt: number, canPlace: (i: number) => boolean): number[] {
    const changed: number[] = [];
    const objs = this.map.objects;
    this.regrowing = this.regrowing.filter((r) => {
      if (!REGROW_STAGES.has(objs[r.i])) return false; // something was built here: stop regrowing
      r.timeLeft -= dt;
      if (objs[r.i] === Obj.Stump && r.timeLeft <= r.total / 2) {
        objs[r.i] = Obj.Sapling;
        changed.push(r.i);
      }
      if (r.timeLeft <= 0 && canPlace(r.i)) {
        objs[r.i] = r.original;
        changed.push(r.i);
        return false;
      }
      return true;
    });
    return changed;
  }

  get regrowingCount(): number {
    return this.regrowing.length;
  }
}

/**
 * Nearest tile (index) around grid position (gx, gy) whose object passes `accept`, measuring
 * to the tile's closest edge (so every tile of a multi-tile building is equally reachable).
 * Ties go to the tile whose centre is closer. Null if nothing is within `reach`.
 */
export function nearestTile(
  map: WorldMap,
  gx: number,
  gy: number,
  reach: number,
  accept: (obj: Obj) => boolean,
): number | null {
  let best: number | null = null;
  let bestScore = Infinity;
  const r = Math.ceil(reach) + 1;
  for (let ty = Math.floor(gy) - r; ty <= Math.floor(gy) + r; ty++) {
    for (let tx = Math.floor(gx) - r; tx <= Math.floor(gx) + r; tx++) {
      if (!inBounds(map, tx, ty)) continue;
      const i = tileIndex(map, tx, ty);
      if (!accept(map.objects[i])) continue;
      const edge = Math.hypot(Math.max(tx - gx, 0, gx - (tx + 1)), Math.max(ty - gy, 0, gy - (ty + 1)));
      if (edge > reach) continue;
      const c = tileCenter(map, i);
      const score = edge * 100 + Math.hypot(c.x - gx, c.y - gy);
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
  }
  return best;
}

/** Hold-to-gather timer. Progress resets when the target changes or the player lets go. */
export class Gatherer {
  target: number | null = null;
  progress = 0;

  /** Advances the timer. Returns true when one unit has been gathered. */
  tick(dt: number, target: number | null, active: boolean, secondsPerUnit: number): boolean {
    if (target !== this.target) {
      this.target = target;
      this.progress = 0;
    }
    if (!active || target === null) {
      this.progress = 0;
      return false;
    }
    this.progress += dt;
    if (this.progress >= secondsPerUnit) {
      this.progress = 0;
      return true;
    }
    return false;
  }
}
