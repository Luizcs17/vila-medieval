import type { Inventory } from './inventory';
import type { Recipe } from './items';
import { canPayFrom, payFrom } from './npcs';
import type { SlotInventory } from './slots';

export type CraftCheck = 'ok' | 'cost' | 'space';

/** Can `recipe` be crafted now? Needs the materials (carried + stockpile) and room for the result. */
export function checkCraft(recipe: Recipe, inv: SlotInventory, stock: Inventory): CraftCheck {
  if (!canPayFrom(recipe.cost, inv, stock)) return 'cost';
  if (inv.space(recipe.item) <= 0) return 'space';
  return 'ok';
}

/** Crafts `recipe` into the inventory, paying from what you carry first, then the stockpile. */
export function craft(recipe: Recipe, inv: SlotInventory, stock: Inventory): CraftCheck {
  const check = checkCraft(recipe, inv, stock);
  if (check !== 'ok') return check;
  payFrom(recipe.cost, inv, stock);
  inv.add(recipe.item, 1);
  return 'ok';
}
