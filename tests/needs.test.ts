import { describe, expect, it } from 'vitest';
import { DAY_SECONDS } from '../src/config';
import { Inventory } from '../src/game/inventory';
import { appetite, dailyMeat, foodDays, isStarving, STARVE_DEATH, updateNeeds } from '../src/game/needs';
import { generateWanderer, type NpcData, type TraitId } from '../src/game/npcs';

const villager = (traits: TraitId[] = []): NpcData => ({
  ...generateWanderer(() => 0.5, 1, 0),
  role: 'villager',
  traits,
  food: 100,
  starving: 0,
});

describe('appetite', () => {
  it('Frugal eats less and Apetite grande eats more', () => {
    expect(appetite(villager(['frugal']))).toBeLessThan(1);
    expect(appetite(villager(['appetite']))).toBeGreaterThan(1);
    expect(dailyMeat(villager())).toBe(2);
    expect(dailyMeat(villager(['frugal']))).toBeCloseTo(1.4);
  });
});

describe('eating', () => {
  it('eats about 2 meat a day from the stockpile and stays fed', () => {
    const v = villager();
    const stock = new Inventory();
    stock.add('meat', 20);
    for (let t = 0; t < DAY_SECONDS * 4; t++) updateNeeds([v], stock, 1);
    const eaten = 20 - stock.items.meat;
    expect(eaten).toBeGreaterThanOrEqual(7); // ~2 per day, the first meal comes after half a day
    expect(eaten).toBeLessThanOrEqual(8);
    expect(isStarving(v)).toBe(false);
  });

  it('starves without food, warns once, and dies after STARVE_DEATH', () => {
    const v = villager();
    const stock = new Inventory();
    const events: string[] = [];
    let t = 0;
    while (t < DAY_SECONDS * 3 && !events.includes('died')) {
      for (const e of updateNeeds([v], stock, 10)) events.push(e.type);
      t += 10;
    }
    expect(events.filter((e) => e === 'starving')).toHaveLength(1);
    expect(events).toContain('died');
    expect(t).toBeGreaterThanOrEqual(DAY_SECONDS + STARVE_DEATH - 10);
  });

  it('recovers when food arrives', () => {
    const v = { ...villager(), food: 0, starving: 100 };
    const stock = new Inventory();
    stock.add('meat', 1);
    updateNeeds([v], stock, 1);
    expect(isStarving(v)).toBe(false);
    expect(v.starving).toBe(0);
  });

  it('estimates days of food left', () => {
    const stock = new Inventory();
    stock.add('meat', 8);
    expect(foodDays([villager(), villager()], stock)).toBe(2);
    expect(foodDays([], stock)).toBe(Infinity);
  });
});
