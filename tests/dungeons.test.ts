import { describe, expect, it } from 'vitest';
import { pickRuinSite, placeRuin, removeRuin, rollLoot } from '../src/game/dungeons';
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

describe('ruins come and go', () => {
  it('a looted ruin collapses and a new one is laid on free land far from villages', () => {
    const map = generateMap();
    const old = map.dungeons[0];
    const changed = removeRuin(map, old);
    expect(changed.length).toBeGreaterThan(5);
    expect(map.objects[old.y * map.w + old.x]).toBe(Obj.None);
    let seed = 7;
    const rng = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    const away = map.sites.map((s) => ({ x: s.x, y: s.y, r: 24 }));
    const site = pickRuinSite(map, rng, () => -1, away)!;
    expect(site).not.toBeNull();
    for (const s of map.sites) expect(Math.hypot(s.x - site.x, s.y - site.y)).toBeGreaterThanOrEqual(24);
    placeRuin(map, site, rng);
    expect(map.objects[site.y * map.w + site.x]).toBe(Obj.Chest);
    // Claimed land everywhere: nowhere to put it.
    expect(pickRuinSite(map, rng, () => 1, away)).toBeNull();
  });
});
