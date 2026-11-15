import { describe, expect, it } from 'vitest';
import { DAY_SECONDS, PLAYER_HUNGER_PER_DAY, PLAYER_MEAL, PLAYER_STARVE_EVERY } from '../src/config';
import { BUILD_MENU, BUILDING_DEFS } from '../src/game/buildings';
import { PLAYER_HUNGRY, PlayerStats } from '../src/game/player';

describe('player hunger', () => {
  it('drains over the day, and eating gives it back', () => {
    const p = new PlayerStats();
    p.update(DAY_SECONDS / 2);
    expect(p.food).toBeCloseTo(100 - PLAYER_HUNGER_PER_DAY / 2);
    expect(p.wantsFood()).toBe(true);
    p.eat(2);
    expect(p.food).toBeCloseTo(100 - PLAYER_HUNGER_PER_DAY / 2 + PLAYER_MEAL);
    p.food = 100;
    expect(p.wantsFood()).toBe(false);
  });

  it('starving stops regeneration and drains HP', () => {
    const p = new PlayerStats();
    p.food = 1;
    p.hurt(1);
    expect(p.hungry).toBe(true);
    const lost = p.update(1 + PLAYER_STARVE_EVERY * 3 + 0.01);
    expect(p.starving).toBe(true);
    expect(lost).toBeGreaterThanOrEqual(2);
    expect(p.hp).toBeLessThan(p.maxHp - 2);
  });

  it('is saved, and old saves start full', () => {
    const p = new PlayerStats();
    p.food = PLAYER_HUNGRY;
    const q = new PlayerStats();
    q.restore(p.snapshot());
    expect(q.food).toBe(PLAYER_HUNGRY);
    q.restore({ hp: 5, maxHp: 10, level: 1, xp: 0 });
    expect(q.food).toBe(100);
  });
});

describe('your house and claiming land', () => {
  it('are in the build menu and affordable by hand', () => {
    expect(BUILD_MENU).toContain('home');
    expect(BUILD_MENU).toContain('claim');
    expect(BUILDING_DEFS.home.cost.iron).toBeUndefined();
    expect(BUILDING_DEFS.claim.cost.iron).toBeUndefined();
  });
});
