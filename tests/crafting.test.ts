import { describe, expect, it } from 'vitest';
import { MAX_CARRY_WEIGHT, PLAYER_MAX_HP } from '../src/config';
import { checkCraft, craft } from '../src/game/crafting';
import { NODE_DEFS } from '../src/game/gathering';
import { Inventory } from '../src/game/inventory';
import { ITEM_DEFS, RECIPES } from '../src/game/items';
import { MAX_LEVEL, PER_LEVEL, PlayerStats, xpToNext } from '../src/game/player';
import { SlotInventory } from '../src/game/slots';
import { Obj } from '../src/world/map';

const recipe = (item: string) => RECIPES.find((r) => r.item === item)!;

describe('crafting', () => {
  it('pays from the inventory first, then the stockpile, and adds a tool with full durability', () => {
    const inv = new SlotInventory(27, 9, 40);
    const stock = new Inventory();
    inv.add('wood', 2);
    stock.add('wood', 5);
    stock.add('stone', 5);
    expect(craft(recipe('stone_axe'), inv, stock)).toBe('ok');
    expect(inv.count('wood')).toBe(0);
    expect(stock.items).toMatchObject({ wood: 4, stone: 3 });
    const axe = inv.slots.find((s) => s?.item === 'stone_axe')!;
    expect(axe.durability).toBe(ITEM_DEFS.stone_axe.tool!.durability);
  });

  it('refuses without materials or room', () => {
    const inv = new SlotInventory(27, 9, 40);
    const stock = new Inventory();
    expect(checkCraft(recipe('iron_sword'), inv, stock)).toBe('cost');
    stock.add('wood', 10);
    stock.add('iron', 10);
    const tight = new SlotInventory(27, 9, 1); // can't carry a 3 kg sword
    expect(checkCraft(recipe('iron_sword'), tight, stock)).toBe('space');
    expect(craft(recipe('iron_sword'), tight, stock)).toBe('space');
    expect(stock.items.iron).toBe(10); // nothing was spent
  });

  it('has a recipe for every tool and weapon', () => {
    const tools = Object.keys(ITEM_DEFS).filter((i) => {
      const d = ITEM_DEFS[i as keyof typeof ITEM_DEFS];
      return d.tool || d.armor; // every piece of gear can be made
    });
    expect(RECIPES.map((r) => r.item).sort()).toEqual(tools.sort());
  });
});

describe('tools in the inventory', () => {
  it('do not stack and wear out, breaking at zero', () => {
    const inv = new SlotInventory(4, 2, 40);
    inv.add('stone_pick', 2);
    expect(inv.slots[0]?.count).toBe(1);
    expect(inv.slots[1]?.item).toBe('stone_pick');
    inv.slots[0]!.durability = 2;
    expect(inv.wear(0)).toBe(false);
    expect(inv.wear(0)).toBe(true);
    expect(inv.slots[0]).toBeNull();
  });

  it('keep their durability when moved with the mouse or stowed', () => {
    const inv = new SlotInventory(4, 2, 40);
    inv.add('iron_axe', 1);
    inv.slots[0]!.durability = 17;
    let held = inv.rightClick(0, null); // right click on a tool takes it whole
    expect(held).toMatchObject({ item: 'iron_axe', durability: 17 });
    held = inv.leftClick(3, held);
    expect(inv.slots[3]?.durability).toBe(17);
    held = inv.leftClick(3, null);
    expect(inv.stow(held!)).toBeNull();
    expect(inv.slots.find((s) => s?.item === 'iron_axe')?.durability).toBe(17);
    inv.quickMove(inv.slots.findIndex((s) => s?.item === 'iron_axe'));
    expect(inv.slots.find((s) => s?.item === 'iron_axe')?.durability).toBe(17);
  });

  it('are kept when depositing resources', () => {
    const inv = new SlotInventory(4, 2, 40);
    inv.add('spear', 1);
    inv.add('wood', 3);
    expect(inv.takeAllResources().wood).toBe(3);
    expect(inv.count('spear')).toBe(1);
  });

  it('gate iron behind a pickaxe', () => {
    expect(NODE_DEFS[Obj.Iron]?.needsTool).toBe(true);
    expect(NODE_DEFS[Obj.Iron]?.tool).toBe('pick');
    expect(NODE_DEFS[Obj.Tree]?.tool).toBe('axe');
    expect(NODE_DEFS[Obj.Tree]?.needsTool).toBeFalsy();
  });
});

describe('player progression', () => {
  it('levels up with XP, raising max HP, carry weight and gathering speed', () => {
    const p = new PlayerStats();
    expect(p.carryWeight).toBe(MAX_CARRY_WEIGHT);
    expect(p.addXp(xpToNext(1) - 1)).toBe(0);
    expect(p.addXp(1)).toBe(1);
    expect(p.level).toBe(2);
    expect(p.maxHp).toBe(PLAYER_MAX_HP + PER_LEVEL.hp);
    expect(p.carryWeight).toBe(MAX_CARRY_WEIGHT + PER_LEVEL.carry);
    expect(p.gatherSpeed).toBeCloseTo(1 + PER_LEVEL.gather);
  });

  it('can gain several levels at once and stops at the cap', () => {
    const p = new PlayerStats();
    expect(p.addXp(xpToNext(1) + xpToNext(2))).toBe(2);
    p.addXp(1_000_000);
    expect(p.level).toBe(MAX_LEVEL);
    expect(p.xp).toBe(0);
  });
});
