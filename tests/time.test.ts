import { describe, expect, it } from 'vitest';
import { DAY_SECONDS } from '../src/config';
import { NODE_DEFS, ResourceNodes } from '../src/game/gathering';
import { ambientAt, formatClock, GameClock } from '../src/game/time';
import { generateMap, Obj } from '../src/world/map';

describe('clock', () => {
  it('starts in the morning of day 1 and rolls over to day 2', () => {
    const c = new GameClock(7);
    expect(c.day).toBe(1);
    expect(c.hour).toBeCloseTo(7);
    expect(c.isNight).toBe(false);
    c.advance(DAY_SECONDS);
    expect(c.day).toBe(2);
    expect(c.hour).toBeCloseTo(7);
  });

  it('formats in 10-minute steps', () => {
    expect(formatClock(7.5)).toBe('07:30');
    expect(formatClock(13.99)).toBe('13:50');
  });

  it('is clear at noon and dark at midnight', () => {
    expect(ambientAt(12).alpha).toBeLessThan(0.2); // a dim, warm day
    expect(ambientAt(0).alpha).toBeGreaterThan(0.4);
    const dusk = ambientAt(19).alpha;
    expect(dusk).toBeGreaterThan(0);
    expect(dusk).toBeLessThan(ambientAt(23).alpha);
  });
});

describe('regrowth', () => {
  const chopAll = (nodes: ResourceNodes, i: number, kind: Obj) => {
    for (let n = 0; n < NODE_DEFS[kind]!.amount; n++) nodes.harvest(i);
  };

  it('a stump becomes a sapling at half time and a tree at full time', () => {
    const map = generateMap();
    const nodes = new ResourceNodes(map);
    const i = map.objects.indexOf(Obj.Tree);
    chopAll(nodes, i, Obj.Tree);
    const total = NODE_DEFS[Obj.Tree]!.regrowSeconds;
    expect(nodes.update(total / 2 - 1, () => true)).toEqual([]);
    expect(nodes.update(1, () => true)).toEqual([i]);
    expect(map.objects[i]).toBe(Obj.Sapling);
    nodes.update(total / 2, () => true);
    expect(map.objects[i]).toBe(Obj.Tree);
    expect(nodes.remainingAt(i)).toBe(NODE_DEFS[Obj.Tree]!.amount);
  });

  it('waits while the tile is occupied', () => {
    const map = generateMap();
    const nodes = new ResourceNodes(map);
    const i = map.objects.indexOf(Obj.Iron);
    chopAll(nodes, i, Obj.Iron);
    nodes.update(NODE_DEFS[Obj.Iron]!.regrowSeconds + 10, () => false);
    expect(map.objects[i]).toBe(Obj.None);
    nodes.update(0.1, () => true);
    expect(map.objects[i]).toBe(Obj.Iron);
    expect(nodes.regrowingCount).toBe(0);
  });

  it('stops regrowing if something else is placed on the tile', () => {
    const map = generateMap();
    const nodes = new ResourceNodes(map);
    const i = map.objects.indexOf(Obj.Rock);
    chopAll(nodes, i, Obj.Rock);
    map.objects[i] = Obj.Building;
    nodes.update(10_000, () => true);
    expect(map.objects[i]).toBe(Obj.Building);
    expect(nodes.regrowingCount).toBe(0);
  });
});
