import { describe, expect, it } from 'vitest';
import { HUNTER_DAMAGE, HUNTER_RANGE } from '../src/config';
import { SPECIES } from '../src/game/animals';
import { BUILDING_DEFS, demolitionRefund } from '../src/game/buildings';

describe('demolition', () => {
  it('refunds everything for an unfinished site and half for a finished building', () => {
    expect(demolitionRefund({ type: 'house', built: false })).toEqual(BUILDING_DEFS.house.cost);
    expect(demolitionRefund({ type: 'house', built: true })).toEqual({ wood: 10, stone: 5 });
    expect(demolitionRefund({ type: 'palisade', built: true })).toEqual({ wood: 1 });
  });
});

describe('hunters', () => {
  it('can shoot prey from beyond the distance at which it bolts', () => {
    for (const s of ['deer', 'rabbit'] as const) expect(HUNTER_RANGE).toBeGreaterThan(SPECIES[s].fleeRange);
  });

  it('cover a wide area and kill a deer in two arrows', () => {
    expect(BUILDING_DEFS.hunter.job!.radius).toBeGreaterThanOrEqual(20);
    expect(Math.ceil(SPECIES.deer.hp / HUNTER_DAMAGE)).toBeLessThanOrEqual(2);
  });
});
