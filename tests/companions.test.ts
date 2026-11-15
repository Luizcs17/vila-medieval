import { describe, expect, it } from 'vitest';
import { COMPANION_MAX, INVENTORY_SLOTS } from '../src/config';
import { Buildings } from '../src/game/buildings';
import { Inventory } from '../src/game/inventory';
import { updateNeedsFrom } from '../src/game/needs';
import { generateWanderer, Population } from '../src/game/npcs';
import { SlotInventory } from '../src/game/slots';
import { type Market, quoteBuy, quoteSell } from '../src/game/trade';
import { generateMap } from '../src/world/map';

const seq = (seed: number) => () => {
  seed = (seed * 9301 + 49297) % 233280;
  return seed / 233280;
};

const setup = () => {
  const pop = new Population(new Buildings(generateMap()));
  const inv = new SlotInventory(INVENTORY_SLOTS, 9, 1000);
  const stock = new Inventory();
  const rng = seq(7);
  const wanderer = () => {
    const n = generateWanderer(rng, pop.newId(), 1e9);
    n.request = { wood: 2 };
    pop.npcs.push(n);
    return n;
  };
  return { pop, inv, stock, wanderer };
};

describe('companions', () => {
  it('join without a bed, up to the limit, paying their request', () => {
    const { pop, inv, stock, wanderer } = setup();
    inv.add('wood', 100);
    for (let k = 0; k < COMPANION_MAX; k++) expect(pop.recruitCompanion(wanderer(), inv, stock)).toBe(true);
    expect(pop.companions.length).toBe(COMPANION_MAX);
    expect(inv.count('wood')).toBe(100 - 2 * COMPANION_MAX);
    const extra = wanderer();
    expect(pop.checkCompanion(extra, inv, stock).room).toBe(false);
    expect(pop.recruitCompanion(extra, inv, stock)).toBe(false);
    expect(pop.villagers.length).toBe(0); // not villagers (no beds needed)
  });

  it('eat from whatever larder they are given (the player’s bag)', () => {
    const { pop, inv, stock, wanderer } = setup();
    inv.add('wood', 10);
    inv.add('meat', 3);
    const n = wanderer();
    pop.recruitCompanion(n, inv, stock);
    n.food = 10;
    const larder = { take: () => inv.remove('meat', 1) === 1 };
    updateNeedsFrom([n], larder, 1);
    expect(inv.count('meat')).toBe(2);
    expect(n.food).toBeGreaterThan(50);
  });
});

describe('trading in person', () => {
  const market = (have: number, coins = 100): Market => {
    let n = have;
    return {
      coins,
      have: () => n,
      forSale: () => Math.max(0, n - 5),
      wants: () => Math.max(0, 80 - n),
      add: (_g, k) => {
        n += k;
      },
      remove: (_g, k) => {
        n -= k;
      },
    };
  };

  it('quotes buying only what they sell and you can pay for', () => {
    expect('why' in quoteBuy(market(3), 'wood', 100)).toBe(true);
    const q = quoteBuy(market(60), 'wood', 100);
    expect('price' in q && q.price > 0).toBe(true);
    expect('why' in quoteBuy(market(60), 'iron_sword', 0)).toBe(true);
  });

  it('pays less for worn tools and nothing when they are broke', () => {
    const fresh = quoteSell(market(0), 'iron_axe', 1);
    const worn = quoteSell(market(0), 'iron_axe', 0.25);
    expect('price' in fresh && 'price' in worn && worn.price < fresh.price).toBe(true);
    expect('why' in quoteSell(market(0, 0), 'wood')).toBe(true);
  });
});
