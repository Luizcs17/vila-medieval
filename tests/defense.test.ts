import { describe, expect, it } from 'vitest';
import { SOLDIER_BONUS_HP, VILLAGER_HP } from '../src/config';
import { BUILD_MENU, BUILDING_DEFS, Buildings } from '../src/game/buildings';
import { generateWanderer, maxHpOf, Population, soldierDamage } from '../src/game/npcs';
import { Territory } from '../src/game/territory';
import { generateMap, isWalkable, Obj, tileIndex } from '../src/world/map';
import { pathTo } from '../src/world/path';

const site = (map: ReturnType<typeof generateMap>) => map.sites[0];

describe('defensive buildings', () => {
  it('are in the build menu with HP, and towers can shoot', () => {
    for (const t of ['palisade', 'gate', 'tower', 'barracks'] as const) expect(BUILD_MENU).toContain(t);
    expect(BUILDING_DEFS.tower.defense?.range).toBeGreaterThan(0);
    expect(BUILDING_DEFS.barracks.job?.skill).toBe('combat');
    for (const t of BUILD_MENU) expect(BUILDING_DEFS[t].maxHp).toBeGreaterThan(0);
  });

  it('palisades block everyone; gates let people through', () => {
    const map = generateMap();
    const b = new Buildings(map);
    const s = site(map);
    b.place('palisade', s.x + 3, s.y, true);
    b.place('gate', s.x + 3, s.y + 1, true);
    expect(isWalkable(map, s.x + 3, s.y)).toBe(false);
    expect(map.objects[tileIndex(map, s.x + 3, s.y + 1)]).toBe(Obj.Gate);
    expect(isWalkable(map, s.x + 3, s.y + 1)).toBe(true); // villagers path through gates
    expect(b.at(tileIndex(map, s.x + 3, s.y + 1))?.type).toBe('gate');
  });

  it('a wall ring forces paths through the gate', () => {
    const map = generateMap();
    const b = new Buildings(map);
    const s = site(map);
    // 5×5 ring around the site, gate on the east side.
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== 2) continue;
        b.place(dx === 2 && dy === 0 ? 'gate' : 'palisade', s.x + dx, s.y + dy, true);
      }
    const path = pathTo(map, { x: s.x, y: s.y }, { x: s.x - 5, y: s.y })!;
    expect(path).not.toBeNull();
    expect(path.some((t) => t.x === s.x + 2 && t.y === s.y)).toBe(true);
  });

  it('take damage, get repaired up to max, and free their tiles when destroyed', () => {
    const map = generateMap();
    const b = new Buildings(map);
    const t = new Territory(map);
    const s = site(map);
    const tower = b.place('tower', s.x + 3, s.y + 3, true);
    t.recompute(b.list);
    expect(t.ownerAt(s.x + 9, s.y + 3)).toBe(0);
    expect(b.damage(tower, 50)).toBe(false);
    expect(tower.hp).toBe(BUILDING_DEFS.tower.maxHp - 50);
    expect(b.repair(tower, 999)).toBe(50);
    expect(b.damage(tower, 9999)).toBe(true);
    b.remove(tower);
    t.recompute(b.list);
    expect(isWalkable(map, s.x + 3, s.y + 3)).toBe(true);
    expect(b.list).toHaveLength(0);
    expect(t.ownerAt(s.x + 9, s.y + 3)).toBe(-1);
  });
});

describe('soldiers', () => {
  it('hit harder with a better Combate rating and have extra HP', () => {
    const map = generateMap();
    const b = new Buildings(map);
    const pop = new Population(b);
    const n = { ...generateWanderer(() => 0.4, 1, 0), role: 'villager' as const };
    n.skills = { ...n.skills, combat: 1 };
    expect(soldierDamage(n)).toBe(1);
    n.skills.combat = 5;
    expect(soldierDamage(n)).toBe(3);
    expect(soldierDamage({ ...n, food: 0 })).toBe(1);
    pop.npcs.push(n);
    expect(maxHpOf(n, b)).toBe(VILLAGER_HP);
    const s = site(map);
    const barracks = b.place('barracks', s.x + 3, s.y + 3, true);
    expect(pop.assign(n, barracks)).toBe(true);
    expect(maxHpOf(n, b)).toBe(VILLAGER_HP + SOLDIER_BONUS_HP);
  });
});
