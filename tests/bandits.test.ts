import { describe, expect, it } from 'vitest';
import { BANDIT_STAY, DAY_SECONDS, VILLAGER_HP } from '../src/config';
import { BANDITS } from '../src/game/factions';
import { generateBandit, roleLabel } from '../src/game/npcs';

describe('bandits', () => {
  it('are armed, belong to no village and march on their target', () => {
    let seed = 11;
    const rng = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    const n = generateBandit(rng, 7, 2, BANDIT_STAY * DAY_SECONDS, 0);
    expect(n.role).toBe('bandit');
    expect(n.faction).toBe(BANDITS);
    expect(n.order).toEqual({ kind: 'raid', target: 2 });
    expect(['spear', 'iron_sword']).toContain(n.weapon);
    expect(n.hp).toBeGreaterThan(VILLAGER_HP);
    expect(roleLabel('bandit', 'm')).toBe('Bandido');
  });
});
