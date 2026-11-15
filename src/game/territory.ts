import type { WorldMap } from '../world/map';
import { BUILDING_DEFS, type Building } from './buildings';

/** No owner. */
export const NO_OWNER = -1;

/**
 * Which faction owns each tile. Every building (finished or under construction) claims the tiles
 * within its `claim` radius; a tile belongs to the nearest claiming building (ties: oldest).
 */
export class Territory {
  readonly owner: Int8Array;
  private readonly best: Float32Array;

  constructor(private readonly map: WorldMap) {
    this.owner = new Int8Array(map.w * map.h).fill(NO_OWNER);
    this.best = new Float32Array(map.w * map.h);
  }

  ownerAt(tx: number, ty: number): number {
    if (tx < 0 || ty < 0 || tx >= this.map.w || ty >= this.map.h) return NO_OWNER;
    return this.owner[ty * this.map.w + tx];
  }

  /** Rebuilds ownership from scratch (cheap: a few hundred tiles per building). */
  recompute(buildings: readonly Building[]): void {
    this.owner.fill(NO_OWNER);
    this.best.fill(Infinity);
    const w = this.map.w;
    for (const b of buildings) {
      const def = BUILDING_DEFS[b.type];
      const r = def.claim;
      if (r <= 0) continue;
      const cx = b.tx + def.size / 2;
      const cy = b.ty + def.size / 2;
      for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(this.map.h - 1, Math.ceil(cy + r)); y++) {
        for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(w - 1, Math.ceil(cx + r)); x++) {
          const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
          if (d > r) continue;
          const i = y * w + x;
          if (d < this.best[i]) {
            this.best[i] = d;
            this.owner[i] = b.faction;
          }
        }
      }
    }
    // A farm's planting area belongs to the farm's village.
    for (const b of buildings)
      for (const i of b.plot?.tiles ?? []) {
        this.best[i] = 0;
        this.owner[i] = b.faction;
      }
  }

  /** Tiles owned by `faction`. */
  area(faction: number): number {
    let n = 0;
    for (const o of this.owner) if (o === faction) n++;
    return n;
  }

  /**
   * Can `faction` build a footprint here? Its centre must be on the faction's own land and no tile
   * may be on another faction's land (so you grow by building at your border).
   */
  canBuild(faction: number, tx: number, ty: number, size: number): boolean {
    const c = this.ownerAt(Math.floor(tx + size / 2 - 0.01), Math.floor(ty + size / 2 - 0.01));
    if (c !== faction) return false;
    for (let y = ty; y < ty + size; y++)
      for (let x = tx; x < tx + size; x++) {
        const o = this.ownerAt(x, y);
        if (o !== NO_OWNER && o !== faction) return false;
      }
    return true;
  }
}
