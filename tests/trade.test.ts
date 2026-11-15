import { describe, expect, it } from 'vitest';
import {
  BASE_PRICE,
  buyPrice,
  executeTrade,
  GOODS,
  type Good,
  localPrice,
  type Market,
  planAiCaravan,
  sellPrice,
  targetStock,
} from '../src/game/trade';

/** Simple market for tests: unlimited wants, keeps a 30% reserve. */
function market(stock: Partial<Record<Good, number>>, coins: number): Market & { stock: Partial<Record<Good, number>> } {
  return {
    stock,
    coins,
    have: (g) => stock[g] ?? 0,
    forSale: (g) => Math.max(0, (stock[g] ?? 0) - Math.floor(targetStock(g) * 0.3)),
    wants: () => Infinity,
    add: (g, n) => {
      stock[g] = (stock[g] ?? 0) + n;
    },
    remove: (g, n) => {
      stock[g] = (stock[g] ?? 0) - n;
    },
  };
}

describe('prices', () => {
  it('follow supply: scarce goods cost more, gluts less, within bounds', () => {
    expect(localPrice('iron', 0)).toBeGreaterThan(localPrice('iron', targetStock('iron')));
    expect(localPrice('iron', 0)).toBeLessThanOrEqual(BASE_PRICE.iron * 1.8);
    expect(localPrice('iron', 9999)).toBeGreaterThanOrEqual(BASE_PRICE.iron * 0.6);
  });

  it('markets buy cheaper than they sell, and good merchants haggle', () => {
    for (const g of GOODS) expect(sellPrice(g, 10)).toBeLessThanOrEqual(buyPrice(g, 10));
    expect(sellPrice('iron_sword', 0, 5)).toBeGreaterThan(sellPrice('iron_sword', 0, 1));
    expect(buyPrice('iron_sword', 0, 5)).toBeLessThan(buyPrice('iron_sword', 0, 1));
  });
});

describe('caravan trade', () => {
  it('sells cargo for coins and buys with the purse, moving goods both ways', () => {
    const dest = market({ wood: 5, iron: 30 }, 500);
    const cargo = { wood: 20 };
    const r = executeTrade(cargo, { iron: 4 }, 0, dest);
    expect(r.sold.wood).toBe(20);
    expect(cargo.wood).toBe(0);
    expect(r.bought.iron).toBe(4);
    expect(dest.stock.wood).toBe(25);
    expect(dest.stock.iron).toBe(26);
    expect(dest.coins).toBe(500 - r.earned + r.spent);
  });

  it('each sale lowers the next price (diminishing returns)', () => {
    const dest = market({ wood: 0 }, 9999);
    const first = sellPrice('wood', 0);
    executeTrade({ wood: 60 }, {}, 0, dest);
    expect(sellPrice('wood', dest.have('wood'))).toBeLessThan(first);
  });

  it('stops when the buyer runs out of coins or stock, and returns the rest', () => {
    const broke = market({}, 5);
    const cargo = { iron_axe: 3 };
    const r = executeTrade(cargo, {}, 0, broke);
    expect(r.sold.iron_axe ?? 0).toBe(0);
    expect(cargo.iron_axe).toBe(3);
    const shop = market({ iron_sword: 1 }, 0);
    expect(executeTrade({}, { iron_sword: 5 }, 9999, shop).bought.iron_sword ?? 0).toBe(1);
  });
});

describe('AI caravans', () => {
  it('carry surplus out and shop for shortages with half the treasury', () => {
    const home = market({ wood: 200, iron: 0 }, 100);
    const plan = planAiCaravan(home);
    expect(plan.cargo.wood).toBeGreaterThan(0);
    expect(plan.shopping.iron).toBeGreaterThan(0);
    expect(plan.coins).toBe(50);
  });
});
