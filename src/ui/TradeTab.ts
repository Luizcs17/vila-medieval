import { buyPrice, GOODS, type Good, type Goods, goodLabel, isToolGood, sellPrice, TOOL_GOODS } from '../game/trade';
import type { ManagementUI } from './ManagementUI';

const MUTED = '#a8977a';
const GOLD = '#e0b860';

/** Tab state survives rebuilds. */
let mode: 'caravan' | 'policy' = 'caravan';
let destId: number | null = null;
let sell: Goods = {};
let buy: Goods = {};
let lastMessage = '';

const step = (g: Good) => (isToolGood(g) ? 1 : 5);

/**
 * Comércio tab. "Caravana": pick a market, choose what to sell and what to buy (prices are what
 * that market pays/charges now), and send a merchant. "Mercadores visitantes": standing orders for
 * caravans that come to your market. Also shows your treasury and the market's tool warehouse.
 */
export function renderTrade(ui: ManagementUI, x: number, y: number, w: number): void {
  const world = ui.world;
  const me = world.factions[0];
  const myMarket = world.marketOf(me);
  const merchants = world.freeMerchants();
  const best = merchants[0];
  const rating = best?.skills.diplomacy ?? 3;

  ui.text(
    x,
    y,
    `⛁ ${me.coins} moedas  ·  Mercadores livres: ${merchants.length}${best ? ` (melhor: ${best.name}, ${rating}★ em negociar)` : world.hasMarket(0) ? '' : ' — construa um Mercado'}`,
    13,
    GOLD,
  );
  const travelling = [...world.missions.values()].filter((m) => m.kind === 'trade' && (m.faction ?? 0) === 0);
  if (travelling.length > 0) {
    const phase = { going: 'a caminho', talking: 'comerciando', returning: 'voltando' };
    ui.text(
      x,
      y + 18,
      `Caravanas: ${travelling.map((m) => `${world.factions[m.target].name} (${phase[m.phase]})`).join(', ')}`,
      11,
      '#a8c8ff',
    );
  }
  if (lastMessage) ui.text(x + w - 330, y + 18, lastMessage.slice(0, 60), 11, '#ffe08a');

  ui.button(
    x,
    y + 38,
    150,
    'Enviar caravana',
    () => {
      mode = 'caravan';
      ui.build();
    },
    mode === 'caravan' ? 0x5a4630 : 0x241a12,
  );
  ui.button(
    x + 156,
    y + 38,
    210,
    'Mercadores visitantes',
    () => {
      mode = 'policy';
      ui.build();
    },
    mode === 'policy' ? 0x5a4630 : 0x241a12,
  );

  // Tool warehouse (take tools back into your inventory).
  const stocked = TOOL_GOODS.filter((t) => (me.tools[t] ?? 0) > 0);
  let wx = x + 380;
  ui.text(wx, y + 42, stocked.length ? 'Armazém:' : 'Armazém vazio (E no Mercado guarda suas ferramentas)', 11, MUTED);
  wx += 62;
  for (const t of stocked.slice(0, 4)) {
    ui.button(wx, y + 38, 104, `${goodLabel(t).split(' ')[0]} ${goodLabel(t).split(' ').at(-1)} ×${me.tools[t]}`, () => {
      lastMessage = world.takeTool(t) ? `Você pegou ${goodLabel(t)}.` : 'Sem espaço no inventário.';
      ui.build();
    });
    wx += 108;
  }

  const top = y + 74;
  if (mode === 'policy') {
    renderPolicy(ui, x, top);
    return;
  }

  // Destination.
  const markets = world.factions.filter((f) => !f.isPlayer && f.alive && world.hasMarket(f.id));
  if (destId === null || !markets.some((f) => f.id === destId)) destId = markets[0]?.id ?? null;
  ui.text(x, top + 4, 'Destino:', 12, '#cdb98e');
  markets.forEach((f, k) => {
    const war = world.atWar(0, f.id);
    ui.button(
      x + 70 + k * 150,
      top,
      144,
      war ? `${f.name} (guerra)` : f.name,
      () => {
        destId = f.id;
        ui.build();
      },
      f.id === destId ? 0x5a4630 : war ? 0x3a1a16 : 0x241a12,
    );
  });
  if (destId === null) {
    ui.text(x, top + 34, 'Nenhuma outra vila tem mercado.', 12, MUTED);
    return;
  }
  const dest = world.marketOf(world.factions[destId]);

  // Goods table.
  let yy = top + 34;
  const cols = { name: x, here: x + 150, there: x + 215, sellP: x + 290, buyP: x + 360, sell: x + 440, buy: x + 610 };
  ui.text(cols.name, yy, 'Mercadoria', 11, MUTED);
  ui.text(cols.here, yy, 'Aqui', 11, MUTED);
  ui.text(cols.there, yy, 'Lá', 11, MUTED);
  ui.text(cols.sellP, yy, 'Pagam', 11, MUTED);
  ui.text(cols.buyP, yy, 'Cobram', 11, MUTED);
  ui.text(cols.sell, yy, 'Vender', 11, MUTED);
  ui.text(cols.buy, yy, 'Comprar', 11, MUTED);
  yy += 18;
  let income = 0;
  let cost = 0;
  for (const g of GOODS) {
    const have = myMarket.have(g);
    sell[g] = Math.min(sell[g] ?? 0, have);
    const sp = sellPrice(g, dest.have(g), rating);
    const bp = buyPrice(g, dest.have(g), rating);
    income += (sell[g] ?? 0) * sp;
    cost += (buy[g] ?? 0) * bp;
    ui.text(cols.name, yy + 3, goodLabel(g), 12);
    ui.text(cols.here, yy + 3, `${have}`, 12);
    ui.text(cols.there, yy + 3, `${dest.have(g)}`, 12, MUTED);
    ui.text(cols.sellP, yy + 3, `${sp}`, 12, '#a8e890');
    ui.text(cols.buyP, yy + 3, `${bp}`, 12, '#ffb070');
    const counter = (cx: number, map: Goods, max: number) => {
      ui.button(cx, yy, 26, '−', () => {
        map[g] = Math.max(0, (map[g] ?? 0) - step(g));
        ui.build();
      });
      ui.text(cx + 34, yy + 3, `${map[g] ?? 0}`, 12);
      ui.button(cx + 64, yy, 26, '+', () => {
        map[g] = Math.min(max, (map[g] ?? 0) + step(g));
        ui.build();
      });
    };
    counter(cols.sell, sell, have);
    counter(cols.buy, buy, dest.forSale(g));
    yy += 24;
  }
  yy += 6;
  const budget = Math.min(me.coins, cost);
  ui.text(x, yy + 4, `Venda estimada ≈ ${income} moedas  ·  Compra estimada ≈ ${cost} moedas (leva ${budget})`, 12, GOLD);
  ui.button(
    x + w - 200,
    yy,
    200,
    'Enviar caravana',
    () => {
      lastMessage = world.sendCaravan(destId!, sell, buy, budget);
      if (lastMessage.startsWith('A caravana')) {
        sell = {};
        buy = {};
      }
      ui.build();
    },
    0x5a4630,
  );
  ui.text(x, yy + 26, 'Os preços mudam com a oferta: quanto mais se vende num lugar, menos ele paga.', 10, MUTED);
}

