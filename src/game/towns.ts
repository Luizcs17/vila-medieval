import { Obj, tileIndex, type WorldMap } from '../world/map';
import { findPath } from '../world/path';
import { BUILDING_DEFS, type Building, type Buildings, type BuildingType } from './buildings';
import type { Faction } from './factions';
import { generateWanderer, type NpcData, type Population, type Rng } from './npcs';

/** True if no other building touches the footprint (keeps a 1-tile lane around every building). */
function clearAround(buildings: Buildings, type: BuildingType, x: number, y: number): boolean {
  const size = BUILDING_DEFS[type].size;
  for (let ty = y - 1; ty <= y + size; ty++)
    for (let tx = x - 1; tx <= x + size; tx++) {
      if (tx < 0 || ty < 0) continue;
      if (buildings.at(ty * buildings.mapWidth + tx)) return false;
    }
  return true;
}

/** Ring search: the first spot near `site` where `type` can be placed (closest rings first). */
export function findSpot(
  buildings: Buildings,
  type: BuildingType,
  site: { x: number; y: number },
  minR: number,
  maxR: number,
  rng: Rng,
): { x: number; y: number } | null {
  for (let r = minR; r <= maxR; r++) {
    const steps = Math.max(8, Math.round(r * 6));
    const offset = rng() * Math.PI * 2;
    for (let k = 0; k < steps; k++) {
      const a = offset + (k / steps) * Math.PI * 2;
      const x = Math.round(site.x + Math.cos(a) * r);
      const y = Math.round(site.y + Math.sin(a) * r);
      if (buildings.check(type, x, y).ok && clearAround(buildings, type, x, y)) return { x, y };
    }
  }
  return null;
}

/**
 * Lays the old roads between villages: each village to its nearest neighbours, along walkable
 * ground (around trees, rocks and water). Returns the tiles that became road.
 */
export function buildRoadNetwork(map: WorldMap, centers: { x: number; y: number }[]): number[] {
  const laid: number[] = [];
  const pairs = new Set<string>();
  for (let a = 0; a < centers.length; a++) {
    const near = centers
      .map((c, b) => ({ b, d: Math.hypot(c.x - centers[a].x, c.y - centers[a].y) }))
      .filter((x) => x.b !== a)
      .sort((x, y) => x.d - y.d)
      .slice(0, 2);
    for (const { b } of near) pairs.add(a < b ? `${a}:${b}` : `${b}:${a}`);
  }
  for (const key of pairs) {
    const [a, b] = key.split(':').map(Number);
    const from = { x: centers[a].x, y: centers[a].y + 1 };
    const to = { x: centers[b].x, y: centers[b].y + 1 };
    const path = findPath(map, from, (x, y) => Math.abs(x - to.x) <= 1 && Math.abs(y - to.y) <= 1, to, 40000);
    const lay = (x: number, y: number) => {
      const i = tileIndex(map, x, y);
      const o = map.objects[i];
      if (o === Obj.None || o === Obj.Stump || o === Obj.Sapling) {
        map.objects[i] = Obj.Road;
        laid.push(i);
      }
    };
    let prev = from;
    for (const t of path ?? []) {
      lay(t.x, t.y);
      // Diagonal steps would leave stones touching only at the corners: fill the elbow.
      if (t.x !== prev.x && t.y !== prev.y) lay(t.x, prev.y);
      prev = t;
    }
  }
  return laid;
}

/** The order rival villages staff their workplaces in: food, materials, then the rest. */
export const JOB_PRIORITY: BuildingType[] = [
  'farm',
  'hunter',
  'lumberjack',
  'quarry',
  'embassy',
  'barracks',
  'mine',
  'smithy',
  'market',
];

/**
 * Gives jobs to a village's unemployed adults: first one person per workplace in the given
 * (priority) order, then the remaining slots in the same order.
 */
export function staffInOrder(pop: Population, workplaces: Building[], faction: number): void {
  for (const b of workplaces) {
    if (pop.workers(b.id).length > 0) continue;
    const n = pop.unemployed(undefined, faction)[0];
    if (!n) return;
    pop.assign(n, b);
  }
  for (const b of workplaces) for (const n of pop.unemployed(undefined, faction)) if (!pop.assign(n, b)) break;
}

/** Lays out a rival village: hall (stockpile), houses and a few workplaces, all finished. */
export function foundTown(buildings: Buildings, faction: Faction, rng: Rng): Building[] {
  const placed: Building[] = [];
  const site = faction.center;
  if (buildings.check('stockpile', site.x, site.y).ok)
    placed.push(buildings.place('stockpile', site.x, site.y, true, faction.id));
  const plan: [BuildingType, number, number][] = [
    ['house', 3, 6],
    ['house', 3, 7],
    ['house', 4, 8],
    ['lumberjack', 4, 10],
    ['quarry', 4, 12],
    ['hunter', 3, 8],
    ['farm', 4, 9],
    ['barracks', 4, 10],
    ['market', 3, 10],
    ['embassy', 4, 11],
  ];
  for (const [type, minR, maxR] of plan) {
    const spot = findSpot(buildings, type, site, minR, maxR, rng);
    if (spot) placed.push(buildings.place(type, spot.x, spot.y, true, faction.id));
  }
  return placed;
}

/**
 * Creates `count` villagers for a rival town, housed and employed (the first is the ruler).
 * Returns them (already added to the population).
 */
export function populateTown(
  pop: Population,
  buildings: Buildings,
  faction: Faction,
  rng: Rng,
  count: number,
  now = 0,
): NpcData[] {
  const mine = buildings.list.filter((b) => b.faction === faction.id);
  const houses = mine.filter((b) => b.type === 'house');
  // Food first: farmers and hunters before everything else.
  const work = mine
    .filter((b) => b.type !== 'house' && b.type !== 'stockpile' && b.type !== 'depot')
    .sort((a, b) => JOB_PRIORITY.indexOf(a.type) - JOB_PRIORITY.indexOf(b.type));
  const made: NpcData[] = [];
  for (let k = 0; k < count && houses.length > 0; k++) {
    const n = generateWanderer(rng, pop.newId(), Infinity, now);
    n.role = 'villager';
    n.faction = faction.id;
    n.homeId = houses[k % houses.length].id;
    pop.npcs.push(n);
    made.push(n);
  }
  staffInOrder(pop, work, faction.id);
  if (made.length > 0) faction.rulerId = made[0].id;
  return made;
}
