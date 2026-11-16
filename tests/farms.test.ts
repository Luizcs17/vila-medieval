import { describe, expect, it } from 'vitest';
import { SEED_CHANCE } from '../src/config';
import { Buildings } from '../src/game/buildings';
import {
  clearPlot,
  FARM_MAX,
  GROW_SECONDS,
  harvestCrop,
  nextFarmTask,
  plant,
  plotRect,
  plotTileProblem,
  rectTiles,
  ripen,
  setPlot,
} from '../src/game/farms';
import { ResourceNodes } from '../src/game/gathering';
import { Territory } from '../src/game/territory';
import { Ground, generateMap, Obj, tileIndex } from '../src/world/map';

const setup = () => {
  const map = generateMap();
  const buildings = new Buildings(map);
  // A clean grass patch next to the farm.
  const fx = map.sites[0].x + 1;
  const fy = map.sites[0].y + 1;
  for (let y = fy - 6; y <= fy + 8; y++)
    for (let x = fx - 6; x <= fx + 8; x++) {
      map.ground[tileIndex(map, x, y)] = Ground.Grass;
      map.objects[tileIndex(map, x, y)] = Obj.None;
    }
  const farm = buildings.place('farm', fx, fy, true, 0);
  return { map, buildings, farm, fx, fy };
};

describe('farm plots', () => {
  it('are at most 5×5, whichever way you drag', () => {
    const r = plotRect(10, 10, 20, 2);
    expect(r).toEqual({ x0: 10, y0: 6, x1: 14, y1: 10 });
    expect(r.x1 - r.x0 + 1).toBe(FARM_MAX);
  });

  it('only go on free grass near the farm', () => {
    const { map, farm, fx, fy } = setup();
    const free = () => -1;
    const at = (x: number, y: number) => tileIndex(map, x, y);
    expect(plotTileProblem(map, farm, at(fx + 3, fy), free)).toBeNull();
    map.objects[at(fx + 3, fy)] = Obj.Grass; // tufts are fine
    expect(plotTileProblem(map, farm, at(fx + 3, fy), free)).toBeNull();
    map.ground[at(fx + 4, fy)] = Ground.Sand;
    expect(plotTileProblem(map, farm, at(fx + 4, fy), free)).toMatch(/grama/);
    map.objects[at(fx + 5, fy)] = Obj.Rock;
    expect(plotTileProblem(map, farm, at(fx + 5, fy), free)).toMatch(/caminho/);
    expect(plotTileProblem(map, farm, at(fx + 3, fy), () => 2)).toMatch(/outra vila/);
    expect(plotTileProblem(map, farm, at(fx + 30, fy), free)).toMatch(/Longe/);
  });

  it('grow over three days, give food and seeds, and claim land', () => {
    const { map, buildings, farm, fx, fy } = setup();
    const tiles = rectTiles(map, plotRect(fx + 3, fy, fx + 4, fy + 1));
    setPlot(map, farm, tiles);
    expect(tiles.every((i) => map.objects[i] === Obj.Field)).toBe(true);
    const t = new Territory(map);
    t.recompute(buildings.list);
    for (const i of tiles) expect(t.owner[i]).toBe(0);

    expect(nextFarmTask(map, farm.plot, false)).toBeNull(); // no seeds
    const task = nextFarmTask(map, farm.plot, true)!;
    expect(task.kind).toBe('plant');
    expect(plant(map, farm.plot!, task.tile, 100)).toBe(true);
    expect(ripen(map, farm.plot, 100 + GROW_SECONDS - 1)).toEqual([]);
    expect(ripen(map, farm.plot, 100 + GROW_SECONDS)).toEqual([task.tile]);
    expect(nextFarmTask(map, farm.plot, false)).toEqual({ kind: 'harvest', tile: task.tile });
    expect(harvestCrop(map, farm.plot!, task.tile, () => 0.99)).toEqual({ food: 2, seeds: 1 });
    expect(map.objects[task.tile]).toBe(Obj.Field);
    plant(map, farm.plot!, task.tile, 0);
    ripen(map, farm.plot, GROW_SECONDS);
    expect(harvestCrop(map, farm.plot!, task.tile, () => 0)).toEqual({ food: 2, seeds: 2 });

    // Shrinking the plot (or losing the farm) turns fields back into plain ground.
    setPlot(map, farm, tiles.slice(0, 1));
    expect(map.objects[tiles[1]]).toBe(Obj.None);
    clearPlot(map, farm);
    expect(map.objects[tiles[0]]).toBe(Obj.None);
    expect(farm.plot).toBeUndefined();
  });
});

describe('grass', () => {
  it('is spread on the map and rarely gives a seed', () => {
    const map = generateMap();
    expect(map.objects.filter((o) => o === Obj.Grass).length).toBeGreaterThan(100);
    const nodes = new ResourceNodes(map);
    const i = map.objects.indexOf(Obj.Grass);
    expect(nodes.harvest(i, () => SEED_CHANCE + 0.01)?.resource).toBeNull();
    expect(map.objects[i]).toBe(Obj.None); // one pull, then it grows back
    const j = map.objects.indexOf(Obj.Grass);
    expect(nodes.harvest(j, () => 0)?.resource).toBe('seed');
  });
});
