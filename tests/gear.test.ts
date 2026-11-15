import { describe, expect, it } from 'vitest';
import { newAnimal, takeLeather } from '../src/game/animals';
import { Buildings } from '../src/game/buildings';
import { createFactions } from '../src/game/factions';
import {
  absorb,
  bestArmor,
  grantStarterTools,
  smithyCanWork,
  tickSmithy,
  toolForWorker,
  toolSpeed,
  unqueue,
  wearWorkplaceTool,
  workplaceTools,
} from '../src/game/gear';
import { Inventory } from '../src/game/inventory';
import { maxDurability } from '../src/game/items';
import { soldierDamage } from '../src/game/npcs';
import { isSaveData, SAVE_VERSION } from '../src/game/save';
import { buildingStorage, villageStorage } from '../src/game/storage';
import { generateMap } from '../src/world/map';

const setup = (type: 'lumberjack' | 'smithy' | 'barracks' | 'hunter' = 'lumberjack') => {
  const map = generateMap();
  const s = map.sites[0];
  const b = new Buildings(map).place(type, s.x + 3, s.y + 3, true);
  const stock = new Inventory();
  const f = createFactions(map.sites, stock)[0];
  return { b, stock, f, village: villageStorage(f) };
};

describe('workplace tools', () => {
  it('each worker needs one accepted tool, best first', () => {
    const { b } = setup();
    expect(toolForWorker(b, 0)).toBeNull();
    b.storage.stone_axe = 1;
    b.storage.iron_axe = 1;
    b.storage.spear = 3; // not an axe: ignored
    expect(workplaceTools(b)).toEqual(['iron_axe', 'stone_axe']);
    expect(toolForWorker(b, 0)).toBe('iron_axe');
    expect(toolForWorker(b, 1)).toBe('stone_axe');
    expect(toolForWorker(b, 2)).toBeNull();
    expect(toolSpeed('iron_axe')).toBeGreaterThan(toolSpeed('stone_axe'));
  });

  it('jobs without tools never block', () => {
    const { b } = setup('barracks');
    expect(toolForWorker(b, 0)).toBe('none');
  });

  it('tools wear out after their durability in uses', () => {
    const { b } = setup('hunter');
    b.storage.spear = 2;
    const uses = maxDurability('spear')!;
    for (let i = 1; i < uses; i++) expect(wearWorkplaceTool(b, 'spear')).toBe(false);
    expect(wearWorkplaceTool(b, 'spear')).toBe(true);
    expect(b.storage.spear).toBe(1);
  });

  it('old saves and new rival towns get one basic tool per job slot', () => {
    const { b } = setup();
    grantStarterTools(b);
    expect(b.storage.stone_axe).toBe(2);
    expect(isSaveData({ version: 6 })).toBe(false); // shape still checked
    expect(SAVE_VERSION).toBe(7);
  });
});

describe('smithy', () => {
  it('waits for materials, pays once, and puts the finished item in its inventory', () => {
    const { b, stock, village } = setup('smithy');
    b.queue = ['stone_axe', 'spear'];
    const out = buildingStorage(b);
    expect(smithyCanWork(b, village)).toBe(false);
    expect(tickSmithy(b, 1, 10, village, out)).toEqual({ type: 'blocked', item: 'stone_axe' });
    stock.add('wood', 3);
    stock.add('stone', 2);
    expect(tickSmithy(b, 1, 10, village, out)).toBeNull();
    expect(stock.items.wood).toBe(0); // paid when started
    expect(tickSmithy(b, 0, 100, village, out)).toBeNull(); // nobody working: no progress
    expect(tickSmithy(b, 1, 30, village, out)).toEqual({ type: 'made', item: 'stone_axe' });
    expect(b.storage.stone_axe).toBe(1);
    expect(b.queue).toEqual(['spear']);
  });

  it('cancelling a started item refunds it', () => {
    const { b, stock, village } = setup('smithy');
    stock.add('leather', 6);
    b.queue = ['leather_armor'];
    tickSmithy(b, 1, 5, village, buildingStorage(b));
    expect(stock.items.leather).toBe(0);
    unqueue(b, 0, village);
    expect(stock.items.leather).toBe(6);
    expect(b.queue).toEqual([]);
  });
});

describe('weapons and armour', () => {
  it('weapons add to soldier damage', () => {
    const base = { skills: { combat: 2 } as never, food: 1, weapon: null };
    expect(soldierDamage({ ...base, weapon: 'iron_sword' }) - soldierDamage(base)).toBe(4);
  });

  it('armour absorbs a share of the damage', () => {
    expect(absorb(10, null, () => 0.5)).toBe(10);
    expect(absorb(10, 'leather_armor', () => 0.5)).toBe(7);
    expect(absorb(10, 'iron_armor', () => 0.99)).toBe(4); // 4.5 rounds down on a high roll
    expect(absorb(10, 'iron_armor', () => 0)).toBe(5);
    expect(bestArmor(['wood', 'leather_armor', 'iron_armor'])).toBe('iron_armor');
  });

  it('carcasses give leather', () => {
    const deer = newAnimal(1, 'deer', { x: 0, y: 0 });
    expect(takeLeather(deer, 5)).toBe(0); // alive
    deer.dead = true;
    expect(takeLeather(deer, 5)).toBe(2);
    expect(takeLeather(deer, 5)).toBe(0);
  });
});
