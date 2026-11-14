import type { Amounts, Resource } from './inventory';

export type ToolId = 'stone_axe' | 'iron_axe' | 'stone_pick' | 'iron_pick' | 'spear' | 'iron_sword';
/** Anything that can sit in an inventory slot. */
export type ItemId = Resource | ToolId;

export type ToolType = 'axe' | 'pick' | 'weapon';

export interface ItemDef {
  label: string;
  /** kg per unit. */
  weight: number;
  maxStack: number;
  tool?: {
    type: ToolType;
    /** Gathering speed multiplier on matching nodes (axe → trees, pick → rocks/iron). */
    speed: number;
    /** Melee damage when swung (hands do 1). */
    damage: number;
    durability: number;
    /** Melee reach bonus, in tiles. */
    reach?: number;
  };
}

export const ITEM_DEFS: Record<ItemId, ItemDef> = {
  wood: { label: 'Madeira', weight: 2, maxStack: 20 },
  stone: { label: 'Pedra', weight: 3, maxStack: 20 },
  iron: { label: 'Ferro', weight: 4, maxStack: 20 },
  meat: { label: 'Carne', weight: 1, maxStack: 20 },
  stone_axe: { label: 'Machado de pedra', weight: 2, maxStack: 1, tool: { type: 'axe', speed: 1.6, damage: 2, durability: 80 } },
  iron_axe: { label: 'Machado de ferro', weight: 3, maxStack: 1, tool: { type: 'axe', speed: 2.4, damage: 3, durability: 200 } },
  stone_pick: {
    label: 'Picareta de pedra',
    weight: 3,
    maxStack: 1,
    tool: { type: 'pick', speed: 1.6, damage: 1, durability: 80 },
  },
  iron_pick: {
    label: 'Picareta de ferro',
    weight: 4,
    maxStack: 1,
    tool: { type: 'pick', speed: 2.4, damage: 2, durability: 200 },
  },
  spear: { label: 'Lança', weight: 2, maxStack: 1, tool: { type: 'weapon', speed: 1, damage: 3, durability: 60, reach: 0.4 } },
  iron_sword: {
    label: 'Espada de ferro',
    weight: 3,
    maxStack: 1,
    tool: { type: 'weapon', speed: 1, damage: 5, durability: 150 },
  },
};

export const ALL_ITEMS = Object.keys(ITEM_DEFS) as ItemId[];
export const isTool = (item: ItemId): item is ToolId => ITEM_DEFS[item].tool !== undefined;

export interface Recipe {
  item: ToolId;
  cost: Partial<Amounts>;
  description: string;
}

/** Crafting costs are paid from what you carry first, then the stockpile (like recruiting). */
export const RECIPES: Recipe[] = [
  { item: 'stone_axe', cost: { wood: 3, stone: 2 }, description: 'Corta árvores 1,6× mais rápido. Dano 2.' },
  { item: 'stone_pick', cost: { wood: 3, stone: 3 }, description: 'Quebra pedra 1,6× mais rápido. Permite minerar ferro.' },
  { item: 'spear', cost: { wood: 4, stone: 2 }, description: 'Arma. Dano 3, alcance maior.' },
  { item: 'iron_axe', cost: { wood: 2, iron: 3 }, description: 'Corta árvores 2,4× mais rápido. Dano 3.' },
  { item: 'iron_pick', cost: { wood: 2, iron: 3 }, description: 'Pedra e ferro 2,4× mais rápido.' },
  { item: 'iron_sword', cost: { wood: 2, iron: 4 }, description: 'Arma. Dano 5.' },
];
