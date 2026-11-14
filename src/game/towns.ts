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

/** Lays out a rival village: hall (stockpile), houses and a few workplaces, all finished. */
export function foundTown(buildings: Buildings, faction: Faction, rng: Rng): Building[] {
  const placed: Building[] = [];
  const site = faction.center;
  if (buildings.check('stockpile', site.x, site.y).ok)
    placed.push(buildings.place('stockpile', site.x, site.y, true, faction.id));
  const plan: [BuildingType, number, number][] = [
    ['house', 3, 6],
    ['house', 3, 7],
    ['lumberjack', 4, 10],
    ['quarry', 4, 12],
    ['hunter', 3, 8],
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
export function populateTown(pop: Population, buildings: Buildings, faction: Faction, rng: Rng, count: number): NpcData[] {
  const mine = buildings.list.filter((b) => b.faction === faction.id);
  const houses = mine.filter((b) => b.type === 'house');
  const work = mine.filter((b) => b.type !== 'house' && b.type !== 'stockpile' && b.type !== 'depot');
  const made: NpcData[] = [];
  for (let k = 0; k < count && houses.length > 0; k++) {
    const n = generateWanderer(rng, pop.newId(), Infinity);
    n.role = 'villager';
    n.faction = faction.id;
    n.homeId = houses[k % houses.length].id;
    pop.npcs.push(n);
    made.push(n);
  }
  // Jobs: fill each workplace's slots, best candidates first.
  for (const b of work) {
    for (const n of pop.unemployed(undefined, faction.id)) {
      if (!pop.assign(n, b)) break;
    }
  }
  if (made.length > 0) faction.rulerId = made[0].id;
  return made;
}
