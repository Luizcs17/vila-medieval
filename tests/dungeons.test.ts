import { describe, expect, it } from 'vitest';
import { rollLoot } from '../src/game/dungeons';
import { DUNGEON_COUNT, generateMap, isWalkable, Obj } from '../src/world/map';

describe('dungeons', () => {
  it('are ruins with a chest, far from every village, the same on every map', () => {
    const map = generateMap();
    expect(map.dungeons).toHaveLength(DUNGEON_COUNT);
    expect(generateMap().dungeons).toEqual(map.dungeons);
    for (const d of map.dungeons) {
      expect(map.objects[d.y * map.w + d.x]).toBe(Obj.Chest);
      for (const s of map.sites) expect(Math.hypot(s.x - d.x, s.y - d.y)).toBeGreaterThanOrEqual(24);
      // The ring has openings: the tile south of the chest leads out.
      expect(isWalkable(map, d.x, d.y + 2)).toBe(true);
    }
    expect(new Set(map.dungeons.map((d) => d.kind))).toEqual(new Set(['wolves', 'bears', 'bandits']));
  });

  it('chests hold coins, good gear, iron and leather', () => {
    let seed = 3;
    const rng = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    const l = rollLoot(rng, 'bears');
    expect(l.coins).toBeGreaterThanOrEqual(45);
    expect(l.items.some((i) => ['iron_sword', 'iron_armor', 'iron_axe', 'iron_pick', 'leather_armor'].includes(i.item))).toBe(
      true,
    );
    expect(l.items.find((i) => i.item === 'iron')!.count).toBeGreaterThanOrEqual(5);
  });
});
