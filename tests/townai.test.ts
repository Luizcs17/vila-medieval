import { describe, expect, it } from 'vitest';
import { emptyAmounts } from '../src/game/inventory';
import { chooseBuild, type Personality, scoreOptions, type TownState } from '../src/game/townAI';

const even: Personality = { food: 1, defense: 1, growth: 1, industry: 1 };
const town = (over: Partial<TownState> = {}): TownState => ({
  people: 10,
  freeBeds: 2,
  foodDays: 5,
  threatened: false,
  count: { farm: 2, hunter: 1, barracks: 1, tower: 1, lumberjack: 1, quarry: 1, embassy: 1 },
  stock: { ...emptyAmounts(), wood: 100, stone: 100, iron: 20 },
  soldiers: 1,
  ...over,
});

describe('rival village planner', () => {
  it('feeds itself first when hungry', () => {
    expect(chooseBuild(town({ foodDays: 1, count: { farm: 1 } }), even)).toBe('farm');
  });

  it('builds barracks when threatened and has none', () => {
    expect(chooseBuild(town({ threatened: true, count: { farm: 2, hunter: 1 } }), even)).toBe('barracks');
  });

  it('adds beds only with food to spare', () => {
    expect(scoreOptions(town({ freeBeds: 0, foodDays: 5 }), even)[0].type).toBe('house');
    expect(scoreOptions(town({ freeBeds: 0, foodDays: 2 }), even).find((o) => o.type === 'house')).toBeUndefined();
  });

  it('gets a smithy once it is big and fed, then a mine for iron', () => {
    expect(scoreOptions(town({ freeBeds: 4 }), even)[0].type).toBe('smithy');
    const withSmithy = town({
      freeBeds: 4,
      count: { ...town().count, smithy: 1 },
      stock: { ...emptyAmounts(), wood: 100, stone: 100 },
    });
    expect(scoreOptions(withSmithy, even).some((o) => o.type === 'mine')).toBe(true);
  });

  it('saves up for an urgent but expensive option instead of spending elsewhere', () => {
    const broke = town({ threatened: true, count: { farm: 2, hunter: 1 }, stock: { ...emptyAmounts(), wood: 15, stone: 5 } });
    expect(chooseBuild(broke, even)).toBeNull();
  });

  it('personality changes the order', () => {
    const builder: Personality = { food: 1, defense: 0.6, growth: 1.4, industry: 0.6 };
    const s = town({
      freeBeds: 0,
      threatened: false,
      count: { farm: 2, hunter: 1, tower: 1, lumberjack: 2, quarry: 2, embassy: 1 },
    });
    expect(scoreOptions(s, builder)[0].type).toBe('house');
  });
});