function renderPolicy(ui: ManagementUI, x: number, top: number): void {
  const world = ui.world;
  const policy = world.tradePolicy;
  const me = world.marketOf(world.factions[0]);
  ui.text(x, top, 'Caravanas de outras vilas que visitam seu Mercado compram e vendem segundo estas ordens:', 12, '#cdb98e');
  let yy = top + 24;
  ui.text(x, yy, 'Mercadoria', 11, MUTED);
  ui.text(x + 150, yy, 'Aqui', 11, MUTED);
  ui.text(x + 220, yy, 'Vender o que passar de', 11, MUTED);
  ui.text(x + 450, yy, 'Comprar até ter', 11, MUTED);
  yy += 18;
  for (const g of GOODS) {
    ui.text(x, yy + 3, goodLabel(g), 12);
    ui.text(x + 150, yy + 3, `${me.have(g)}`, 12);
    const counter = (cx: number, map: Partial<Record<Good, number>>, none: number, label: (v: number) => string) => {
      const v = map[g] ?? none;
      ui.button(cx, yy, 26, '−', () => {
        map[g] = Math.max(0, (Number.isFinite(v) ? v : 100) - step(g));
        ui.build();
      });
      ui.text(cx + 34, yy + 3, label(v), 12);
      ui.button(cx + 120, yy, 26, '+', () => {
        const next = (Number.isFinite(v) ? v : 0) + step(g);
        map[g] = next >= 100 && none === Infinity ? Infinity : next;
        ui.build();
      });
    };
    counter(x + 220, policy.sellAbove, Infinity, (v) => (Number.isFinite(v) ? `${v}` : 'não vende'));
    counter(x + 450, policy.buyUpTo, 0, (v) => (v > 0 ? `${v}` : 'não compra'));
    yy += 24;
  }
  ui.text(x, yy + 8, 'Você recebe moedas pelo que vendem daqui e paga pelo que compram para você.', 10, MUTED);
}
