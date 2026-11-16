import { RESOURCES, type Resource } from './inventory';
import { ITEM_DEFS, type ToolId } from './items';

/** Anything caravans carry: raw materials and finished tools/weapons. */
export type Good = Resource | ToolId;
export const TOOL_GOODS = Object.keys(ITEM_DEFS).filter((k) => {
  const d = ITEM_DEFS[k as keyof typeof ITEM_DEFS];
  return d.tool || d.armor;
}) as ToolId[];
export const GOODS: Good[] = [...RESOURCES, ...TOOL_GOODS];
export const isToolGood = (g: Good): g is ToolId => (TOOL_GOODS as string[]).includes(g);
export const goodLabel = (g: Good) => ITEM_DEFS[g].label;

/** Base value in coins (moedas). Local prices move with supply. */
export const BASE_PRICE: Record<Good, number> = {
  wood: 2,
  stone: 3,
  iron: 8,
  meat: 3,
  leather: 5,
  seed: 2,
  stone_axe: 12,
  stone_pick: 14,
  shovel: 10,
  spear: 12,
  iron_axe: 30,
  iron_pick: 30,
  iron_sword: 40,
  leather_armor: 35,
  iron_armor: 90,
};

/** How much of a good a village wants to keep around; prices rise below it and fall above. */
export const targetStock = (g: Good) => (isToolGood(g) ? 3 : 40);

/** Unit value at a market that holds `have`: base × (1.6 − have/target), clamped to 0.6×–1.8×. */
export function localPrice(g: Good, have: number): number {
  const k = Math.max(0.6, Math.min(1.8, 1.6 - have / targetStock(g)));
  return BASE_PRICE[g] * k;
}

/** What a market pays per unit (a good merchant, Diplomacia rating 1–5, haggles ±4% per star). */
export function sellPrice(g: Good, have: number, rating = 3): number {
  return Math.max(1, Math.round(localPrice(g, have) * 0.9 * (1 + (rating - 3) * 0.04)));
}

/** What a market charges per unit. */
export function buyPrice(g: Good, have: number, rating = 3): number {
  return Math.max(1, Math.round(localPrice(g, have) * 1.1 * (1 - (rating - 3) * 0.04)));
}

export type Goods = Partial<Record<Good, number>>;

/** A village's market as seen by a visiting caravan. */
export interface Market {
  coins: number;
  /** Units on hand (what the village holds). */
  have(g: Good): number;
  /** Units it is willing to sell. */
  forSale(g: Good): number;
  /** Units it is willing to buy. */
  wants(g: Good): number;
  add(g: Good, n: number): void;
  remove(g: Good, n: number): void;
}

export interface TradeResult {
  sold: Goods;
  earned: number;
  bought: Goods;
  spent: number;
}

/**
 * A caravan trades at `dest`: sells `cargo` unit by unit (each sale lowers the next price) while
 * the market wants it and can pay, then buys `shopping` with the coins it carries. Mutates `dest`
 * and `cargo` (unsold units stay in it). Returns what happened.
 */
export function executeTrade(cargo: Goods, shopping: Goods, coins: number, dest: Market, rating = 3): TradeResult {
  const result: TradeResult = { sold: {}, earned: 0, bought: {}, spent: 0 };
  for (const g of GOODS) {
    while ((cargo[g] ?? 0) > 0 && dest.wants(g) > 0) {
      const p = sellPrice(g, dest.have(g), rating);
      if (dest.coins < p) break;
      dest.coins -= p;
      dest.add(g, 1);
      cargo[g] = (cargo[g] ?? 0) - 1;
      result.sold[g] = (result.sold[g] ?? 0) + 1;
      result.earned += p;
    }
  }
  let purse = coins + result.earned;
  for (const g of GOODS) {
    let want = shopping[g] ?? 0;
    while (want > 0 && dest.forSale(g) > 0) {
      const p = buyPrice(g, dest.have(g), rating);
      if (purse < p) break;
      purse -= p;
      dest.coins += p;
      dest.remove(g, 1);
      want--;
      result.bought[g] = (result.bought[g] ?? 0) + 1;
      result.spent += p;
    }
  }
  return result;
}

/** What an AI caravan takes and wants: surplus goes out, shortages come back. */
export function planAiCaravan(home: Market): { cargo: Goods; shopping: Goods; coins: number } {
  const cargo: Goods = {};
  const shopping: Goods = {};
  for (const g of GOODS) {
    const t = targetStock(g);
    const cap = isToolGood(g) ? 2 : 12;
    const surplus = Math.floor(home.have(g) - t * 1.2);
    if (surplus > 0) cargo[g] = Math.min(surplus, cap);
    const need = Math.ceil(t * 0.5 - home.have(g));
    if (need > 0) shopping[g] = Math.min(need, cap);
  }
  return { cargo, shopping, coins: Math.min(Math.floor(home.coins / 2), 120) };
}

/** Buying one unit from a village's market with `purse` coins: the price, or why not. */
export function quoteBuy(m: Market, g: Good, purse: number): { price: number } | { why: string } {
  if (m.forSale(g) <= 0) return { why: `Não vendem ${goodLabel(g)} agora (precisam dele ou não querem).` };
  const price = buyPrice(g, m.have(g));
  if (purse < price) return { why: 'Moedas insuficientes.' };
  return { price };
}

/** Selling one unit (a worn tool is worth its remaining use, `condition` 0–1): the price, or why not. */
export function quoteSell(m: Market, g: Good, condition = 1): { price: number } | { why: string } {
  if (m.wants(g) <= 0) return { why: `Não querem mais ${goodLabel(g)}.` };
  const price = Math.max(1, Math.round(sellPrice(g, m.have(g)) * Math.max(0, Math.min(1, condition))));
  if (m.coins < price) return { why: 'A vila não tem moedas para pagar.' };
  return { price };
}

export const summarize = (goods: Goods) =>
  GOODS.filter((g) => (goods[g] ?? 0) > 0)
    .map((g) => `${goods[g]} ${goodLabel(g)}`)
    .join(', ');
