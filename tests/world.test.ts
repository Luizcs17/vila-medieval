import { describe, expect, it } from 'vitest';
import { Gatherer, NODE_DEFS, nearestTile, ResourceNodes } from '../src/game/gathering';
import { Inventory } from '../src/game/inventory';
import { gridToScreen, screenDirToGrid, screenToGrid } from '../src/iso';
import { generateMap, isWalkable, Obj, tileIndex } from '../src/world/map';

describe('iso projection', () => {
  it('round-trips grid <-> screen', () => {
    for (const [x, y] of [
      [0, 0],
      [3.25, 7.5],
      [63, 1],
    ]) {
      const s = gridToScreen(x, y);
      const g = screenToGrid(s.x, s.y);
      expect(g.x).toBeCloseTo(x);
      expect(g.y).toBeCloseTo(y);
    }
  });

  it('maps "up" on screen to moving up on screen', () => {
    const d = screenDirToGrid(0, -1);
    const s = gridToScreen(d.x, d.y);
    expect(s.x).toBeCloseTo(0);
    expect(s.y).toBeLessThan(0);
  });
});

describe('fixed map', () => {
  const map = generateMap();

  it('is deterministic', () => {
    expect(generateMap()).toEqual(map);
  });

  it('spawns the player on a walkable tile with room to move', () => {
    const sx = Math.floor(map.spawn.x);
    const sy = Math.floor(map.spawn.y);
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) expect(isWalkable(map, sx + dx, sy + dy)).toBe(true);
  });

  it('contains every v1 resource node', () => {
    for (const kind of [Obj.Tree, Obj.Pine, Obj.Rock, Obj.Iron]) {
      expect(map.objects.filter((o) => o === kind).length).toBeGreaterThan(5);
    }
  });

  it('blocks out-of-bounds tiles', () => {
    expect(isWalkable(map, -1, 0)).toBe(false);
    expect(isWalkable(map, map.w, 0)).toBe(false);
  });
});

describe('inventory', () => {
  it('respects capacity', () => {
    const bag = new Inventory(3);
    expect(bag.add('wood', 2)).toBe(2);
    expect(bag.add('stone', 5)).toBe(1);
    expect(bag.free).toBe(0);
  });

  it('transfers everything into the stockpile', () => {
    const bag = new Inventory(10);
    const stock = new Inventory();
    bag.add('wood', 4);
    bag.add('iron', 1);
    const moved = bag.transferAllTo(stock);
    expect(moved).toEqual({ wood: 4, stone: 0, iron: 1, meat: 0, leather: 0 });
    expect(bag.total).toBe(0);
    expect(stock.items.wood).toBe(4);
  });
});

describe('gathering', () => {
  /** First tile index holding `kind`. */
  const find = (map: ReturnType<typeof generateMap>, kind: Obj) => map.objects.indexOf(kind);

  it('a tree yields its wood and then becomes a walkable stump', () => {
    const map = generateMap();
    const nodes = new ResourceNodes(map);
    const i = find(map, Obj.Tree);
    const amount = NODE_DEFS[Obj.Tree]!.amount;
    for (let n = 1; n < amount; n++) expect(nodes.harvest(i)).toMatchObject({ resource: 'wood', depleted: false });
    expect(nodes.harvest(i)).toMatchObject({ resource: 'wood', depleted: true, obj: Obj.Stump });
    expect(map.objects[i]).toBe(Obj.Stump);
    expect(isWalkable(map, i % map.w, Math.floor(i / map.w))).toBe(true);
    expect(nodes.harvest(i)).toBeNull();
  });

  it('rocks and iron disappear when depleted', () => {
    const map = generateMap();
    const nodes = new ResourceNodes(map);
    for (const kind of [Obj.Rock, Obj.Iron]) {
      const i = find(map, kind);
      let last = null;
      for (let n = 0; n < NODE_DEFS[kind]!.amount; n++) last = nodes.harvest(i);
      expect(last).toMatchObject({ depleted: true, obj: Obj.None });
    }
  });

  it('finds the nearest interactable tile within reach', () => {
    const map = generateMap();
    const i = find(map, Obj.Iron);
    const tx = i % map.w;
    const ty = Math.floor(i / map.w);
    expect(nearestTile(map, tx + 0.5, ty + 1.3, 0.9, (o) => o === Obj.Iron)).toBe(tileIndex(map, tx, ty));
    expect(nearestTile(map, tx + 0.5, ty + 1.3, 0.9, () => false)).toBeNull();
  });

  it('gatherer completes a unit only after holding long enough on the same target', () => {
    const g = new Gatherer();
    expect(g.tick(0.5, 7, true, 1)).toBe(false);
    expect(g.tick(0.6, 7, true, 1)).toBe(true);
    expect(g.tick(0.9, 7, true, 1)).toBe(false);
    expect(g.tick(0.9, 8, true, 1)).toBe(false); // target changed: restart
    expect(g.tick(0.5, 8, false, 1)).toBe(false); // let go: restart
    expect(g.progress).toBe(0);
  });
});
