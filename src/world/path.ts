import { inBounds, isWalkable, tileIndex, type WorldMap } from './map';

export interface Tile {
  x: number;
  y: number;
}

/** Minimal binary min-heap keyed by number. */
class Heap {
  private readonly items: { key: number; value: number }[] = [];

  get size(): number {
    return this.items.length;
  }

  push(value: number, key: number): void {
    const a = this.items;
    a.push({ key, value });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].key <= a[i].key) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }

  pop(): number {
    const a = this.items;
    const top = a[0];
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l].key < a[m].key) m = l;
        if (r < a.length && a[r].key < a[m].key) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top.value;
  }
}

const DIRS = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
] as const;

/**
 * A* over walkable tiles, 8 directions, no cutting corners past blocked tiles.
 * The start tile itself may be blocked (so a character stuck inside an obstacle can walk out).
 * Returns the tiles to visit after `from`, ending on the first tile where `isGoal` is true,
 * `[]` if `from` already is a goal, or null if no goal is reachable within `maxNodes` expansions.
 */
export function findPath(
  map: WorldMap,
  from: Tile,
  isGoal: (x: number, y: number) => boolean,
  toward: Tile,
  maxNodes = 5000,
): Tile[] | null {
  if (isGoal(from.x, from.y)) return [];
  const start = tileIndex(map, from.x, from.y);
  const g = new Map<number, number>([[start, 0]]);
  const parent = new Map<number, number>();
  const open = new Heap();
  const h = (x: number, y: number) => Math.hypot(x - toward.x, y - toward.y);
  open.push(start, h(from.x, from.y));
  let expanded = 0;

  while (open.size > 0 && expanded++ < maxNodes) {
    const cur = open.pop();
    const cx = cur % map.w;
    const cy = Math.floor(cur / map.w);
    if (isGoal(cx, cy)) {
      const path: Tile[] = [];
      for (let n = cur; n !== start; n = parent.get(n)!) path.push({ x: n % map.w, y: Math.floor(n / map.w) });
      return path.reverse();
    }
    const gc = g.get(cur)!;
    for (const [dx, dy, cost] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!inBounds(map, nx, ny) || !isWalkable(map, nx, ny)) continue;
      if (dx !== 0 && dy !== 0 && (!isWalkable(map, cx + dx, cy) || !isWalkable(map, cx, cy + dy))) continue;
      const ni = tileIndex(map, nx, ny);
      const ng = gc + cost;
      if (ng < (g.get(ni) ?? Infinity)) {
        g.set(ni, ng);
        parent.set(ni, cur);
        open.push(ni, ng + h(nx, ny));
      }
    }
  }
  return null;
}

/** Path to one exact tile. */
export function pathTo(map: WorldMap, from: Tile, to: Tile, maxNodes?: number): Tile[] | null {
  return findPath(map, from, (x, y) => x === to.x && y === to.y, to, maxNodes);
}
