import { describe, expect, it } from 'vitest';
import { BUILDING_DEFS, Buildings } from '../src/game/buildings';
import { NODE_DEFS, ResourceNodes } from '../src/game/gathering';
import { buildRoadNetwork } from '../src/game/towns';
import { generateMap, isRoad, isWalkable, Obj, tileIndex } from '../src/world/map';
import { pathTo } from '../src/world/path';

describe('roads', () => {
  it('are walkable and can be built over', () => {
    const map = generateMap();
    const s = map.sites[0];
    const i = tileIndex(map, s.x + 2, s.y + 2);
    map.objects[i] = Obj.Road;
    expect(isRoad(map, s.x + 2, s.y + 2)).toBe(true);
    expect(isWalkable(map, s.x + 2, s.y + 2)).toBe(true);
    expect(new Buildings(map).check('depot', s.x + 2, s.y + 2).ok).toBe(true);
    expect(BUILDING_DEFS.road.cost).toEqual({ stone: 1 });
  });

  it('pathfinding takes a road detour when it is cheaper', () => {
    const map = generateMap();
    const s = map.sites[0];
    // A straight road one row up from the direct line.
    for (let x = s.x - 4; x <= s.x + 4; x++) map.objects[tileIndex(map, x, s.y - 1)] = Obj.Road;
    const path = pathTo(map, { x: s.x - 4, y: s.y }, { x: s.x + 4, y: s.y })!;
    const onRoad = path.filter((t) => isRoad(map, t.x, t.y)).length;
    expect(onRoad).toBeGreaterThan(path.length / 2);
  });

  it('connect every village on a new map', () => {
    const map = generateMap();
    const laid = buildRoadNetwork(map, map.sites);
    expect(laid.length).toBeGreaterThan(100);
    // Each village has road right next to its centre.
    for (const c of map.sites) {
      let near = false;
      for (let dy = -2; dy <= 3; dy++) for (let dx = -2; dx <= 2; dx++) near ||= isRoad(map, c.x + dx, c.y + dy);
      expect(near).toBe(true);
    }
  });

  it('stop trees growing back on them', () => {
    const map = generateMap();
    const nodes = new ResourceNodes(map);
    const i = map.objects.indexOf(Obj.Tree);
    for (let n = 0; n < NODE_DEFS[Obj.Tree]!.amount; n++) nodes.harvest(i);
    map.objects[i] = Obj.Road;
    nodes.update(10_000, () => true);
    expect(map.objects[i]).toBe(Obj.Road);
  });
});
