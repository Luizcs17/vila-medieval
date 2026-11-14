import { TILE_H, TILE_W } from './config';

export interface Vec2 {
  x: number;
  y: number;
}

/**
 * World positions live in continuous grid space (tile units): tile (i, j) covers [i, i+1) x [j, j+1).
 * These helpers convert between grid space and screen (pixel) space.
 */
export function gridToScreen(gx: number, gy: number): Vec2 {
  return { x: ((gx - gy) * TILE_W) / 2, y: ((gx + gy) * TILE_H) / 2 };
}

export function screenToGrid(sx: number, sy: number): Vec2 {
  return { x: sx / TILE_W + sy / TILE_H, y: sy / TILE_H - sx / TILE_W };
}

/**
 * Converts a screen-space input direction (e.g. from WASD, where "up" is up on the monitor)
 * into a normalized grid-space direction. Returns {0,0} for no input.
 */
export function screenDirToGrid(dx: number, dy: number): Vec2 {
  const g = screenToGrid(dx, dy);
  const len = Math.hypot(g.x, g.y);
  return len === 0 ? { x: 0, y: 0 } : { x: g.x / len, y: g.y / len };
}
