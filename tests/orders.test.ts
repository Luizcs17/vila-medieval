import { describe, expect, it } from 'vitest';
import { COMPANION_LEASH, COMPANION_RANGE, GUARD_RANGE } from '../src/config';
import { generateWanderer } from '../src/game/npcs';
import { commandLabel, engagement, stanceOf, takesOrders } from '../src/game/orders';

const person = () => generateWanderer(() => 0.4, 1, 1e9);

describe('orders and stances', () => {
  it('stances widen or narrow how far fighters reach', () => {
    const d = engagement('defensive', false);
    const n = engagement('neutral', false);
    const a = engagement('aggressive', false);
    expect(n).toEqual({ range: COMPANION_RANGE, leash: COMPANION_LEASH, anyAnimal: false });
    expect(d.range).toBeLessThan(n.range);
    expect(d.leash).toBeLessThan(n.leash);
    expect(a.range).toBeGreaterThan(n.range);
    expect(a.anyAnimal).toBe(true);
    expect(engagement('neutral', true).range).toBe(GUARD_RANGE);
  });

  it('default to neutral', () => {
    const p = person();
    expect(stanceOf(p)).toBe('neutral');
    p.stance = 'aggressive';
    expect(stanceOf(p)).toBe('aggressive');
  });

  it('only your companions and soldiers take orders', () => {
    const p = person();
    expect(takesOrders(p, true, false)).toBe(false); // a wanderer
    p.role = 'companion';
    expect(takesOrders(p, true, false)).toBe(true);
    p.role = 'villager';
    expect(takesOrders(p, true, false)).toBe(false); // a worker
    expect(takesOrders(p, true, true)).toBe(true); // a soldier
    expect(takesOrders(p, false, true)).toBe(false); // someone else's soldier
  });

  it('describe what they are doing', () => {
    expect(commandLabel(null, true)).toMatch(/Seguindo/);
    expect(commandLabel(null, false)).toMatch(/quartel/);
    expect(commandLabel({ kind: 'hold', x: 1, y: 2 }, false)).toMatch(/posição/);
  });
});
