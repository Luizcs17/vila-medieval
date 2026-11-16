import { BUILDING_DEFS, type BuildingType } from './buildings';
import type { Amounts } from './inventory';

/**
 * Rival village planning as a utility AI: every option gets a score from the village's needs
 * (food, beds, defence, materials, tools, reach) times its personality, and the best one it can
 * afford is built. When the most urgent option is too expensive, the village saves up for it
 * instead of spending on something else.
 */

/** What a village knows about itself when it plans. */
export interface TownState {
  people: number;
  freeBeds: number;
  /** Days its food stock lasts. */
  foodDays: number;
  /** At war, or with a bad neighbour. */
  threatened: boolean;
  /** Finished buildings by type. */
  count: Partial<Record<BuildingType, number>>;
  stock: Amounts;
  soldiers: number;
}

/** A village's leanings (each 0.6–1.4): how much it cares about food, defence, growth and industry. */
export interface Personality {
  food: number;
  defense: number;
  growth: number;
  industry: number;
}

export function randomPersonality(rng: () => number): Personality {
  const k = () => 0.6 + rng() * 0.8;
  return { food: k(), defense: k(), growth: k(), industry: k() };
}

export interface Option {
  type: BuildingType;
  score: number;
}

const n = (s: TownState, t: BuildingType) => s.count[t] ?? 0;

/** Every building option with its utility (0 = pointless now), best first. */
export function scoreOptions(s: TownState, p: Personality): Option[] {
  const hungry = s.foodDays < 3;
  const fed = s.foodDays >= 4;
  const out: Option[] = [
    // One farm per 5 people is enough (each extra one takes a worker from wood and stone).
    // (when food is already short, one per 4 people).
    {
      type: 'farm',
      score:
        p.food * (hungry ? (n(s, 'farm') < Math.ceil(s.people / 4) ? 4 : 0) : n(s, 'farm') < Math.ceil(s.people / 5) ? 1.2 : 0),
    },
    { type: 'hunter', score: p.food * (n(s, 'hunter') < 1 + Math.floor(s.people / 12) ? (hungry ? 2 : 0.6) : 0) },
    // Beds, only with food to spare (more mouths otherwise starve).
    { type: 'house', score: p.growth * (s.freeBeds < 2 ? (fed ? 2.2 : s.foodDays >= 3 ? 0.8 : 0) : 0.1) },
    // Defence: barracks first, then towers, more when threatened.
    {
      type: 'barracks',
      score: p.defense * (n(s, 'barracks') === 0 ? (s.threatened ? 3.5 : 0.7) : s.threatened && n(s, 'barracks') < 2 ? 0.6 : 0),
    },
    {
      type: 'tower',
      score: p.defense * (n(s, 'tower') < 1 + (s.threatened ? 2 : 0) + Math.floor(s.people / 15) ? (s.threatened ? 2 : 0.5) : 0),
    },
    // Materials when they run low.
    {
      type: 'lumberjack',
      score: p.industry * (n(s, 'lumberjack') < 2 + Math.floor(s.people / 8) ? (s.stock.wood < 40 ? 1.8 : 0.4) : 0),
    },
    {
      type: 'quarry',
      score: p.industry * (n(s, 'quarry') < 1 + Math.floor(s.people / 8) ? (s.stock.stone < 30 ? 1.5 : 0.4) : 0),
    },
    // Tools: a smithy once the village is big enough, and iron for it.
    { type: 'smithy', score: p.industry * (n(s, 'smithy') === 0 && s.people >= 8 && fed ? 1.5 : 0) },
    { type: 'mine', score: p.industry * (n(s, 'mine') === 0 && n(s, 'smithy') > 0 && s.stock.iron < 15 ? 1.2 : 0) },
    // Reach: trade and diplomacy.
    { type: 'market', score: p.growth * (n(s, 'market') === 0 && s.people >= 12 && fed ? 0.8 : 0) },
    { type: 'embassy', score: p.growth * (n(s, 'embassy') === 0 ? 0.9 : 0) },
  ];
  return out.filter((o) => o.score > 0).sort((a, b) => b.score - a.score);
}

const canAfford = (stock: Amounts, t: BuildingType) =>
  Object.entries(BUILDING_DEFS[t].cost).every(([r, k]) => stock[r as keyof Amounts] >= (k ?? 0));

/**
 * What to build now: the best affordable option, unless a clearly more urgent one (score at least
 * 1.5 and ahead of it) can't be afforded yet, in which case it saves up (null).
 */
export function chooseBuild(s: TownState, p: Personality): BuildingType | null {
  const options = scoreOptions(s, p);
  const top = options[0];
  if (!top) return null;
  if (canAfford(s.stock, top.type)) return top.type;
  if (top.score >= 1.5) return null; // save up for it
  return options.find((o) => canAfford(s.stock, o.type))?.type ?? null;
}
